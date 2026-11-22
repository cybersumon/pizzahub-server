import { requireActiveUser } from "../middleware/requireActiveUser.js";
import { Router, type Response } from "express";
import { ObjectId, type ClientSession } from "mongodb";
import { fromNodeHeaders } from "better-auth/node";

import { auth } from "../lib/auth.js";
import { db, mongoClient } from "../config/database.js";
import { getEffectivePlan, canAccessFeature } from "../utils/plan-access.js";

const router = Router();

// =============================================
// TYPES
// =============================================

// Menu approval status।
type MenuApprovalStatus =
  | "pending"
  | "approved"
  | "rejected";

interface MenuDocument {
  restaurantId: ObjectId;
  ownerId: string;
  name: string;
  description: string;
  category: string;
  price: number;
  image: string;
  isActive: boolean;

  // Lesson 18: Admin Approval।
  approvalStatus?: MenuApprovalStatus;
  reviewedAt?: Date;
  updatedAt: Date;
  createdAt: Date;
}

// =============================================
// DATABASE COLLECTIONS
// =============================================

const menus = db.collection<MenuDocument>("menuItems");
const restaurants = db.collection("restaurants");

// =============================================
// ALLOWED MENU CATEGORIES
// =============================================

const categories = [
  "Classic Pizzas",
  "Vegetarian Pizzas",
  "Meat Lovers",
  "Specialty / Gourmet Pizzas",
  "Sides & Appetizers",
  "Beverages & Desserts",
];

// =============================================
// CUSTOM API ERROR
// =============================================

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
    throw new ApiError(
      401,
      "Please sign in first."
    );
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
// VALIDATE MENU INPUT
// =============================================

function validateMenu(body: unknown) {
  if (!body || typeof body !== "object") {
    throw new ApiError(
      400,
      "Invalid menu information."
    );
  }

  const {
    name,
    description,
    category,
    price,
    image,
    isActive,
  } = body as Record<string, unknown>;

  // Input validation।
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

  // Only secure ImgBB direct image URLs।
  try {
    const url = new URL(image);

    if (url.protocol !== "https:") {
      throw new Error("HTTPS required");
    }

    if (url.hostname !== "i.ibb.co") {
      throw new Error("Invalid image host");
    }
  } catch {
    throw new ApiError(
      400,
      "Invalid ImgBB image URL."
    );
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
// FREE / PREMIUM / PREMIUM+ PLAN LIMIT
// =============================================

async function checkMenuLimit(
  restaurantId: ObjectId,
  restaurant: {
    plan?: unknown;
    stripeSubscriptionId?: unknown;
    stripeSubscriptionStatus?: unknown;
  },
  session: ClientSession,
  excludedId?: ObjectId
) {
  // Unlimited menu requires a verified active subscription.
  if (canAccessFeature(getEffectivePlan(restaurant), "unlimited_menu")) {
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
  res: Response
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

// =============================================
// PUBLIC MENU
// GET /api/menu/public
// =============================================

router.get("/public", async (_req, res) => {
  try {
    const approvedRestaurants = await restaurants
      .find({ status: "approved" })
      .toArray();

    const restaurantMap = new Map(
      approvedRestaurants.map((restaurant) => [
        restaurant._id.toString(),
        restaurant,
      ])
    );

    const approvedIds = approvedRestaurants.map(
      (restaurant) => restaurant._id
    );

    if (approvedIds.length === 0) {
      res.json({
        success: true,
        data: [],
      });
      return;
    }

    // =========================================
    //APPROVAL FILTER
    // =========================================
    const items = await menus
      .find({
        restaurantId: { $in: approvedIds },
        isActive: true,
        approvalStatus: "approved",
      })
      .sort({ createdAt: -1 })
      .limit(100)
      .toArray();

    // Limit visible free-plan items after a subscription ends.
    const freeVisibleCounts = new Map<string, number>();

    // Preserve the existing frontend data format.
    const data = items.flatMap((item) => {
      const restaurant = restaurantMap.get(
        item.restaurantId.toString()
      );

      if (!restaurant) {
        return [];
      }

      const plan = getEffectivePlan(restaurant);
      const restaurantKey = restaurant._id.toString();

      if (plan === "free") {
        const visibleCount = freeVisibleCounts.get(restaurantKey) ?? 0;
        if (visibleCount >= 3) return [];
        freeVisibleCounts.set(restaurantKey, visibleCount + 1);
      }

      return [
        {
          id: item._id.toString(),
          name: item.name,
          description: item.description,
          category: item.category,
          price: item.price,
          image: item.image,

          // Restaurant information।
          vendorName: restaurant.name,
          location: restaurant.address,
          phone: restaurant.phone ?? "",

          // Existing Premium/ Premium+ UI।
          subscriptionPlan: plan,
          isPremium: plan !== "free",
        },
      ];
    });

    res.json({
      success: true,
      data,
    });
  } catch (error) {
    console.error(
      "Public menu API error:",
      error
    );

    res.status(500).json({
      success: false,
      message: "Unable to load public menu.",
    });
  }
});

router.use(requireActiveUser);

// =============================================
// MY MENU ITEMS
// GET /api/menu/my
// =============================================

router.get("/my", async (req, res) => {
  try {
    const ownerId = await getOwnerId(req.headers);

    const restaurant = await getRestaurant(
      ownerId
    );

    const items = await menus
      .find({
        restaurantId: restaurant._id,
        ownerId,
      })
      .sort({ createdAt: -1 })
      .toArray();

    res.json({
      success: true,
      plan: getEffectivePlan(restaurant),
      data: items,
    });
  } catch (error) {
    sendError(error, res);
  }
});

// =============================================
// ADD MENU ITEM
// POST /api/menu
// =============================================

router.post("/", async (req, res) => {
  try {
    const ownerId = await getOwnerId(req.headers);

    // Validate input।
    const data = validateMenu(req.body);

    // Existing MongoDB transaction।
    const result = await mongoClient.withSession(
      async (session) =>
        session.withTransaction(async () => {
          // Approved restaurant required।
          const restaurant = await getRestaurant(
            ownerId,
            session
          );

          // Preserve existing menu revision logic।
          await restaurants.updateOne(
            { _id: restaurant._id },
            { $inc: { menuRevision: 1 } },
            { session }
          );

          // Free plan limit।
          if (data.isActive) {
            await checkMenuLimit(
              restaurant._id,
              restaurant,
              session
            );
          }

          // ===================================
          // LESSON 18: NEW ITEM = PENDING
          // ===================================

          return menus.insertOne(
            {
              ...data,

              restaurantId: restaurant._id,
              ownerId,

              approvalStatus: "pending",

              createdAt: new Date(),
              updatedAt: new Date(),
            },
            { session }
          );
        })
    );

    res.status(201).json({
      success: true,
      message:
        "Menu item submitted for admin approval.",
      id: result.insertedId.toString(),
      approvalStatus: "pending",
    });
  } catch (error) {
    sendError(error, res);
  }
});

// =============================================
// UPDATE MENU ITEM
// PATCH /api/menu/:id
// =============================================

router.patch("/:id", async (req, res) => {
  try {
    const ownerId = await getOwnerId(req.headers);
    const id = req.params.id;

    // MongoDB ObjectId validation।
    if (
      typeof id !== "string" ||
      !ObjectId.isValid(id)
    ) {
      throw new ApiError(
        400,
        "Invalid menu item ID."
      );
    }

    const menuId = new ObjectId(id);

    // Input validate।
    const data = validateMenu(req.body);

    // Existing transaction logic।
    await mongoClient.withSession(
      async (session) => {
        await session.withTransaction(async () => {
          const restaurant =
            await getRestaurant(
              ownerId,
              session
            );

          await restaurants.updateOne(
            { _id: restaurant._id },
            { $inc: { menuRevision: 1 } },
            { session }
          );

          // Ownership verification।
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

          // Free plan active limit।
          if (data.isActive) {
            await checkMenuLimit(
              restaurant._id,
              restaurant,
              session,
              menuId
            );
          }

          // =================================
          // LESSON 18: EDIT = PENDING
          // =================================

          await menus.updateOne(
            filter,
            {
              $set: {
                ...data,

                approvalStatus: "pending",
                updatedAt: new Date(),
              },
              $unset: {
                reviewedAt: "",
              },
            },
            { session }
          );
        });
      }
    );

    res.json({
      success: true,
      message:
        "Menu item updated and submitted for admin approval.",
      approvalStatus: "pending",
    });
  } catch (error) {
    sendError(error, res);
  }
});

// =============================================
// DELETE MENU ITEM
// DELETE /api/menu/:id
// =============================================

router.delete("/:id", async (req, res) => {
  try {
    const ownerId = await getOwnerId(req.headers);

    const restaurant = await getRestaurant(
      ownerId
    );

    const id = req.params.id;

    if (
      typeof id !== "string" ||
      !ObjectId.isValid(id)
    ) {
      throw new ApiError(
        400,
        "Invalid menu item ID."
      );
    }

    const result = await menus.deleteOne({
      _id: new ObjectId(id),
      restaurantId: restaurant._id,
      ownerId,
    });

    if (result.deletedCount === 0) {
      throw new ApiError(
        404,
        "Menu item not found."
      );
    }

    res.json({
      success: true,
      message:
        "Pizza deleted successfully.",
    });
  } catch (error) {
    sendError(error, res);
  }
});

export default router;
