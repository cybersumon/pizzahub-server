import type { Request, Response } from "express";
import { ObjectId } from "mongodb";
import Stripe from "stripe";

import { db } from "../config/database.js";

// Keep this file at the existing webhook-handler path in your project.
const restaurants = db.collection("restaurants");
const transactions = db.collection("transactions");

type PaidPlan = "premium" | "premium_plus";

function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is missing.");
  return new Stripe(key);
}

function stripeDate(value: number | null | undefined): Date | null {
  return typeof value === "number" && Number.isFinite(value)
    ? new Date(value * 1000)
    : null;
}

async function synchronizeSubscription(
  stripe: Stripe,
  subscriptionId: string,
  eventId: string
): Promise<void> {
  // Retrieve current Stripe state; delivery order is not guaranteed.
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const restaurantId = subscription.metadata.restaurantId;
  const vendorId = subscription.metadata.vendorId;

  if (!restaurantId || !ObjectId.isValid(restaurantId) || !vendorId) {
    throw new Error("Subscription ownership metadata is missing.");
  }

  const restaurant = await restaurants.findOne({
    _id: new ObjectId(restaurantId),
    ownerId: vendorId,
  });
  if (!restaurant) throw new Error("Subscription restaurant not found.");

  const activePriceId = subscription.items.data[0]?.price.id;
  let paidPlan: PaidPlan | null = null;
  if (activePriceId === process.env.STRIPE_PREMIUM_PRICE_ID) {
    paidPlan = "premium";
  } else if (activePriceId === process.env.STRIPE_PREMIUM_PLUS_PRICE_ID) {
    paidPlan = "premium_plus";
  }
  if (!paidPlan) throw new Error("Subscription contains an unknown price.");

  const oldSubscriptionId = restaurant.stripeSubscriptionId;
  if (
    typeof oldSubscriptionId === "string" &&
    oldSubscriptionId !== subscription.id &&
    ["active", "trialing", "past_due"].includes(String(restaurant.stripeSubscriptionStatus ?? ""))
  ) {
    // Do not overwrite the newer active subscription with an older event.
    console.warn("Ignoring event for a different existing subscription", { eventId });
    return;
  }

  const isPaid = subscription.status === "active";
  const plan = isPaid ? paidPlan : "free";

  // Stripe API 2025-03-31+ exposes period end on subscription items.
  const currentPeriodEnd = stripeDate(subscription.items.data[0]?.current_period_end);
  const cancelAt = stripeDate(subscription.cancel_at);

  // Some Stripe billing configurations use cancel_at without setting
  // cancel_at_period_end. Handle both mechanisms.
  const cancellationScheduled =
    isPaid && (subscription.cancel_at_period_end || cancelAt !== null);
  const accessEndsAt = cancellationScheduled
    ? cancelAt ?? currentPeriodEnd
    : null;

  await restaurants.updateOne(
    { _id: restaurant._id, ownerId: vendorId },
    {
      $set: {
        plan,
        stripeSubscriptionId: subscription.id,
        stripeCustomerId:
          typeof subscription.customer === "string"
            ? subscription.customer
            : subscription.customer.id,
        stripeSubscriptionStatus: subscription.status,
        stripePriceId: activePriceId,
        stripeCancelAtPeriodEnd: cancellationScheduled,
        stripeCurrentPeriodEnd: currentPeriodEnd,
        stripeCancelAt: cancelAt,
        stripeAccessEndsAt: accessEndsAt,
        stripeUpdatedAt: new Date(),
      },
    }
  );

  // Preserve existing transaction event records and idempotent upsert.
  await transactions.updateOne(
    { stripeEventId: eventId },
    {
      $setOnInsert: {
        stripeEventId: eventId,
        provider: "stripe",
        vendorId,
        restaurantId: restaurant._id,
        stripeSubscriptionId: subscription.id,
        eventType: "subscription.synchronized",
        createdAt: new Date(),
      },
      $set: {
        plan,
        subscriptionStatus: subscription.status,
        updatedAt: new Date(),
      },
    },
    { upsert: true }
  );
}

// IMPORTANT: The route must pass express.raw({ type: "application/json" })
// before any express.json() middleware consumes this webhook request body.
export async function stripeWebhook(req: Request, res: Response): Promise<void> {
  const signature = req.headers["stripe-signature"];
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (typeof signature !== "string" || !secret) {
    res.status(400).send("Missing Stripe webhook signature or secret.");
    return;
  }

  const stripe = getStripe();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(req.body, signature, secret);
  } catch (error) {
    console.error("Invalid Stripe webhook signature:", error);
    res.status(400).send("Invalid Stripe webhook signature.");
    return;
  }

  try {
    let subscriptionId: string | null = null;
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.mode === "subscription") {
        subscriptionId =
          typeof session.subscription === "string"
            ? session.subscription
            : session.subscription?.id ?? null;
      }
    } else if (
      event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.deleted" ||
      event.type === "customer.subscription.created"
    ) {
      subscriptionId = (event.data.object as Stripe.Subscription).id;
    }

    if (subscriptionId) await synchronizeSubscription(stripe, subscriptionId, event.id);
    res.json({ received: true });
  } catch (error) {
    console.error("Stripe webhook processing failed:", error);
    // HTTP 500 lets Stripe retry transient failures.
    res.status(500).send("Stripe webhook processing failed.");
  }
}
