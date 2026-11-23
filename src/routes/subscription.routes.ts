import { Router, type Request, type Response } from "express";
import { fromNodeHeaders } from "better-auth/node";
import Stripe from "stripe";

import { auth } from "../lib/auth.js";
import { db } from "../config/database.js";
import { requireActiveUser } from "../middleware/requireActiveUser.js";
import { getEffectivePlan, canAccessFeature } from "../utils/plan-access.js";

const router = Router();
const restaurants = db.collection("restaurants");
type PaidPlan = "premium" | "premium_plus";
interface CheckoutBody { plan?: unknown }

function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is missing.");
  return new Stripe(key);
}

function getPriceId(plan: PaidPlan): string {
  const priceId = plan === "premium"
    ? process.env.STRIPE_PREMIUM_PRICE_ID
    : process.env.STRIPE_PREMIUM_PLUS_PRICE_ID;
  if (!priceId || !priceId.startsWith("price_")) {
    throw new Error(`Stripe price is not configured for ${plan}.`);
  }
  return priceId;
}

// GET /api/subscriptions/my
router.get("/my", requireActiveUser, async (req: Request, res: Response) => {
  try {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    if (!session?.user?.id) {
      res.status(401).json({ success: false, message: "Authentication required." });
      return;
    }
    const restaurant = await restaurants.findOne({
      ownerId: session.user.id,
      status: "approved",
    });
    if (!restaurant) {
      res.status(403).json({ success: false, message: "An approved vendor restaurant is required." });
      return;
    }
    const plan = getEffectivePlan(restaurant);
    const subscriptionId = typeof restaurant.stripeSubscriptionId === "string"
      ? restaurant.stripeSubscriptionId : null;
    res.status(200).json({
      success: true,
      data: {
        restaurantId: restaurant._id.toString(),
        restaurantName: restaurant.name ?? "",
        plan,
        subscriptionStatus: typeof restaurant.stripeSubscriptionStatus === "string"
          ? restaurant.stripeSubscriptionStatus : "none",
        hasSubscription: subscriptionId !== null,
        stripeSubscriptionId: subscriptionId,
        stripeCustomerId: typeof restaurant.stripeCustomerId === "string"
          ? restaurant.stripeCustomerId : null,
        features: {
          unlimitedMenu: canAccessFeature(plan, "unlimited_menu"),
          premiumDetails: canAccessFeature(plan, "premium_details"),
          premiumPlusDetails: canAccessFeature(plan, "premium_plus_details"),
          tableReservation: canAccessFeature(plan, "table_reservation"),
          orderManagement: true,
          menuManagement: true,
        },
      },
    });
  } catch (error) {
    console.error("Get vendor subscription error:", error);
    res.status(500).json({ success: false, message: "Unable to load subscription information." });
  }
});

// POST /api/subscriptions/checkout
router.post("/checkout", requireActiveUser,
  async (req: Request<object, object, CheckoutBody>, res: Response) => {
    try {
      const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
      if (!session?.user?.id) {
        res.status(401).json({ success: false, message: "Authentication required." });
        return;
      }
      const requestedPlan = req.body?.plan;
      if (requestedPlan !== "premium" && requestedPlan !== "premium_plus") {
        res.status(400).json({ success: false, message: "Invalid subscription plan." });
        return;
      }
      const vendorId = session.user.id;
      const restaurant = await restaurants.findOne({ ownerId: vendorId, status: "approved" });
      if (!restaurant) {
        res.status(403).json({ success: false, message: "An approved vendor restaurant is required." });
        return;
      }
      // Preserve the existing guard against duplicate active subscriptions.
      if (typeof restaurant.stripeSubscriptionId === "string" &&
        ["active", "trialing", "past_due"].includes(String(restaurant.stripeSubscriptionStatus ?? ""))) {
        res.status(409).json({
          success: false,
          message: "A Stripe subscription already exists. Manage your existing subscription first.",
        });
        return;
      }
      const stripe = getStripe();
      const priceId = getPriceId(requestedPlan);
      const clientUrl = process.env.CLIENT_URL || "http://localhost:3000";
      const stripeSession = await stripe.checkout.sessions.create({
        mode: "subscription",
        line_items: [{ price: priceId, quantity: 1 }],
        client_reference_id: restaurant._id.toString(),
        customer_email: session.user.email,
        metadata: { restaurantId: restaurant._id.toString(), vendorId, plan: requestedPlan },
        subscription_data: {
          metadata: { restaurantId: restaurant._id.toString(), vendorId, plan: requestedPlan },
        },
        success_url: `${clientUrl}/dashboard/vendor?subscription=success`,
        cancel_url: `${clientUrl}/dashboard/vendor?subscription=cancelled`,
      });
      if (!stripeSession.url) throw new Error("Stripe did not return a Checkout URL.");
      res.json({ success: true, data: { url: stripeSession.url, sessionId: stripeSession.id } });
    } catch (error) {
      console.error("Stripe Checkout error:", error);
      res.status(500).json({ success: false, message: "Unable to create Stripe Checkout session." });
    }
  }
);

// POST /api/subscriptions/portal
// Create a short-lived, authenticated portal session for the restaurant owner.
router.post("/portal", requireActiveUser, async (req: Request, res: Response) => {
  try {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    if (!session?.user?.id) {
      res.status(401).json({ success: false, message: "Authentication required." });
      return;
    }
    const restaurant = await restaurants.findOne({
      ownerId: session.user.id,
      status: "approved",
    });
    if (!restaurant) {
      res.status(403).json({ success: false, message: "An approved vendor restaurant is required." });
      return;
    }
    const customerId = restaurant.stripeCustomerId;
    if (typeof customerId !== "string" || !customerId.startsWith("cus_") ||
        typeof restaurant.stripeSubscriptionId !== "string") {
      res.status(400).json({ success: false, message: "No existing Stripe subscription found." });
      return;
    }
    const stripe = getStripe();
    const clientUrl = process.env.CLIENT_URL || "http://localhost:3000";
    const portal = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${clientUrl}/dashboard/vendor`,
    });
    res.status(200).json({ success: true, data: { url: portal.url } });
  } catch (error) {
    console.error("Stripe billing portal error:", error);
    res.status(500).json({
      success: false,
      message: "Unable to open billing portal. Verify Stripe Customer Portal configuration and sandbox account.",
    });
  }
});

export default router;
