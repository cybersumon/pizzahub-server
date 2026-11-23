import adminSubscriptionRoutes from "./routes/admin-subscription.routes.js";
import subscriptionRoutes from "./routes/subscription.routes.js";
import { stripeWebhook } from "./controllers/stripe.controller.js";
import userRoutes from "./routes/user.routes.js";
import adminRoutes from "./routes/admin.routes.js";
import "dotenv/config";
import uploadRoutes from "./routes/upload.routes.js";
import orderRoutes from "./routes/order.routes.js";
import profileRoutes from "./routes/profile.routes.js";

// Vendor Menu CRUD API।
import menuRoutes from "./routes/menu.routes.js";

// Express framework।
import express from "express";
import cors from "cors";

// HTTP security headers।
import helmet from "helmet";
import { toNodeHandler } from "better-auth/node";

// Better Auth configuration।
import { auth } from "./lib/auth.js";

// Restaurant registration API।
import restaurantRoutes from "./routes/restaurant.routes.js";

// creat Express application
const app = express();

// Backend port (default 7000)।
const PORT = Number(process.env.PORT) || 7000;

// Frontend URL।
const CLIENT_URL =
  process.env.CLIENT_URL || "http://localhost:3000";

// ============================================
// SECURITY MIDDLEWARE
// ============================================

// HTTP security headers set 
app.use(helmet());
app.use(
  cors({
    origin: CLIENT_URL,
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

    allowedHeaders: [
      "Content-Type",
      "Authorization",
    ],
  })
);

// BETTER AUTH ROUTES
app.all("/api/auth/*splat", toNodeHandler(auth));

app.post(
  "/api/stripe/webhook",
  express.raw({ type: "application/json" }),
  stripeWebhook
);

// JSON BODY PARSER
app.use(express.json());

// ============================================
// RESTAURANT API ROUTES
// ============================================

// Authenticated restaurant onboarding endpoints।
app.use("/api/restaurants", restaurantRoutes);
// Admin-only endpoints।
app.use("/api/admin", adminRoutes);
app.use("/api/users", userRoutes);
app.use("/api/menu", menuRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/profile", profileRoutes);
app.use("/api/subscriptions", subscriptionRoutes);
app.use(
  "/api/admin/subscriptions",
  adminSubscriptionRoutes
);

// ============================================
// BACKEND HEALTH CHECK
// ============================================

app.get("/api/health", (_req, res) => {
  res.status(200).json({
    success: true,
    message: "PizzaHub API is running",
  });
});

// ============================================
// START EXPRESS SERVER
// ============================================

app.listen(PORT, () => {
  console.log(`PizzaHub API running on port ${PORT}`);
  console.log(`Allowed frontend origin: ${CLIENT_URL}`);
});