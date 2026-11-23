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

// ============================================
// PIZZAHUB — ADMIN ROUTER
// ============================================

const router = Router();

// MongoDB Collections।
const restaurants = db.collection("restaurants");
const menus = db.collection("menuItems");
const usersCollection = db.collection("user");

// ============================================
// TYPES
// ============================================

type RestaurantStatus =
  | "pending"
  | "approved"
  | "rejected";

type MenuApprovalStatus =
  | "pending"
  | "approved"
  | "rejected";

type MenuFilterStatus =
  | "all"
  | MenuApprovalStatus;

// ============================================
// ADMIN AUTHORIZATION MIDDLEWARE
// ============================================

function getProtectedAdminIds(): Set<string> {
  return new Set(
    (process.env.ADMIN_USER_IDS ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean)
  );
}

async function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });

    if (!session?.user?.id || !ObjectId.isValid(session.user.id)) {
      res.status(401).json({ success: false, message: "Authentication required." });
      return;
    }

    const user = await usersCollection.findOne({
      _id: new ObjectId(session.user.id),
    });

    if (!user || user.isBlocked === true) {
      res.status(403).json({ success: false, message: "Account is unavailable." });
      return;
    }

    const isAdmin = getProtectedAdminIds().has(session.user.id) || user.role === "admin";
    if (!isAdmin) {
      res.status(403).json({ success: false, message: "Admin access required." });
      return;
    }

    next();
  } catch (error) {
    console.error("Admin verification failed:", error);
    res.status(500).json({ success: false, message: "Unable to verify admin." });
  }
}

// নিচের সব endpoints Admin protected।
router.use(requireAdmin);

// ============================================
// 1. RESTAURANT MANAGEMENT
// ============================================

// ============================================
// GET /api/admin/restaurants
// GET /api/admin/restaurants?status=pending
// ============================================

router.get("/restaurants", async (req, res) => {
  try {
    const status = req.query.status;

    const allowedStatuses: RestaurantStatus[] = [
      "pending",
      "approved",
      "rejected",
    ];

    // Invalid filter হলে error।
    if (
      status !== undefined &&
      (typeof status !== "string" ||
        !allowedStatuses.includes(
          status as RestaurantStatus
        ))
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
    console.error(
      "Admin restaurant list failed:",
      error
    );

    res.status(500).json({
      success: false,
      message: "Unable to load restaurants.",
    });
  }
});

// ============================================
// PATCH /api/admin/restaurants/:id/status
// Body: { status: "approved" | "rejected" }
// ============================================

router.patch(
  "/restaurants/:id/status",
  async (req, res) => {
    try {
      const id = req.params.id;

      // MongoDB Restaurant ID validation।
      if (
        typeof id !== "string" ||
        !ObjectId.isValid(id)
      ) {
        res.status(400).json({
          success: false,
          message: "Invalid restaurant ID.",
        });
        return;
      }

      const requestedStatus: unknown =
        req.body?.status;

      if (
        requestedStatus !== "approved" &&
        requestedStatus !== "rejected"
      ) {
        res.status(400).json({
          success: false,
          message:
            "Status must be approved or rejected.",
        });
        return;
      }

      // শুধু Pending Restaurant review করা যাবে।
      const result =
        await restaurants.findOneAndUpdate(
          {
            _id: new ObjectId(id),
            status: "pending",
          },
          {
            $set: {
              status: requestedStatus,
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
      console.error(
        "Admin restaurant review failed:",
        error
      );

      res.status(500).json({
        success: false,
        message: "Unable to update restaurant.",
      });
    }
  }
);

// ============================================
// 2. ADMIN USERS MANAGEMENT
// ============================================

// ============================================
// GET /api/admin/users
// Customer / Vendor / Admin
// ============================================

router.get("/users", async (_req, res) => {
  try {
    // Better Auth User Collection।
    const users = await usersCollection
      .find(
        {},
        {
          projection: {
            _id: 1,
            name: 1,
            email: 1,
            image: 1,
            emailVerified: 1,
            createdAt: 1,
            isBlocked: 1,
            role: 1,
          },
        }
      )
      .sort({ createdAt: -1 })
      .limit(500)
      .toArray();
      
      

    // All registered restaurants।
    const restaurantRecords = await restaurants
      .find(
        {},
        {
          projection: {
            ownerId: 1,
            name: 1,
            status: 1,
            plan: 1,
          },
        }
      )
      .toArray();

    // Restaurant ownerId দিয়ে lookup।
    const restaurantByOwner = new Map(
      restaurantRecords.map((restaurant) => [
        String(restaurant.ownerId),
        restaurant,
      ])
    );

    // Backend environment থেকে Admin IDs।
    const adminIds = new Set(
      (process.env.ADMIN_USER_IDS ?? "")
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean)
    );

    // Explicit roles override inferred roles; protected admins are immutable.
    const data = users.map((user) => {
      const userId = user._id.toString();
      const restaurant = restaurantByOwner.get(userId);
      const role = adminIds.has(userId)
        ? "admin"
        : user.role === "admin" || user.role === "vendor" || user.role === "customer"
          ? user.role
          : restaurant
            ? "vendor"
            : "customer";

      return {
        id: userId,
        name: user.name,
        email: user.email,
        image: user.image ?? null,
        emailVerified: user.emailVerified,
        createdAt: user.createdAt,
        role,
        isProtectedAdmin: adminIds.has(userId),

        isBlocked: user.isBlocked === true,

        restaurant: restaurant
          ? {
              id: restaurant._id.toString(),
              name: restaurant.name,
              status: restaurant.status,
              plan: restaurant.plan,
            }
          : null,
      };
    });

    res.json({
      success: true,
      total: data.length,
      canAssignAdmin: getProtectedAdminIds().has(
        (await auth.api.getSession({ headers: fromNodeHeaders(_req.headers) }))?.user?.id ?? ""
      ),
      data,
    });
  } catch (error) {
    console.error("Admin users list error:", error);

    res.status(500).json({
      success: false,
      message: "Unable to load users.",
    });
  }
});

// ============================================
// UPDATE USER ROLE
// PATCH /api/admin/users/:id/role
// ============================================

router.patch("/users/:id/role", async (req, res) => {
  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    const actorId = session?.user?.id;
    if (!actorId) {
      res.status(401).json({ success: false, message: "Authentication required." });
      return;
    }

    const targetId = req.params.id;
    const requestedRole: unknown = req.body?.role;
    if (typeof targetId !== "string" || !ObjectId.isValid(targetId)) {
      res.status(400).json({ success: false, message: "Invalid user ID." });
      return;
    }
    if (requestedRole !== "customer" && requestedRole !== "vendor" && requestedRole !== "admin") {
      res.status(400).json({ success: false, message: "Invalid user role." });
      return;
    }

    const protectedAdmins = getProtectedAdminIds();
    const actorIsSuperAdmin = protectedAdmins.has(actorId);
    if (actorId === targetId || protectedAdmins.has(targetId)) {
      res.status(403).json({ success: false, message: "Protected or own account cannot be changed." });
      return;
    }

    const target = await usersCollection.findOne({ _id: new ObjectId(targetId) });
    if (!target) {
      res.status(404).json({ success: false, message: "User not found." });
      return;
    }
    if (target.isBlocked === true) {
      res.status(409).json({ success: false, message: "Unblock the user before changing roles." });
      return;
    }

    const currentRole = target.role === "admin" || target.role === "vendor" || target.role === "customer"
      ? target.role
      : (await restaurants.findOne({ ownerId: targetId }, { projection: { _id: 1 } }))
        ? "vendor"
        : "customer";

    // Only the environment-protected super admin can grant/revoke admin privileges.
    if ((requestedRole === "admin" || currentRole === "admin") && !actorIsSuperAdmin) {
      res.status(403).json({ success: false, message: "Super admin permission required." });
      return;
    }

    // Prevent hiding an existing restaurant under a customer role.
    if (requestedRole === "customer") {
      const ownedRestaurant = await restaurants.findOne(
        { ownerId: targetId },
        { projection: { _id: 1 } }
      );
      if (ownedRestaurant) {
        res.status(409).json({
          success: false,
          message: "Transfer or close the owned restaurant before assigning Customer role.",
        });
        return;
      }
    }

    if (requestedRole === currentRole) {
      res.json({ success: true, message: "Role is already assigned.", data: { id: targetId, role: currentRole } });
      return;
    }

    // Do not modify ownership, approval status or Stripe subscriptions.
    await usersCollection.updateOne(
      { _id: new ObjectId(targetId), isBlocked: { $ne: true } },
      { $set: { role: requestedRole, updatedAt: new Date() } }
    );

    res.json({
      success: true,
      message: `User role updated to ${requestedRole}.`,
      data: { id: targetId, role: requestedRole },
    });
  } catch (error) {
    console.error("Update user role failed:", error);
    res.status(500).json({ success: false, message: "Unable to update user role." });
  }
});

// ============================================
// 3. ADMIN VENDORS MANAGEMENT
// ============================================

// ============================================
// GET /api/admin/vendors
// All Restaurants + Owner Details
// ============================================

router.get("/vendors", async (_req, res) => {
  try {
    const restaurantRecords = await restaurants
      .find({})
      .sort({ createdAt: -1 })
      .limit(500)
      .toArray();

    const ownerIds = restaurantRecords
      .map((restaurant) =>
        String(restaurant.ownerId)
      )
      .filter((id) => ObjectId.isValid(id))
      .map((id) => new ObjectId(id));

    const users = await usersCollection
      .find(
        {
          _id: {
            $in: ownerIds,
          },
        },
        {
          projection: {
            _id: 1,
            name: 1,
            email: 1,
          },
        }
      )
      .toArray();

    // Owner ID -> User Information।
    const ownerMap = new Map(
      users.map((user) => [
        user._id.toString(),
        user,
      ])
    );

    // Restaurant + Owner Details।
    const data = restaurantRecords.map(
      (restaurant) => {
        const owner = ownerMap.get(
          String(restaurant.ownerId)
        );

        return {
          id: restaurant._id.toString(),
          name: restaurant.name,
          address: restaurant.address,
          phone: restaurant.phone,
          status: restaurant.status,
          plan: restaurant.plan,
          createdAt: restaurant.createdAt,

          owner: owner
            ? {
                id: owner._id.toString(),
                name: owner.name,
                email: owner.email,
              }
            : null,
        };
      }
    );

    res.json({
      success: true,
      total: data.length,
      data,
    });
  } catch (error) {
    console.error(
      "Admin vendors list error:",
      error
    );

    res.status(500).json({
      success: false,
      message: "Unable to load vendors.",
    });
  }
});
// ============================================
// LESSON 18 — STEP 6A
// ADMIN USER BLOCK / UNBLOCK
// ============================================

// PATCH /api/admin/users/:id/block
// Body: { "isBlocked": true }
// Body: { "isBlocked": false }

router.patch("/users/:id/block", async (req, res) => {
  try {
    // ----------------------------------------
    // 1. Verify currently logged-in Admin
    // ----------------------------------------

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

    // ----------------------------------------
    // 2. Validate target User ID
    // ----------------------------------------

    const userId = req.params.id;

    if (
      typeof userId !== "string" ||
      !ObjectId.isValid(userId)
    ) {
      res.status(400).json({
        success: false,
        message: "Invalid user ID.",
      });
      return;
    }

    // ----------------------------------------
    // 3. Validate requested action
    // ----------------------------------------

    const isBlocked: unknown = req.body?.isBlocked;

    if (typeof isBlocked !== "boolean") {
      res.status(400).json({
        success: false,
        message: "isBlocked must be true or false.",
      });
      return;
    }

    // ----------------------------------------
    // 4. Prevent Admin from blocking themselves
    // ----------------------------------------

    if (session.user.id === userId) {
      res.status(403).json({
        success: false,
        message: "You cannot block your own account.",
      });
      return;
    }

    // ----------------------------------------
    // 5. Protect all Admin accounts
    // ----------------------------------------

    const adminIds = (process.env.ADMIN_USER_IDS ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);

    if (adminIds.includes(userId)) {
      res.status(403).json({
        success: false,
        message: "Admin accounts cannot be blocked.",
      });
      return;
    }

    // ----------------------------------------
    // 6. Update User in MongoDB
    // ----------------------------------------

    const now = new Date();

    const result = await db
      .collection("user")
      .findOneAndUpdate(
        {
          _id: new ObjectId(userId),
        },
        {
          $set: {
            isBlocked,
            updatedAt: now,
          },
        },
        {
          returnDocument: "after",
        }
      );

    if (!result) {
      res.status(404).json({
        success: false,
        message: "User not found.",
      });
      return;
    }

    // ----------------------------------------
    // 7. Send response
    // ----------------------------------------

    res.json({
      success: true,
      message: isBlocked
        ? "User blocked successfully."
        : "User unblocked successfully.",

      data: {
        id: result._id.toString(),
        name: result.name,
        email: result.email,
        isBlocked: result.isBlocked === true,
        updatedAt: result.updatedAt,
      },
    });
  } catch (error) {
    console.error(
      "Admin user block/unblock failed:",
      error
    );

    res.status(500).json({
      success: false,
      message: "Unable to update user status.",
    });
  }
});


//  ADMIN MENU MANAGEMENT

// GET /api/admin/menu


router.get("/menu", async (req, res) => {
  try {
    const status = req.query.status ?? "all";

    const allowedStatuses: MenuFilterStatus[] = [
      "all",
      "pending",
      "approved",
      "rejected",
    ];

    if (
      typeof status !== "string" ||
      !allowedStatuses.includes(
        status as MenuFilterStatus
      )
    ) {
      res.status(400).json({
        success: false,
        message: "Invalid menu approval status.",
      });
      return;
    }

    // পুরোনো Item-এ approvalStatus না থাকলে
    // Admin Dashboard-এ Pending দেখাবে।
    const filter =
      status === "all"
        ? {}
        : status === "pending"
          ? {
              $or: [
                {
                  approvalStatus: "pending",
                },
                {
                  approvalStatus: {
                    $exists: false,
                  },
                },
              ],
            }
          : {
              approvalStatus: status,
            };

    // Menu Items load।
    const items = await menus
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(500)
      .toArray();

    // Restaurant IDs সংগ্রহ।
    const restaurantIds = [
      ...new Set(
        items
          .filter(
            (item) =>
              item.restaurantId instanceof ObjectId
          )
          .map((item) =>
            item.restaurantId.toString()
          )
      ),
    ].map((id) => new ObjectId(id));

    // সংশ্লিষ্ট Restaurant information।
    const restaurantRecords =
      restaurantIds.length > 0
        ? await restaurants
            .find({
              _id: {
                $in: restaurantIds,
              },
            })
            .toArray()
        : [];

    const restaurantMap = new Map(
      restaurantRecords.map((restaurant) => [
        restaurant._id.toString(),
        restaurant,
      ])
    );

    // Frontend-এর জন্য data format।
    const data = items.map((item) => {
      const restaurantId =
        item.restaurantId instanceof ObjectId
          ? item.restaurantId.toString()
          : String(item.restaurantId ?? "");

      const restaurant =
        restaurantMap.get(restaurantId);

      return {
        id: item._id.toString(),
        name: item.name,
        description: item.description,
        category: item.category,
        price: item.price,
        image: item.image,

        isActive: item.isActive === true,

        approvalStatus:
          item.approvalStatus ?? "pending",

        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        reviewedAt: item.reviewedAt ?? null,

        ownerId: item.ownerId,
        restaurantId,

        vendorName:
          restaurant?.name ??
          "Unknown Restaurant",

        location:
          restaurant?.address ?? "",

        phone:
          restaurant?.phone ?? "",

        restaurantStatus:
          restaurant?.status ?? "unknown",

        subscriptionPlan:
          restaurant?.plan ?? "free",
      };
    });

    // Overall statistics।
    const [
      pendingCount,
      approvedCount,
      rejectedCount,
      totalCount,
    ] = await Promise.all([
      menus.countDocuments({
        $or: [
          {
            approvalStatus: "pending",
          },
          {
            approvalStatus: {
              $exists: false,
            },
          },
        ],
      }),

      menus.countDocuments({
        approvalStatus: "approved",
      }),

      menus.countDocuments({
        approvalStatus: "rejected",
      }),

      menus.countDocuments({}),
    ]);

    res.json({
      success: true,
      total: data.length,
      data,

      stats: {
        total: totalCount,
        pending: pendingCount,
        approved: approvedCount,
        rejected: rejectedCount,
      },
    });
  } catch (error) {
    console.error(
      "Admin menu list failed:",
      error
    );

    res.status(500).json({
      success: false,
      message: "Unable to load menu items.",
    });
  }
});

// ============================================
// 5. ADMIN MENU APPROVE / REJECT
// ============================================

// ============================================
// PATCH /api/admin/menu/:id/status
//
// Body:
// { "status": "approved" }
// { "status": "rejected" }
// ============================================

router.patch(
  "/menu/:id/status",
  async (req, res) => {
    try {
      const id = req.params.id;

      // Menu ID validation।
      if (
        typeof id !== "string" ||
        !ObjectId.isValid(id)
      ) {
        res.status(400).json({
          success: false,
          message: "Invalid menu item ID.",
        });
        return;
      }

      const requestedStatus: unknown =
        req.body?.status;

      if (
        requestedStatus !== "approved" &&
        requestedStatus !== "rejected"
      ) {
        res.status(400).json({
          success: false,
          message:
            "Status must be approved or rejected.",
        });
        return;
      }

      const menuId = new ObjectId(id);

      // Existing Menu Item।
      const item = await menus.findOne({
        _id: menuId,
      });

      if (!item) {
        res.status(404).json({
          success: false,
          message: "Menu item not found.",
        });
        return;
      }

      // Same status আবার apply করা যাবে না।
      if (
        item.approvalStatus === requestedStatus
      ) {
        res.status(409).json({
          success: false,
          message:
            `Menu item is already ${requestedStatus}.`,
        });
        return;
      }

      // Restaurant ID validation।
      if (
        !(item.restaurantId instanceof ObjectId)
      ) {
        res.status(409).json({
          success: false,
          message:
            "Restaurant ID is missing or invalid.",
        });
        return;
      }

      // Approved Restaurant required।
      const restaurant =
        await restaurants.findOne({
          _id: item.restaurantId,
          status: "approved",
        });

      if (!restaurant) {
        res.status(409).json({
          success: false,
          message:
            "An approved restaurant is required.",
        });
        return;
      }

      // ======================================
      // FREE PLAN ACTIVE MENU LIMIT
      // ======================================

      if (
        requestedStatus === "approved" &&
        item.isActive === true &&
        restaurant.plan !== "premium" &&
        restaurant.plan !== "premium_plus"
      ) {
        const approvedActiveCount =
          await menus.countDocuments({
            restaurantId: restaurant._id,
            isActive: true,
            approvalStatus: "approved",

            _id: {
              $ne: menuId,
            },
          });

        if (approvedActiveCount >= 3) {
          res.status(403).json({
            success: false,
            message:
              "Free vendors can have a maximum of 3 active approved menu items.",
          });
          return;
        }
      }

      // ======================================
      // CONCURRENT EDIT PROTECTION
      // ======================================

      const previousStatus =
        item.approvalStatus;

      const previousStatusFilter =
        previousStatus === undefined
          ? {
              approvalStatus: {
                $exists: false,
              },
            }
          : {
              approvalStatus: previousStatus,
            };

      const result =
        await menus.findOneAndUpdate(
          {
            _id: menuId,
            ...previousStatusFilter,
            updatedAt: item.updatedAt,
          },
          {
            $set: {
              approvalStatus: requestedStatus,
              reviewedAt: new Date(),
              updatedAt: new Date(),
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
            "Menu item changed during review. Refresh and try again.",
        });
        return;
      }

      res.json({
        success: true,

        message:
          requestedStatus === "approved"
            ? "Menu item approved successfully."
            : "Menu item rejected successfully.",

        data: {
          id: result._id.toString(),
          name: result.name,
          approvalStatus:
            result.approvalStatus,
          isActive: result.isActive,
          reviewedAt: result.reviewedAt,
        },
      });
    } catch (error) {
      console.error(
        "Admin menu review failed:",
        error
      );

      res.status(500).json({
        success: false,
        message:
          "Unable to update menu approval.",
      });
    }
  }
);

// ============================================
// 6. ADMIN DELETE MENU ITEM
// ============================================

// DELETE /api/admin/menu/:id

router.delete("/menu/:id", async (req, res) => {
  try {
    const id = req.params.id;

    if (
      typeof id !== "string" ||
      !ObjectId.isValid(id)
    ) {
      res.status(400).json({
        success: false,
        message: "Invalid menu item ID.",
      });
      return;
    }

    const result = await menus.deleteOne({
      _id: new ObjectId(id),
    });

    if (result.deletedCount === 0) {
      res.status(404).json({
        success: false,
        message: "Menu item not found.",
      });
      return;
    }

    res.json({
      success: true,
      message:
        "Menu item deleted successfully.",
    });
  } catch (error) {
    console.error(
      "Admin menu delete failed:",
      error
    );

    res.status(500).json({
      success: false,
      message: "Unable to delete menu item.",
    });
  }
});

// ============================================
// EXPORT ADMIN ROUTER
// ============================================

export default router;