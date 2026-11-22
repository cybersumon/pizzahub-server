import {
  type Request,
  type Response,
  type NextFunction,
} from "express";

import { ObjectId } from "mongodb";
import { fromNodeHeaders } from "better-auth/node";

import { auth } from "../lib/auth.js";
import { db } from "../config/database.js";

// ============================================
// PIZZAHUB — ACTIVE USER MIDDLEWARE
// ============================================

export async function requireActiveUser(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    // 1. Better Auth Session justify
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });

    if (!session?.user?.id) {
      res.status(401).json({
        success: false,
        message: "Please login to continue.",
      });
      return;
    }

    const userId = session.user.id;

    // 2. MongoDB User ID 
    if (!ObjectId.isValid(userId)) {
      res.status(401).json({
        success: false,
        message: "Invalid user session.",
      });
      return;
    }

    const user = await db.collection("user").findOne(
      {
        _id: new ObjectId(userId),
      },
      {
        projection: {
          _id: 1,
          isBlocked: 1,
        },
      }
    );

    if (!user) {
      res.status(401).json({
        success: false,
        message: "User account not found.",
      });
      return;
    }
    if (user.isBlocked === true) {
      res.status(403).json({
        success: false,
        code: "ACCOUNT_BLOCKED",
        message:
          "Your account has been blocked. Please contact support.",
      });
      return;
    }

    next();
  } catch (error) {
    console.error(
      "Active user verification failed:",
      error
    );

    res.status(500).json({
      success: false,
      message: "Unable to verify user status.",
    });
  }
}