import { Router } from "express";
import { ObjectId, type ClientSession } from "mongodb";
import { fromNodeHeaders } from "better-auth/node";

import { auth } from "../lib/auth.js";
import { db, mongoClient } from "../config/database.js";

const router = Router();

interface MenuDocument {
  restaurantId: ObjectId;
  ownerId: string;
  name: string;
  description: string;
  category: string;
  price: number;
  image: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// MongoDB collections।
const menus = db.collection<MenuDocument>("menuItems");
const restaurants = db.collection("restaurants");

const categories = [
  "Classic Pizzas",
  "Vegetarian Pizzas",
  "Meat Lovers",
  "Specialty / Gourmet Pizzas",
  "Sides & Appetizers",
  "Beverages & Desserts",
];

// Custom API error।
class ApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

// =============================================
// AUTHENTICATED USER CHECK
// =============================================

async function getOwnerId(
  headers: Parameters<typeof fromNodeHeaders>[0]
) {
  const session = await auth.api.getSession({
    headers: fromNodeHeaders(headers),
  });

  if (!session?.user) {
    throw new ApiError(401, "Please sign in first.");
  }

  return session.user.id;
}

// =============================================
// APPROVED RESTAURANT CHECK
// =============================================

async function getRestaurant(
  ownerId: string,
  session?: ClientSession
) {
  const restaurant = await restaurants.findOne(
    {
      ownerId,
      status: "approved",
    },
    { session }
  );

  if (!restaurant) {
    throw new ApiError(
      403,
      "An approved restaurant is required."
    );
  }

  return restaurant;
}

// =============================================
// MENU INPUT VALIDATION
// =============================================

function validateMenu(body: unknown) {
  if (!body || typeof body !== "object") {
    throw new ApiError(400, "Invalid menu information.");
  }

  const {
    name,
    description,
    category,
    price,
    image,
    isActive,
  } = body as Record<string, unknown>;

  if (
    typeof name !== "string" ||
    name.trim().length < 2 ||
    name.length > 120 ||
    typeof description !== "string" ||
    description.length > 1000 ||
    typeof category !== "string" ||
    !categories.includes(category) ||
    typeof price !== "number" ||
    !Number.isFinite(price) ||
    price <= 0 ||
    price > 100000 ||
    typeof image !== "string" ||
    image.length > 2048 ||
    typeof isActive !== "boolean"
  ) {
    throw new ApiError(
      400,
      "Please provide valid pizza information."
    );
  }
  try {
    const url = new URL(image);

    if (url.protocol !== "https:") {
      throw new Error("HTTPS required");
    }

    if (url.hostname !== "i.ibb.co") {
      throw new Error("Invalid image host");
    }
  } catch {
    throw new ApiError(400, "Invalid ImgBB image URL.");
  }

  return {
    name: name.trim(),
    description: description.trim(),
    category,
    price,
    image,
    isActive,
  };
}

// =============================================
// SUBSCRIPTION LIMIT CHECK
// =============================================

async function checkMenuLimit(
  restaurantId: ObjectId,
  plan: unknown,
  session: ClientSession,
  excludedId?: ObjectId
) {
  if (plan === "premium" || plan === "premium_plus") {
    return;
  }

  const activeCount = await menus.countDocuments(
    {
      restaurantId,
      isActive: true,

      ...(excludedId
        ? { _id: { $ne: excludedId } }
        : {}),
    },
    { session }
  );

  if (activeCount >= 3) {
    throw new ApiError(
      403,
      "Free plan allows a maximum of 3 active menu items."
    );
  }
}

// =============================================
// ERROR RESPONSE HELPER
// =============================================

function sendError(
  error: unknown,
  res: import("express").Response
) {
  if (error instanceof ApiError) {
    res.status(error.status).json({
      success: false,
      message: error.message,
    });

    return;
  }

  console.error("Menu API error:", error);

  res.status(500).json({
    success: false,
    message: "Unable to process menu request.",
  });
}

// GET /api/menu/my

router.get("/my", async (req, res) => {
  try {
    const ownerId = await getOwnerId(req.headers);
    const restaurant = await getRestaurant(ownerId);

    const items = await menus
      .find({
        restaurantId: restaurant._id,
        ownerId,
      })
      .sort({ createdAt: -1 })
      .toArray();

    res.json({
      success: true,
      plan: restaurant.plan,
      data: items,
    });
  } catch (error) {
    sendError(error, res);
  }
});

// POST /api/menu

router.post("/", async (req, res) => {
  try {
    const ownerId = await getOwnerId(req.headers);
    const data = validateMenu(req.body);

    const result = await mongoClient.withSession(
      async (session) =>
        session.withTransaction(async () => {
          const restaurant = await getRestaurant(
            ownerId,
            session
          );

          await restaurants.updateOne(
            { _id: restaurant._id },
            { $inc: { menuRevision: 1 } },
            { session }
          );

          if (data.isActive) {
            await checkMenuLimit(
              restaurant._id,
              restaurant.plan,
              session
            );
          }

          return menus.insertOne(
            {
              ...data,
              restaurantId: restaurant._id,
              ownerId,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
            { session }
          );
        })
    );

    res.status(201).json({
      success: true,
      message: "Pizza added successfully.",
      id: result.insertedId.toString(),
    });
  } catch (error) {
    sendError(error, res);
  }
});

// PATCH /api/menu/:id

router.patch("/:id", async (req, res) => {
  try {
    const ownerId = await getOwnerId(req.headers);
    const id = req.params.id;

    if (
      typeof id !== "string" ||
      !ObjectId.isValid(id)
    ) {
      throw new ApiError(400, "Invalid menu item ID.");
    }

    const menuId = new ObjectId(id);
    const data = validateMenu(req.body);

    await mongoClient.withSession(async (session) => {
      await session.withTransaction(async () => {
        const restaurant = await getRestaurant(
          ownerId,
          session
        );

        await restaurants.updateOne(
          { _id: restaurant._id },
          { $inc: { menuRevision: 1 } },
          { session }
        );

        const filter = {
          _id: menuId,
          restaurantId: restaurant._id,
          ownerId,
        };

        const existing = await menus.findOne(
          filter,
          { session }
        );

        if (!existing) {
          throw new ApiError(
            404,
            "Menu item not found."
          );
        }

        if (data.isActive) {
          await checkMenuLimit(
            restaurant._id,
            restaurant.plan,
            session,
            menuId
          );
        }

        await menus.updateOne(
          filter,
          {
            $set: {
              ...data,
              updatedAt: new Date(),
            },
          },
          { session }
        );
      });
    });

    res.json({
      success: true,
      message: "Pizza updated successfully.",
    });
  } catch (error) {
    sendError(error, res);
  }
});


// DELETE /api/menu/:id

router.delete("/:id", async (req, res) => {
  try {
    const ownerId = await getOwnerId(req.headers);
    const restaurant = await getRestaurant(ownerId);

    const id = req.params.id;

    if (
      typeof id !== "string" ||
      !ObjectId.isValid(id)
    ) {
      throw new ApiError(400, "Invalid menu item ID.");
    }

    const result = await menus.deleteOne({
      _id: new ObjectId(id),
      restaurantId: restaurant._id,
      ownerId,
    });

    if (result.deletedCount === 0) {
      throw new ApiError(404, "Menu item not found.");
    }

    res.json({
      success: true,
      message: "Pizza deleted successfully.",
    });
  } catch (error) {
    sendError(error, res);
  }
});

export default router;