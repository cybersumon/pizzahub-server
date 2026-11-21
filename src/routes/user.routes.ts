import { Router } from "express";
import { fromNodeHeaders } from "better-auth/node";

import { auth } from "../lib/auth.js";
import { db } from "../config/database.js";

// User API router।
const router = Router();

// ============================================
// GET /api/users/me
// Current authenticated user-এর profile ও role।
// ============================================

router.get("/me", async (req, res) => {
  try {
    // Better Auth session যাচাই করছি।
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });

    // Login না থাকলে access দেওয়া হবে না।
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

    // Current user Admin কি না যাচাই।
    const isAdmin = adminIds.includes(session.user.id);

    // Current user-এর restaurant খুঁজছি।
    const restaurant = await db
      .collection("restaurants")
      .findOne({
        ownerId: session.user.id,
      });

    // Default application role Customer।
    let role: "customer" | "vendor" | "admin" = "customer";

    // Admin permission সবচেয়ে বেশি priority পাবে।
    if (isAdmin) {
      role = "admin";
    } else if (restaurant) {
      // Restaurant account-এর dashboard role।
      // Approved না হলে menu management permission পাবে না।
      role = "vendor";
    }

    // Backend থেকে verified profile পাঠাচ্ছি।
    res.json({
      success: true,
      data: {
        id: session.user.id,
        name: session.user.name,
        email: session.user.email,
        image: session.user.image,
        role,

        // Approved vendor হলেই menu manage করতে পারবে।
        canManageMenu:
          role === "vendor" &&
          restaurant?.status === "approved",

        // Restaurant না থাকলে null।
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