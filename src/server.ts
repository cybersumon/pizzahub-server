// ============================================
// PIZZAHUB BACKEND SERVER
// Express + Better Auth + MongoDB
// ============================================

// .env environment variables load করছি।
import "dotenv/config";

// Express framework।
import express from "express";

// Frontend থেকে cross-origin requests allow করবে।
import cors from "cors";

// HTTP security headers।
import helmet from "helmet";

// Better Auth-এর Express integration।
import { toNodeHandler } from "better-auth/node";

// Better Auth configuration।
import { auth } from "./lib/auth.js";

// Restaurant registration API।
import restaurantRoutes from "./routes/restaurant.routes.js";

// Express application তৈরি।
const app = express();

// Backend port (default 7000)।
const PORT = Number(process.env.PORT) || 7000;

// Frontend URL।
const CLIENT_URL =
  process.env.CLIENT_URL || "http://localhost:3000";

// ============================================
// 1. SECURITY MIDDLEWARE
// ============================================

// HTTP security headers set করবে।
app.use(helmet());

// ============================================
// 2. CORS MIDDLEWARE
// IMPORTANT: Better Auth-এর আগে থাকতে হবে।
// ============================================

app.use(
  cors({
    // শুধু আমাদের Next.js frontend allow করছি।
    origin: CLIENT_URL,

    // Authentication cookies support।
    credentials: true,

    // Allowed HTTP methods।
    methods: [
      "GET",
      "POST",
      "PUT",
      "PATCH",
      "DELETE",
      "OPTIONS",
    ],

    // JSON এবং authentication headers।
    allowedHeaders: [
      "Content-Type",
      "Authorization",
    ],
  })
);

// ============================================
// 3. BETTER AUTH ROUTES
// ============================================

// Better Auth-এর sign-in/sign-up/session APIs।
// Express 5 wildcard syntax ব্যবহার করছি।
app.all("/api/auth/*splat", toNodeHandler(auth));

// ============================================
// 4. JSON BODY PARSER
// ============================================

// Better Auth handler-এর পরে JSON parser।
// IMPORTANT: শুধু একবার ব্যবহার করছি।
app.use(express.json());

// ============================================
// 5. RESTAURANT API ROUTES
// ============================================

// Authenticated restaurant onboarding endpoints।
app.use("/api/restaurants", restaurantRoutes);

// ============================================
// 6. BACKEND HEALTH CHECK
// ============================================

app.get("/api/health", (_req, res) => {
  res.status(200).json({
    success: true,
    message: "PizzaHub API is running",
  });
});

// ============================================
// 7. START EXPRESS SERVER
// ============================================

// Backend server চালু।
app.listen(PORT, () => {
  console.log(`PizzaHub API running on port ${PORT}`);
  console.log(`Allowed frontend origin: ${CLIENT_URL}`);
});