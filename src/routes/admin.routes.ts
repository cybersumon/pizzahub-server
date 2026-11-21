import {
  Router,
  type Request,
  type Response,
  type NextFunction,
} from "express";

// MongoDB ObjectId validation।
import { ObjectId } from "mongodb";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "../lib/auth.js";
import { db } from "../config/database.js";

// Admin-only routes।
const router = Router();

// MongoDB restaurant collection।
const restaurants = db.collection("restaurants");

// Allowed restaurant statuses।
type RestaurantStatus = "pending" | "approved" | "rejected";

// ===========================================
// ADMIN AUTHORIZATION MIDDLEWARE
// ===========================================

async function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });

    // Login না থাকলে access বন্ধ।
    if (!session?.user?.id) {
      res.status(401).json({
        success: false,
        message: "Authentication required.",
      });
      return;
    }

    //  trusted Admin IDs from Server environment
    const adminIds = (process.env.ADMIN_USER_IDS ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);

    // Server-side ID allowlist check।
    if (!adminIds.includes(session.user.id)) {
      res.status(403).json({
        success: false,
        message: "Admin access required.",
      });
      return;
    }

    // Run Route after Admin verified 
    next();
  } catch (error) {
    console.error("Admin verification failed:", error);
    res.status(500).json({
      success: false,
      message: "Unable to verify admin.",
    });
  }
}

// এই Router-এর সব endpoints Admin protected।
router.use(requireAdmin);

// ===========================================
// GET /api/admin/restaurants
// GET /api/admin/restaurants?status=pending
// ===========================================

router.get("/restaurants", async (req, res) => {
  try {
    const status = req.query.status;
    const allowedStatuses: RestaurantStatus[] = [
      "pending",
      "approved",
      "rejected",
    ];

    if (
      status !== undefined &&
      (typeof status !== "string" ||
        !allowedStatuses.includes(status as RestaurantStatus))
    ) {
      res.status(400).json({
        success: false,
        message: "Invalid restaurant status.",
      });
      return;
    }
    const filter = status ? { status } : {};

    const records = await restaurants
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(100)
      .toArray();

    res.json({
      success: true,
      data: records.map((restaurant) => ({
        ...restaurant,
        _id: restaurant._id.toString(),
      })),
    });
  } catch (error) {
    console.error("Admin restaurant list failed:", error);

    res.status(500).json({
      success: false,
      message: "Unable to load restaurants.",
    });
  }
});

// ===========================================
// PATCH /api/admin/restaurants/:id/status
// Body: { status: "approved" | "rejected" }
// ===========================================

router.patch("/restaurants/:id/status", async (req, res) => {
  try {
    // Express route parameter।
    const id = req.params.id;

    // MongoDB ObjectId validation।
    if (typeof id !== "string" || !ObjectId.isValid(id)) {
      res.status(400).json({
        success: false,
        message: "Invalid restaurant ID.",
      });
      return;
    }
    const requestedStatus: unknown = req.body?.status;

    if (
      requestedStatus !== "approved" &&
      requestedStatus !== "rejected"
    ) {
      res.status(400).json({
        success: false,
        message: "Status must be approved or rejected.",
      });
      return;
    }

    const result = await restaurants.findOneAndUpdate(
      {
        _id: new ObjectId(id),
        status: "pending",
      },
      {
        $set: {
          status: requestedStatus,

          // Approval/rejection timestamp।
          reviewedAt: new Date(),
        },
      },
      {
        returnDocument: "after",
      }
    );

    if (!result) {
      res.status(409).json({
        success: false,
        message:
          "Restaurant not found or already reviewed.",
      });
      return;
    }

    // Successful approval/rejection।
    res.json({
      success: true,
      message:
        requestedStatus === "approved"
          ? "Restaurant approved successfully."
          : "Restaurant rejected successfully.",
      data: {
        ...result,
        _id: result._id.toString(),
      },
    });
  } catch (error) {
    console.error("Admin restaurant review failed:", error);

    res.status(500).json({
      success: false,
      message: "Unable to update restaurant.",
    });
  }
});

export default router;