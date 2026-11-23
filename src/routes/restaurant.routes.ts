
import { Router } from "express";
import { ObjectId } from "mongodb";
import { fromNodeHeaders } from "better-auth/node";

import { auth } from "../lib/auth.js";
import { db } from "../config/database.js";
import { requireActiveUser } from "../middleware/requireActiveUser.js";

// ============================================
// PIZZAHUB RESTAURANT ROUTES
// ============================================

type RestaurantStatus = "pending" | "approved" | "rejected";
type RestaurantPlan = "free" | "premium" | "premium_plus";

interface RestaurantDocument {
  ownerId: string;
  name: string;
  address: string;
  phone: string;
  description: string;
  logo?: string | null;
  status: RestaurantStatus;
  plan: RestaurantPlan;
  createdAt: Date;
  updatedAt?: Date;
}

interface RestaurantInput {
  name: string;
  address: string;
  phone: string;
  description: string;
  logo?: string | null;
}

const router = Router();

const restaurants =
  db.collection<RestaurantDocument>("restaurants");

// All restaurant endpoints require an active account.
router.use(requireActiveUser);

// ============================================
// AUTHENTICATED USER HELPER
// ============================================

async function getAuthenticatedUserId(
  headers: Parameters<typeof fromNodeHeaders>[0]
): Promise<string | null> {
  const session = await auth.api.getSession({
    headers: fromNodeHeaders(headers),
  });

  const userId = session?.user?.id;

  if (!userId || !ObjectId.isValid(userId)) {
    return null;
  }

  return userId;
}

// ============================================
// RESTAURANT DATA VALIDATION
// ============================================

function validateRestaurantInput(
  body: unknown
):
  | { success: true; data: RestaurantInput }
  | { success: false; message: string } {
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body)
  ) {
    return {
      success: false,
      message: "Invalid restaurant information.",
    };
  }

  const input = body as Record<string, unknown>;

  const allowedFields = new Set([
    "name",
    "address",
    "phone",
    "description",
    "logo",
  ]);

  // Do not allow clients to change ownership or billing fields.
  for (const field of Object.keys(input)) {
    if (!allowedFields.has(field)) {
      return {
        success: false,
        message: `Field "${field}" cannot be updated.`,
      };
    }
  }

  const { name, address, phone, description } = input;

  if (
    typeof name !== "string" ||
    typeof address !== "string" ||
    typeof phone !== "string" ||
    typeof description !== "string"
  ) {
    return {
      success: false,
      message: "All restaurant information must be valid.",
    };
  }

  const cleanName = name.trim();
  const cleanAddress = address.trim();
  const cleanPhone = phone.trim();
  const cleanDescription = description.trim();

  if (cleanName.length < 3 || cleanName.length > 120) {
    return {
      success: false,
      message: "Restaurant name must contain 3 to 120 characters.",
    };
  }

  if (
    cleanAddress.length < 5 ||
    cleanAddress.length > 250
  ) {
    return {
      success: false,
      message: "Address must contain 5 to 250 characters.",
    };
  }

  if (!/^\+?[0-9\s-]{10,20}$/.test(cleanPhone)) {
    return {
      success: false,
      message: "Please enter a valid phone number.",
    };
  }

  if (cleanDescription.length > 1000) {
    return {
      success: false,
      message: "Description cannot exceed 1000 characters.",
    };
  }

  let logo: string | null | undefined;

  if (input.logo !== undefined) {
    if (input.logo === null || input.logo === "") {
      logo = null;
    } else if (typeof input.logo === "string") {
      try {
        const parsed = new URL(input.logo.trim());

        // Accept direct ImgBB image links only.
        if (
          parsed.protocol !== "https:" ||
          parsed.hostname !== "i.ibb.co" ||
          input.logo.length > 2048
        ) {
          return {
            success: false,
            message: "Please provide a valid ImgBB image URL.",
          };
        }

        logo = parsed.toString();
      } catch {
        return {
          success: false,
          message: "Invalid restaurant logo URL.",
        };
      }
    } else {
      return {
        success: false,
        message: "Invalid restaurant logo.",
      };
    }
  }

  return {
    success: true,
    data: {
      name: cleanName,
      address: cleanAddress,
      phone: cleanPhone,
      description: cleanDescription,
      ...(logo !== undefined ? { logo } : {}),
    },
  };
}

// ============================================
// GET MY RESTAURANT
// GET /api/restaurants/me
// ============================================

router.get("/me", async (req, res) => {
  try {
    const userId = await getAuthenticatedUserId(req.headers);

    if (!userId) {
      res.status(401).json({
        success: false,
        message: "Authentication required.",
      });
      return;
    }

    const restaurant = await restaurants.findOne({
      ownerId: userId,
    });

    res.status(200).json({
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

// ============================================
// REGISTER RESTAURANT
// POST /api/restaurants
// ============================================

router.post("/", async (req, res) => {
  try {
    const userId = await getAuthenticatedUserId(req.headers);

    if (!userId) {
      res.status(401).json({
        success: false,
        message: "Authentication required.",
      });
      return;
    }

    const validation = validateRestaurantInput(req.body);

    if (!validation.success) {
      res.status(400).json({
        success: false,
        message: validation.message,
      });
      return;
    }

    const existing = await restaurants.findOne({
      ownerId: userId,
    });

    if (existing) {
      res.status(409).json({
        success: false,
        message: "You have already registered a restaurant.",
      });
      return;
    }

    const restaurant: RestaurantDocument = {
      ownerId: userId,
      ...validation.data,
      status: "pending",
      plan: "free",
      createdAt: new Date(),
      updatedAt: new Date(),
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

// ============================================
// UPDATE MY RESTAURANT
// PATCH /api/restaurants/me
// ============================================

router.patch("/me", async (req, res) => {
  try {
    const userId = await getAuthenticatedUserId(req.headers);

    if (!userId) {
      res.status(401).json({
        success: false,
        message: "Authentication required.",
      });
      return;
    }

    const validation = validateRestaurantInput(req.body);

    if (!validation.success) {
      res.status(400).json({
        success: false,
        message: validation.message,
      });
      return;
    }

    // Only the logged-in owner can update this restaurant.
    const updated = await restaurants.findOneAndUpdate(
      {
        ownerId: userId,
      },
      {
        $set: {
          ...validation.data,
          updatedAt: new Date(),
        },
      },
      {
        returnDocument: "after",
      }
    );

    if (!updated) {
      res.status(404).json({
        success: false,
        message: "Restaurant not found.",
      });
      return;
    }

    res.status(200).json({
      success: true,
      message: "Restaurant profile updated successfully.",
      data: {
        ...updated,
        _id: updated._id.toString(),
      },
    });
  } catch (error) {
    console.error("Restaurant update error:", error);

    res.status(500).json({
      success: false,
      message: "Unable to update restaurant.",
    });
  }
});

export default router;
