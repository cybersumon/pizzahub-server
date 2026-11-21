import { Router } from "express";
import multer from "multer";
import { fromNodeHeaders } from "better-auth/node";

import { auth } from "../lib/auth.js";
import { db } from "../config/database.js";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),

  limits: {
    // Maximum 5 MB image।
    fileSize: 5 * 1024 * 1024,
    files: 1,
  },

  fileFilter: (_req, file, callback) => {
    const allowedTypes = [
      "image/jpeg",
      "image/png",
      "image/webp",
    ];

    if (!allowedTypes.includes(file.mimetype)) {
      callback(new Error("Only JPG, PNG and WebP allowed."));
      return;
    }

    callback(null, true);
  },
});

// =============================================
// APPROVED VENDOR AUTHORIZATION
// =============================================

router.use(async (req, res, next) => {
  try {
    // Better Auth session justyfy.
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

    // without Approved restaurant owner upload close
    const restaurant = await db
      .collection("restaurants")
      .findOne({
        ownerId: session.user.id,
        status: "approved",
      });

    if (!restaurant) {
      res.status(403).json({
        success: false,
        message: "Approved vendor access required.",
      });
      return;
    }

    next();
  } catch {
    res.status(500).json({
      success: false,
      message: "Unable to verify vendor.",
    });
  }
});

// =============================================
// POST /api/upload/image
// =============================================

router.post(
  "/image",
  (req, res, next) => {
    upload.single("image")(req, res, (error) => {
      if (error) {
        res.status(400).json({
          success: false,
          message: "Invalid image or file exceeds 5 MB.",
        });
        return;
      }

      next();
    });
  },

  async (req, res) => {
    try {
      if (!req.file) {
        res.status(400).json({
          success: false,
          message: "Please select an image.",
        });
        return;
      }

      const buffer = req.file.buffer;

      const isJpeg =
        buffer[0] === 0xff &&
        buffer[1] === 0xd8 &&
        buffer[2] === 0xff;

      const isPng =
        buffer.subarray(0, 8).equals(
          Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
        );

      const isWebp =
        buffer.toString("ascii", 0, 4) === "RIFF" &&
        buffer.toString("ascii", 8, 12) === "WEBP";

      if (!isJpeg && !isPng && !isWebp) {
        res.status(400).json({
          success: false,
          message: "Invalid image file.",
        });
        return;
      }

      const apiKey = process.env.IMGBB_API_KEY;

      if (!apiKey) {
        res.status(500).json({
          success: false,
          message: "Image upload is not configured.",
        });
        return;
      }

      const formData = new FormData();

      formData.append("key", apiKey);
      formData.append(
        "image",
        req.file.buffer.toString("base64")
      );

      const response = await fetch(
        "https://api.imgbb.com/1/upload",
        {
          method: "POST",
          body: formData,
          signal: AbortSignal.timeout(30000),
        }
      );

      // ImgBB response structure।
      const result = (await response.json()) as {
        success?: boolean;
        data?: {
          url?: string;
        };
      };

      if (
        !response.ok ||
        !result.success ||
        !result.data?.url
      ) {
        res.status(502).json({
          success: false,
          message: "Image upload failed.",
        });
        return;
      }

      res.json({
        success: true,
        imageUrl: result.data.url,
      });
    } catch {
      res.status(500).json({
        success: false,
        message: "Unable to upload image.",
      });
    }
  }
);

export default router;