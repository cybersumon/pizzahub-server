
import { Router } from "express";
import { ObjectId } from "mongodb";
import { fromNodeHeaders } from "better-auth/node";

import { auth } from "../lib/auth.js";
import { db } from "../config/database.js";
import { requireActiveUser } from "../middleware/requireActiveUser.js";

// ============================================
// PIZZAHUB — PROFILE CONTACT API
// LESSON 19 — STEP 6A
// ============================================

const router = Router();

// Better Auth User Collection।
const users = db.collection("user");

// সব Profile Route-এ Active Login প্রয়োজন।
router.use(requireActiveUser);

// ============================================
// HELPER — MOBILE NUMBER VALIDATION
// ============================================

// আন্তর্জাতিক Format থেকে Local Format-এ আনা।
function normalizePhone(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const cleaned = value.trim().replace(/[\s()-]/g, "");

  let phone = cleaned;

  if (cleaned.startsWith("+880")) {
    phone = `0${cleaned.slice(4)}`;
  } else if (cleaned.startsWith("880")) {
    phone = `0${cleaned.slice(3)}`;
  }

  // বাংলাদেশের ১১ ডিজিটের Mobile Number।
  return /^01[3-9]\d{8}$/.test(phone)
    ? phone
    : null;
}

// ============================================
// HELPER — AUTHENTICATED USER
// ============================================

// Browser থেকে কোনো User ID নেওয়া হচ্ছে না।
// Better Auth Session থেকেই User ID পাওয়া হবে।
async function getAuthenticatedUserId(
  headers: import("node:http").IncomingHttpHeaders
): Promise<ObjectId | null> {
  const session = await auth.api.getSession({
    headers: fromNodeHeaders(headers),
  });

  const id = session?.user?.id;

  if (!id || !ObjectId.isValid(id)) {
    return null;
  }

  return new ObjectId(id);
}

// ============================================
// GET /api/profile/phone
// নিজের সংরক্ষিত Mobile Number দেখা।
// ============================================

router.get("/phone", async (req, res) => {
  try {
    const userId = await getAuthenticatedUserId(
      req.headers
    );

    if (!userId) {
      res.status(401).json({
        success: false,
        message: "Authentication required.",
      });
      return;
    }

    // শুধু নিজের Profile পড়া যাবে।
    const user = await users.findOne(
      {
        _id: userId,
        isBlocked: { $ne: true },
      },
      {
        projection: {
          phone: 1,
        },
      }
    );

    if (!user) {
      res.status(404).json({
        success: false,
        message: "User profile not found.",
      });
      return;
    }

    res.json({
      success: true,
      data: {
        phone:
          typeof user.phone === "string"
            ? user.phone
            : "",
      },
    });
  } catch (error) {
    console.error(
      "Profile phone fetch failed:",
      error
    );

    res.status(500).json({
      success: false,
      message: "Unable to load mobile number.",
    });
  }
});

// ============================================
// PATCH /api/profile/phone
// নিজের Mobile Number Save করা।
// Body: { phone: "01712345678" }
// ============================================

router.patch("/phone", async (req, res) => {
  try {
    const userId = await getAuthenticatedUserId(
      req.headers
    );

    if (!userId) {
      res.status(401).json({
        success: false,
        message: "Authentication required.",
      });
      return;
    }

    // Request Body থেকে Phone সংগ্রহ।
    const phone = normalizePhone(req.body?.phone);

    if (!phone) {
      res.status(400).json({
        success: false,
        message:
          "Enter a valid Bangladeshi mobile number.",
      });
      return;
    }

    // শুধু Authenticated User-এর Document Update।
    const result = await users.findOneAndUpdate(
      {
        _id: userId,
        isBlocked: { $ne: true },
      },
      {
        $set: {
          phone,
          updatedAt: new Date(),
        },
      },
      {
        returnDocument: "after",
      }
    );

    if (!result) {
      res.status(404).json({
        success: false,
        message: "User profile not found.",
      });
      return;
    }

    res.json({
      success: true,
      message: "Mobile number saved successfully.",
      data: {
        phone: result.phone,
      },
    });
  } catch (error) {
    console.error(
      "Profile phone update failed:",
      error
    );

    res.status(500).json({
      success: false,
      message: "Unable to save mobile number.",
    });
  }
});

export default router;
