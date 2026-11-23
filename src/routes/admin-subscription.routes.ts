
import {
  Router,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { ObjectId } from "mongodb";
import { fromNodeHeaders } from "better-auth/node";

import { auth } from "../lib/auth.js";
import { db } from "../config/database.js";
import { getEffectivePlan } from "../utils/plan-access.js";

// ============================================
// ADMIN SUBSCRIPTION MANAGEMENT
// ============================================

const router = Router();

const restaurants = db.collection("restaurants");
const users = db.collection("user");

// ============================================
// ADMIN AUTHORIZATION
// ============================================

async function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });

    const userId = session?.user?.id;

    if (!userId || !ObjectId.isValid(userId)) {
      res.status(401).json({
        success: false,
        message: "Authentication required.",
      });
      return;
    }

    const user = await users.findOne({
      _id: new ObjectId(userId),
    });

    if (!user || user.isBlocked === true) {
      res.status(403).json({
        success: false,
        message: "Account is unavailable.",
      });
      return;
    }

    const protectedAdminIds = new Set(
      (process.env.ADMIN_USER_IDS ?? "")
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean)
    );

    const isAdmin =
      protectedAdminIds.has(userId) ||
      user.role === "admin";

    if (!isAdmin) {
      res.status(403).json({
        success: false,
        message: "Admin access required.",
      });
      return;
    }

    next();
  } catch (error) {
    console.error(
      "Admin subscription authorization error:",
      error
    );

    res.status(500).json({
      success: false,
      message: "Unable to verify admin access.",
    });
  }
}

router.use(requireAdmin);

// ============================================
// GET ALL RESTAURANT SUBSCRIPTIONS
// GET /api/admin/subscriptions
// ============================================

router.get("/", async (_req, res) => {
  try {
    const restaurantRecords = await restaurants
      .find({})
      .sort({ createdAt: -1 })
      .limit(500)
      .toArray();

    const ownerIds = [
      ...new Set(
        restaurantRecords
          .map((restaurant) =>
            String(restaurant.ownerId ?? "")
          )
          .filter((id) => ObjectId.isValid(id))
      ),
    ].map((id) => new ObjectId(id));

    const ownerRecords = await users
      .find(
        { _id: { $in: ownerIds } },
        {
          projection: {
            name: 1,
            email: 1,
          },
        }
      )
      .toArray();

    const ownerMap = new Map(
      ownerRecords.map((owner) => [
        owner._id.toString(),
        owner,
      ])
    );

    const data = restaurantRecords.map((restaurant) => {
      const ownerId = String(
        restaurant.ownerId ?? ""
      );

      const owner = ownerMap.get(ownerId);

      // Derive the effective plan from verified Stripe data.
      const plan = getEffectivePlan(restaurant);

      const subscriptionStatus =
        typeof restaurant.stripeSubscriptionStatus ===
        "string"
          ? restaurant.stripeSubscriptionStatus
          : "none";

      return {
        restaurantId: restaurant._id.toString(),

        restaurantName: String(
          restaurant.name ?? ""
        ),

        restaurantStatus: String(
          restaurant.status ?? "pending"
        ),

        plan,
        subscriptionStatus,

        owner: {
          id: ownerId,
          name: String(owner?.name ?? "Unknown"),
          email: String(owner?.email ?? ""),
        },

        stripeCustomerId:
          typeof restaurant.stripeCustomerId ===
          "string"
            ? restaurant.stripeCustomerId
            : null,

        stripeSubscriptionId:
          typeof restaurant.stripeSubscriptionId ===
          "string"
            ? restaurant.stripeSubscriptionId
            : null,

        stripePriceId:
          typeof restaurant.stripePriceId ===
          "string"
            ? restaurant.stripePriceId
            : null,

        updatedAt:
          restaurant.stripeUpdatedAt ??
          restaurant.updatedAt ??
          restaurant.createdAt ??
          null,
      };
    });

    const stats = {
      totalRestaurants: data.length,

      free: data.filter(
        (item) => item.plan === "free"
      ).length,

      premium: data.filter(
        (item) => item.plan === "premium"
      ).length,

      premiumPlus: data.filter(
        (item) => item.plan === "premium_plus"
      ).length,

      activeSubscriptions: data.filter(
        (item) =>
          item.subscriptionStatus === "active"
      ).length,
    };

    res.status(200).json({
      success: true,
      total: data.length,
      stats,
      data,
    });
  } catch (error) {
    console.error(
      "Admin subscription list error:",
      error
    );

    res.status(500).json({
      success: false,
      message:
        "Unable to load restaurant subscriptions.",
    });
  }
});

export default router;
