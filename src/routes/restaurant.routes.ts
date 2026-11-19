import { Router } from "express";
import { fromNodeHeaders } from "better-auth/node";

import { auth } from "../lib/auth.js";
import { db } from "../config/database.js";

interface RestaurantDocument {
  ownerId: string;
  name: string;
  address: string;
  phone: string;
  description: string;
  status: "pending" | "approved" | "rejected";
  plan: "free" | "premium" | "premium_plus";
  createdAt: Date;
}

// Express Router
const router = Router();

// select MongoDB collection 
const restaurants =
  db.collection<RestaurantDocument>("restaurants");

// GET /api/restaurants/me

router.get("/me", async (req, res) => {
  try {
    // Request cookie from Better Auth session 
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });

    if (!session?.user) {
      res.status(401).json({
        success: false,
        message: "Please sign in first.",
      });
      return;
    }

    const restaurant = await restaurants.findOne({
      ownerId: session.user.id,
    });

    res.json({
      success: true,
      data: restaurant,
    });
  } catch (error) {
    console.error("Restaurant lookup error:", error);
    res.status(500).json({
      success: false,
      message: "Unable to load restaurant.",
    });
  }
});

// POST /api/restaurants

router.post("/", async (req, res) => {
  try {
    // Better Auth session validate 
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });

    if (!session?.user) {
      res.status(401).json({
        success: false,
        message: "Please sign in first.",
      });
      return;
    }

    const { name, address, phone, description } = req.body ?? {};

    // Basic input validation।
    if (
      typeof name !== "string" ||
      typeof address !== "string" ||
      typeof phone !== "string" ||
      typeof description !== "string" ||
      name.trim().length < 3 ||
      address.trim().length < 5 ||
      !/^\+?[0-9\s-]{10,20}$/.test(phone.trim()) ||
      name.length > 120 ||
      address.length > 250 ||
      description.length > 1000
    ) {
      res.status(400).json({
        success: false,
        message: "Please provide valid restaurant information.",
      });
      return;
    }

    const existing = await restaurants.findOne({
      ownerId: session.user.id,
    });

    if (existing) {
      res.status(409).json({
        success: false,
        message: "You have already registered a restaurant.",
      });
      return;
    }

    const restaurant: RestaurantDocument = {
      ownerId: session.user.id,
      name: name.trim(),
      address: address.trim(),
      phone: phone.trim(),
      description: description.trim(),
      status: "pending",
      plan: "free",
      createdAt: new Date(),
    };

    const result = await restaurants.insertOne(restaurant);

    res.status(201).json({
      success: true,
      message: "Restaurant registration submitted.",
      data: {
        id: result.insertedId.toString(),
        ...restaurant,
      },
    });
  } catch (error) {
   
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === 11000
    ) {
      res.status(409).json({
        success: false,
        message: "Restaurant already registered.",
      });
      return;
    }

    console.error("Restaurant creation error:", error);

    res.status(500).json({
      success: false,
      message: "Unable to register restaurant.",
    });
  }
});

export default router;