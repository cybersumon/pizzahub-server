
import { Router } from "express";
import { ObjectId } from "mongodb";
import { fromNodeHeaders } from "better-auth/node";

import { auth } from "../lib/auth.js";
import { db } from "../config/database.js";
import { getEffectivePlan } from "../utils/plan-access.js";

// ============================================
// PIZZAHUB USER PROFILE ROUTES
// ============================================

const router = Router();

const users = db.collection("user");
const restaurants = db.collection("restaurants");

type UserRole = "customer" | "vendor" | "admin";

// ============================================
// PROTECTED ADMIN IDS
// ============================================

function getProtectedAdminIds(): Set<string> {
  return new Set(
    (process.env.ADMIN_USER_IDS ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean)
  );
}

// ============================================
// RESOLVE USER ROLE
// ============================================

function resolveUserRole(
  userId: string,
  savedRole: unknown,
  hasRestaurant: boolean
): UserRole {
  // Environment-protected admins always remain admins.
  if (getProtectedAdminIds().has(userId)) {
    return "admin";
  }

  // Explicit database roles take priority.
  if (savedRole === "admin") {
    return "admin";
  }

  if (savedRole === "vendor") {
    return "vendor";
  }

  // Existing restaurant owners remain vendors.
  if (hasRestaurant) {
    return "vendor";
  }

  if (savedRole === "customer") {
    return "customer";
  }

  return "customer";
}

// ============================================
// GET CURRENT USER PROFILE
// GET /api/users/me
// ============================================

router.get("/me", async (req, res) => {
  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });

    if (!session?.user?.id) {
      res.status(401).json({
        success: false,
        message: "Authentication required.",
      });
      return;
    }

    const userId = session.user.id;

    if (!ObjectId.isValid(userId)) {
      res.status(401).json({
        success: false,
        message: "Invalid user session.",
      });
      return;
    }

    // Load the latest database user information.
    const user = await users.findOne({
      _id: new ObjectId(userId),
    });

    if (!user) {
      res.status(401).json({
        success: false,
        message: "User account not found.",
      });
      return;
    }

    // Blocked users cannot access their profile.
    if (user.isBlocked === true) {
      res.status(403).json({
        success: false,
        message: "Your account has been blocked.",
        code: "ACCOUNT_BLOCKED",
      });
      return;
    }

    // Look up the restaurant owned by this user.
    const restaurant = await restaurants.findOne({
      ownerId: userId,
    });

    // Resolve the effective application role.
    const role = resolveUserRole(
      userId,
      user.role,
      Boolean(restaurant)
    );

    // Only verified subscriptions receive paid features.
    const plan = restaurant
      ? getEffectivePlan(restaurant)
      : "free";

    const isApproved =
      restaurant?.status === "approved";

    const canManageMenu =
      role === "vendor" && isApproved;

    const canManageOrders =
      role === "vendor" && isApproved;

    res.status(200).json({
      success: true,
      data: {
        id: userId,

        name:
          typeof user.name === "string"
            ? user.name
            : session.user.name,

        email:
          typeof user.email === "string"
            ? user.email
            : session.user.email,

        image:
          typeof user.image === "string"
            ? user.image
            : session.user.image ?? null,

        role,

        canManageMenu,
        canManageOrders,

        // A vendor may need to create a restaurant.
        canCreateRestaurant:
          role === "vendor" && !restaurant,

        restaurant: restaurant
          ? {
              id: restaurant._id.toString(),

              name: restaurant.name,
              address: restaurant.address,
              phone: restaurant.phone,

              description:
                restaurant.description ?? "",

              logo:
                restaurant.logo ?? null,

              status: restaurant.status,

              plan,
            }
          : null,
      },
    });
  } catch (error) {
    console.error(
      "User profile error:",
      error
    );

    res.status(500).json({
      success: false,
      message: "Unable to load user profile.",
    });
  }
});

export default router;
