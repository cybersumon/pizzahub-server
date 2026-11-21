// Admin-only Restaurant Approval API।
import adminRoutes from "./routes/admin.routes.js";
import "dotenv/config";

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
// 1. SECURITY MIDDLEWARE
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


// 3. BETTER AUTH ROUTES
app.all("/api/auth/*splat", toNodeHandler(auth));


// 4. JSON BODY PARSER
app.use(express.json());

// ============================================
// 5. RESTAURANT API ROUTES
// ============================================

// Authenticated restaurant onboarding endpoints।
app.use("/api/restaurants", restaurantRoutes);
// Admin-only endpoints।
app.use("/api/admin", adminRoutes);

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

app.listen(PORT, () => {
  console.log(`PizzaHub API running on port ${PORT}`);
  console.log(`Allowed frontend origin: ${CLIENT_URL}`);
});