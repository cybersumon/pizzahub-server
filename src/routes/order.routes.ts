
import { Router, type Request, type Response } from "express";
import {
  ObjectId,
  type UpdateFilter,
  type WithId,
} from "mongodb";
import { fromNodeHeaders } from "better-auth/node";

import { auth } from "../lib/auth.js";
import { db } from "../config/database.js";
import { requireActiveUser } from "../middleware/requireActiveUser.js";

// ============================================
// PIZZAHUB — SECURE ORDER MANAGEMENT
// LESSON 19 — STEP 7B
// ============================================

const router = Router();

// ============================================
// DATABASE COLLECTIONS
// ============================================

const orders = db.collection<OrderDocument>("orders");
const menus = db.collection("menuItems");
const restaurants = db.collection("restaurants");
const users = db.collection("user");

// ============================================
// TYPES
// ============================================

type OrderStatus =
  | "pending"
  | "accepted"
  | "rejected"
  | "cancelled";

type AppRole = "customer" | "vendor" | "admin";

interface OrderDocument {
  customerId: string;

  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;

  vendorId: string;
  restaurantId: ObjectId;
  menuItemId: ObjectId;

  itemName: string;
  itemImage: string;
  itemPrice: number;
  restaurantName: string;

  deliveryDate: Date;
  deliveryAddress: string;
  message: string;

  status: OrderStatus;
  activeOrderKey?: string;

  createdAt: Date;
  updatedAt: Date;
  reviewedAt?: Date;
  cancelledAt?: Date;
}

interface AuthenticatedIdentity {
  id: string;
  role: AppRole;
  name: string;
  email: string;
}

// ============================================
// STANDARD API ERROR
// ============================================

function sendError(
  res: Response,
  statusCode: number,
  message: string,
  code?: string
) {
  res.status(statusCode).json({
    success: false,
    message,
    ...(code ? { code } : {}),
  });
}

// ============================================
// BETTER AUTH IDENTITY
// ============================================

async function getIdentity(
  req: Request
): Promise<AuthenticatedIdentity | null> {
  // Read the authenticated Better Auth session.
  const session = await auth.api.getSession({
    headers: fromNodeHeaders(req.headers),
  });

  const userId = session?.user?.id;

  if (!userId || !ObjectId.isValid(userId)) {
    return null;
  }

  // Read the user directly from the database.
  const user = await users.findOne({
    _id: new ObjectId(userId),
  });

  if (!user || user.isBlocked === true) {
    return null;
  }

  const name =
    typeof user.name === "string"
      ? user.name.trim()
      : "";

  const email =
    typeof user.email === "string"
      ? user.email.trim()
      : "";

  if (!name || !email) {
    return null;
  }

  // Detect administrators using the existing admin allowlist.
  const adminIds = (process.env.ADMIN_USER_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  const isAdmin =
    adminIds.includes(userId) ||
    user.role === "admin";

  if (isAdmin) {
    return {
      id: userId,
      role: "admin",
      name,
      email,
    };
  }

  // PizzaHub vendors may be identified through restaurant
  // ownership even when the auth user has no role field.
  const ownedRestaurant = await restaurants.findOne(
    {
      ownerId: userId,
    },
    {
      projection: {
        _id: 1,
      },
    }
  );

  const isVendor =
    Boolean(ownedRestaurant) ||
    user.role === "vendor";

  return {
    id: userId,
    role: isVendor ? "vendor" : "customer",
    name,
    email,
  };
}

// ============================================
// ROLE AUTHORIZATION
// ============================================

async function requireRole(
  req: Request,
  res: Response,
  role: AppRole
): Promise<AuthenticatedIdentity | null> {
  const identity = await getIdentity(req);

  if (!identity) {
    sendError(
      res,
      401,
      "Authentication required or account unavailable.",
      "AUTH_REQUIRED"
    );
    return null;
  }

  if (identity.role !== role) {
    sendError(
      res,
      403,
      `${role === "customer" ? "Customer" : "Vendor"} access required.`,
      "ROLE_FORBIDDEN"
    );
    return null;
  }

  return identity;
}

// ============================================
// BANGLADESH MOBILE VALIDATION
// ============================================

function normalizeBDPhone(
  value: unknown
): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const cleaned = value
    .trim()
    .replace(/[\s()-]/g, "");

  let phone = cleaned;

  if (cleaned.startsWith("+880")) {
    phone = `0${cleaned.slice(4)}`;
  } else if (cleaned.startsWith("880")) {
    phone = `0${cleaned.slice(3)}`;
  }

  return /^01[3-9]\d{8}$/.test(phone)
    ? phone
    : null;
}

// ============================================
// DELIVERY DATE VALIDATION
// ============================================

function parseDeliveryDate(
  value: unknown
): Date | null {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
    return null;
  }

  const date = new Date(`${value}T00:00:00.000Z`);

  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    return null;
  }

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const getPart = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";

  const today = [
    getPart("year"),
    getPart("month"),
    getPart("day"),
  ].join("-");

  if (value < today) {
    return null;
  }

  return date;
}

// ============================================
// ORDER RESPONSE SERIALIZER
// ============================================

function serializeOrder(
  order: WithId<OrderDocument>
) {
  return {
    id: order._id.toString(),

    customerId: order.customerId,
    customerName: order.customerName ?? "Not Provided",
    customerEmail: order.customerEmail ?? "Not Provided",
    customerPhone: order.customerPhone ?? "Not Provided",

    vendorId: order.vendorId,
    restaurantId: order.restaurantId.toString(),
    menuItemId: order.menuItemId.toString(),

    itemName: order.itemName,
    itemImage: order.itemImage,
    itemPrice: order.itemPrice,
    restaurantName: order.restaurantName,

    deliveryDate: order.deliveryDate
      .toISOString()
      .slice(0, 10),

    deliveryAddress: order.deliveryAddress,
    message: order.message,
    status: order.status,

    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    reviewedAt: order.reviewedAt ?? null,
    cancelledAt: order.cancelledAt ?? null,
  };
}

// ============================================
// UNIQUE ACTIVE ORDER INDEX
// ============================================

let indexPromise: Promise<string> | null = null;

async function ensureOrderIndex() {
  if (!indexPromise) {
    indexPromise = orders
      .createIndex(
        {
          activeOrderKey: 1,
        },
        {
          name: "unique_active_customer_order",
          unique: true,
          partialFilterExpression: {
            activeOrderKey: {
              $type: "string",
            },
          },
        }
      )
      .catch((error: unknown) => {
        indexPromise = null;
        throw error;
      });
  }

  await indexPromise;
}

// ============================================
// ACTIVE ACCOUNT PROTECTION
// ============================================

// Existing middleware protects all order endpoints.
router.use(requireActiveUser);

// ============================================
// CUSTOMER — CREATE ORDER
// POST /api/orders
// ============================================

router.post("/", async (req, res) => {
  try {
    // Allow customers only.
    const customer = await requireRole(
      req,
      res,
      "customer"
    );

    if (!customer) return;

    const {
      menuItemId,
      customerPhone,
      deliveryDate,
      deliveryAddress,
      message,
    }: {
      menuItemId?: unknown;
      customerPhone?: unknown;
      deliveryDate?: unknown;
      deliveryAddress?: unknown;
      message?: unknown;
    } = req.body ?? {};

    // Validate the menu item ID.
    if (
      typeof menuItemId !== "string" ||
      !ObjectId.isValid(menuItemId)
    ) {
      sendError(res, 400, "Invalid menu item ID.");
      return;
    }

    // Validate the customer's phone number.
    const normalizedPhone = normalizeBDPhone(
      customerPhone
    );

    if (!normalizedPhone) {
      sendError(
        res,
        400,
        "Enter a valid Bangladeshi mobile number.",
        "INVALID_CUSTOMER_PHONE"
      );
      return;
    }

    // Validate the requested delivery date.
    const parsedDate = parseDeliveryDate(
      deliveryDate
    );

    if (!parsedDate) {
      sendError(
        res,
        400,
        "Select a valid delivery date. Past dates are not allowed."
      );
      return;
    }

    // Validate the delivery address.
    if (
      typeof deliveryAddress !== "string" ||
      deliveryAddress.trim().length < 10 ||
      deliveryAddress.trim().length > 500
    ) {
      sendError(
        res,
        400,
        "Delivery address must contain 10 to 500 characters."
      );
      return;
    }

    // Validate special instructions.
    if (
      message !== undefined &&
      message !== null &&
      typeof message !== "string"
    ) {
      sendError(
        res,
        400,
        "Special instructions must be text."
      );
      return;
    }

    const instructions =
      typeof message === "string"
        ? message.trim()
        : "";

    if (instructions.length > 1000) {
      sendError(
        res,
        400,
        "Special instructions cannot exceed 1000 characters."
      );
      return;
    }

    // Only approved, active menu items can be ordered.
    const item = await menus.findOne({
      _id: new ObjectId(menuItemId),
      approvalStatus: "approved",
      isActive: true,
    });

    if (!item) {
      sendError(
        res,
        404,
        "This menu item is unavailable for ordering."
      );
      return;
    }

    if (
      !(item.restaurantId instanceof ObjectId)
    ) {
      sendError(
        res,
        409,
        "Menu item has no valid restaurant."
      );
      return;
    }

    // The restaurant must also be approved.
    const restaurant = await restaurants.findOne({
      _id: item.restaurantId,
      status: "approved",
    });

    if (!restaurant) {
      sendError(
        res,
        409,
        "This restaurant is not accepting orders."
      );
      return;
    }

    const vendorId = String(
      restaurant.ownerId ?? ""
    );

    if (!vendorId) {
      sendError(
        res,
        409,
        "Restaurant owner information is missing."
      );
      return;
    }

    // Prevent a user from ordering from their own restaurant.
    if (vendorId === customer.id) {
      sendError(
        res,
        403,
        "You cannot order from your own restaurant."
      );
      return;
    }

    // Validate the item price on the server.
    if (
      typeof item.price !== "number" ||
      !Number.isFinite(item.price) ||
      item.price <= 0
    ) {
      sendError(
        res,
        409,
        "This item has an invalid price."
      );
      return;
    }

    const dateKey = parsedDate
      .toISOString()
      .slice(0, 10);

    // Prevent duplicate active orders for the same item/date.
    const activeOrderKey = [
      customer.id,
      item._id.toString(),
      dateKey,
    ].join(":");

    await ensureOrderIndex();

    const now = new Date();

    // Keep customer and menu snapshots in the order.
    const order: OrderDocument = {
      customerId: customer.id,
      customerName: customer.name,
      customerEmail: customer.email,
      customerPhone: normalizedPhone,

      vendorId,
      restaurantId: restaurant._id,
      menuItemId: item._id,

      itemName: String(item.name ?? ""),
      itemImage: String(item.image ?? ""),
      itemPrice: item.price,
      restaurantName: String(restaurant.name ?? ""),

      deliveryDate: parsedDate,
      deliveryAddress: deliveryAddress.trim(),
      message: instructions,

      status: "pending",
      activeOrderKey,

      createdAt: now,
      updatedAt: now,
    };

    const result = await orders.insertOne(order);

    res.status(201).json({
      success: true,
      message: "Order placed successfully.",
      data: serializeOrder({
        ...order,
        _id: result.insertedId,
      }),
    });
  } catch (error) {
    // MongoDB duplicate key protection.
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === 11000
    ) {
      sendError(
        res,
        409,
        "You already have an active order for this item and delivery date.",
        "DUPLICATE_ACTIVE_ORDER"
      );
      return;
    }

    console.error("Create order failed:", error);

    sendError(
      res,
      500,
      "Unable to place order."
    );
  }
});

// ============================================
// CUSTOMER — MY ORDERS
// GET /api/orders/my
// ============================================

router.get("/my", async (req, res) => {
  try {
    // Reject vendors and administrators.
    const customer = await requireRole(
      req,
      res,
      "customer"
    );

    if (!customer) return;

    // Restrict results to the logged-in customer.
    const records = await orders
      .find({
        customerId: customer.id,
      })
      .sort({
        createdAt: -1,
      })
      .limit(200)
      .toArray();

    res.json({
      success: true,
      total: records.length,
      data: records.map(serializeOrder),
    });
  } catch (error) {
    console.error(
      "Customer orders failed:",
      error
    );

    sendError(
      res,
      500,
      "Unable to load your orders."
    );
  }
});

// ============================================
// VENDOR — INCOMING ORDERS
// GET /api/orders/vendor
// ============================================

router.get("/vendor", async (req, res) => {
  try {
    // Reject customers and administrators.
    const vendor = await requireRole(
      req,
      res,
      "vendor"
    );

    if (!vendor) return;

    // Retrieve restaurant IDs owned by this vendor.
    const ownedRestaurants = await restaurants
      .find({
        ownerId: vendor.id,
        status: "approved",
      })
      .project({
        _id: 1,
      })
      .toArray();

    const restaurantIds = ownedRestaurants.map(
      (restaurant) => restaurant._id
    );

    if (restaurantIds.length === 0) {
      res.json({
        success: true,
        total: 0,
        data: [],
      });
      return;
    }

    // Return only orders for the vendor's own restaurants.
    const records = await orders
      .find({
        vendorId: vendor.id,
        restaurantId: {
          $in: restaurantIds,
        },
      })
      .sort({
        createdAt: -1,
      })
      .limit(200)
      .toArray();

    res.json({
      success: true,
      total: records.length,
      data: records.map(serializeOrder),
    });
  } catch (error) {
    console.error(
      "Vendor orders failed:",
      error
    );

    sendError(
      res,
      500,
      "Unable to load incoming orders."
    );
  }
});

// ============================================
// CUSTOMER — CANCEL PENDING ORDER
// PATCH /api/orders/:id/cancel
// ============================================

router.patch("/:id/cancel", async (req, res) => {
  try {
    // Only customers can cancel their own orders.
    const customer = await requireRole(
      req,
      res,
      "customer"
    );

    if (!customer) return;

    const id = req.params.id;

    if (
      typeof id !== "string" ||
      !ObjectId.isValid(id)
    ) {
      sendError(res, 400, "Invalid order ID.");
      return;
    }

    const now = new Date();

    // Atomically cancel only an owned, pending order.
    const result = await orders.findOneAndUpdate(
      {
        _id: new ObjectId(id),
        customerId: customer.id,
        status: "pending",
      },
      {
        $set: {
          status: "cancelled",
          cancelledAt: now,
          updatedAt: now,
        },
        $unset: {
          activeOrderKey: "",
        },
      },
      {
        returnDocument: "after",
      }
    );

    if (!result) {
      sendError(
        res,
        409,
        "Order not found, not owned by you, or no longer pending."
      );
      return;
    }

    res.json({
      success: true,
      message: "Order cancelled successfully.",
      data: serializeOrder(result),
    });
  } catch (error) {
    console.error(
      "Cancel order failed:",
      error
    );

    sendError(
      res,
      500,
      "Unable to cancel order."
    );
  }
});

// ============================================
// VENDOR — ACCEPT OR REJECT ORDER
// PATCH /api/orders/:id/status
// ============================================

router.patch("/:id/status", async (req, res) => {
  try {
    // Only vendors can manage order statuses.
    const vendor = await requireRole(
      req,
      res,
      "vendor"
    );

    if (!vendor) return;

    const id = req.params.id;

    if (
      typeof id !== "string" ||
      !ObjectId.isValid(id)
    ) {
      sendError(res, 400, "Invalid order ID.");
      return;
    }

    const requestedStatus: unknown =
      req.body?.status;

    if (
      requestedStatus !== "accepted" &&
      requestedStatus !== "rejected"
    ) {
      sendError(
        res,
        400,
        "Status must be accepted or rejected."
      );
      return;
    }

    // Find the pending order belonging to this vendor.
    const existingOrder = await orders.findOne({
      _id: new ObjectId(id),
      vendorId: vendor.id,
      status: "pending",
    });

    if (!existingOrder) {
      sendError(
        res,
        409,
        "Order not found or no longer pending."
      );
      return;
    }

    // Verify ownership and current restaurant approval.
    const restaurant = await restaurants.findOne({
      _id: existingOrder.restaurantId,
      ownerId: vendor.id,
      status: "approved",
    });

    if (!restaurant) {
      sendError(
        res,
        403,
        "You cannot manage this restaurant's orders."
      );
      return;
    }

    const now = new Date();

    const update: UpdateFilter<OrderDocument> =
      requestedStatus === "rejected"
        ? {
            $set: {
              status: "rejected",
              reviewedAt: now,
              updatedAt: now,
            },
            $unset: {
              activeOrderKey: "",
            },
          }
        : {
            $set: {
              status: "accepted",
              reviewedAt: now,
              updatedAt: now,
            },
          };

    // The pending condition prevents double review.
    const result = await orders.findOneAndUpdate(
      {
        _id: existingOrder._id,
        vendorId: vendor.id,
        restaurantId: restaurant._id,
        status: "pending",
      },
      update,
      {
        returnDocument: "after",
      }
    );

    if (!result) {
      sendError(
        res,
        409,
        "Order status changed. Refresh and try again."
      );
      return;
    }

    res.json({
      success: true,
      message:
        requestedStatus === "accepted"
          ? "Order accepted successfully."
          : "Order rejected successfully.",
      data: serializeOrder(result),
    });
  } catch (error) {
    console.error(
      "Update order status failed:",
      error
    );

    sendError(
      res,
      500,
      "Unable to update order status."
    );
  }
});

// ============================================
// EXPORT ROUTER
// ============================================

export default router;
