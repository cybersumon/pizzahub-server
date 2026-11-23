
import type { Request, Response } from "express";
import { ObjectId } from "mongodb";
import Stripe from "stripe";

import { db } from "../config/database.js";

// ============================================
// VERIFIED STRIPE SUBSCRIPTION WEBHOOK
// ============================================

const restaurants = db.collection("restaurants");
const transactions = db.collection("transactions");

type PaidPlan = "premium" | "premium_plus";

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;

  if (!key) {
    throw new Error("STRIPE_SECRET_KEY is missing.");
  }

  return new Stripe(key);
}

async function synchronizeSubscription(
  stripe: Stripe,
  subscriptionId: string,
  eventId: string
) {
  // Always retrieve the current subscription state.
  const subscription =
    await stripe.subscriptions.retrieve(
      subscriptionId
    );

  const restaurantId =
    subscription.metadata.restaurantId;

  const vendorId =
    subscription.metadata.vendorId;

  if (
    !restaurantId ||
    !ObjectId.isValid(restaurantId) ||
    !vendorId
  ) {
    throw new Error(
      "Subscription ownership metadata is missing."
    );
  }

  const restaurant = await restaurants.findOne({
    _id: new ObjectId(restaurantId),
    ownerId: vendorId,
  });

  if (!restaurant) {
    throw new Error(
      "Subscription restaurant not found."
    );
  }

  const items = subscription.items.data;

  const activePriceId =
    items[0]?.price.id;

  // Derive the plan from a server-configured Stripe Price ID.
  let plan: PaidPlan | null = null;

  if (
    activePriceId ===
    process.env.STRIPE_PREMIUM_PRICE_ID
  ) {
    plan = "premium";
  } else if (
    activePriceId ===
    process.env.STRIPE_PREMIUM_PLUS_PRICE_ID
  ) {
    plan = "premium_plus";
  }

  if (!plan) {
    throw new Error(
      "Subscription contains an unknown price."
    );
  }

  // Never activate a plan from a redirect or user request.
  const isPaid =
    subscription.status === "active";

  // Ignore unrelated older subscriptions.
  const currentSubscriptionId =
    restaurant.stripeSubscriptionId;

  if (
    currentSubscriptionId &&
    currentSubscriptionId !== subscription.id &&
    restaurant.stripeSubscriptionStatus === "active"
  ) {
    throw new Error(
      "Restaurant already has another active subscription."
    );
  }

  const nextPlan = isPaid ? plan : "free";

  await restaurants.updateOne(
    {
      _id: restaurant._id,
      ownerId: vendorId,
    },
    {
      $set: {
        plan: nextPlan,
        stripeSubscriptionId:
          subscription.id,
        stripeCustomerId:
          typeof subscription.customer === "string"
            ? subscription.customer
            : subscription.customer.id,
        stripeSubscriptionStatus:
          subscription.status,
        stripePriceId: activePriceId,
        stripeUpdatedAt: new Date(),
      },
    }
  );

  // Upsert prevents duplicate transaction records
  // when Stripe retries the same webhook event.
  await transactions.updateOne(
    {
      stripeEventId: eventId,
    },
    {
      $setOnInsert: {
        stripeEventId: eventId,
        provider: "stripe",
        vendorId,
        restaurantId: restaurant._id,
        stripeSubscriptionId:
          subscription.id,
        eventType:
          "subscription.synchronized",
        createdAt: new Date(),
      },
      $set: {
        plan: nextPlan,
        subscriptionStatus:
          subscription.status,
        updatedAt: new Date(),
      },
    },
    {
      upsert: true,
    }
  );
}

// ============================================
// WEBHOOK ENTRY POINT
// ============================================

export async function stripeWebhook(
  req: Request,
  res: Response
) {
  const signature =
    req.headers["stripe-signature"];

  const secret =
    process.env.STRIPE_WEBHOOK_SECRET;

  if (
    typeof signature !== "string" ||
    !secret
  ) {
    res.status(400).send(
      "Missing Stripe webhook signature or secret."
    );
    return;
  }

  const stripe = getStripe();

  let event: Stripe.Event;

  try {
    // req.body must be the original raw Buffer.
    event = stripe.webhooks.constructEvent(
      req.body,
      signature,
      secret
    );
  } catch (error) {
    console.error(
      "Invalid Stripe webhook signature:",
      error
    );

    res.status(400).send(
      "Invalid Stripe webhook signature."
    );
    return;
  }

  try {
    let subscriptionId: string | null = null;

    if (
      event.type ===
      "checkout.session.completed"
    ) {
      const session =
        event.data.object as Stripe.Checkout.Session;

      if (session.mode === "subscription") {
        subscriptionId =
          typeof session.subscription === "string"
            ? session.subscription
            : session.subscription?.id ?? null;
      }
    }

    if (
      event.type ===
        "customer.subscription.updated" ||
      event.type ===
        "customer.subscription.deleted" ||
      event.type ===
        "customer.subscription.created"
    ) {
      const subscription =
        event.data.object as Stripe.Subscription;

      subscriptionId = subscription.id;
    }

    if (subscriptionId) {
      await synchronizeSubscription(
        stripe,
        subscriptionId,
        event.id
      );
    }

    res.json({
      received: true,
    });
  } catch (error) {
    console.error(
      "Stripe webhook processing failed:",
      error
    );

    // Non-2xx allows Stripe to retry the event.
    res.status(500).send(
      "Stripe webhook processing failed."
    );
  }
}
