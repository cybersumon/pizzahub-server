import { Router } from "express";
import { fromNodeHeaders } from "better-auth/node";

import { auth } from "../lib/auth.js";
import { db } from "../config/database.js";

// User API router।
const router = Router();

// GET /api/users/me

router.get("/me", async (req, res) => {
  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });

    if (!session?.user) {
      res.status(401).json({
        success: false,
        message: "Authentication required.",
      });
      return;
    }

    // Server-side approved admin IDs।
    const adminIds = (process.env.ADMIN_USER_IDS ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);

    const isAdmin = adminIds.includes(session.user.id);

    const restaurant = await db
      .collection("restaurants")
      .findOne({
        ownerId: session.user.id,
      });

    // Default application role Customer।
    let role: "customer" | "vendor" | "admin" = "customer";

    if (isAdmin) {
      role = "admin";
    } else if (restaurant) {
      role = "vendor";
    }

    res.json({
      success: true,
      data: {
        id: session.user.id,
        name: session.user.name,
        email: session.user.email,
        image: session.user.image,
        role,

        canManageMenu:
          role === "vendor" &&
          restaurant?.status === "approved",

        restaurant: restaurant
          ? {
              id: restaurant._id.toString(),
              name: restaurant.name,
              address: restaurant.address,
              phone: restaurant.phone,
              status: restaurant.status,
              plan: restaurant.plan,
            }
          : null,
      },
    });
  } catch (error) {
    console.error("User profile error:", error);

    res.status(500).json({
      success: false,
      message: "Unable to load user profile.",
    });
  }
});

export default router;