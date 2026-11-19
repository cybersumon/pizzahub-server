import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { toNodeHandler } from "better-auth/node";
import { auth } from "./lib/auth.js";

const app = express();
app.all("/api/auth/*splat", toNodeHandler(auth));
app.use(express.json());
const PORT = Number(process.env.PORT) || 7000;

app.use(helmet());
app.use(cors({
  origin: process.env.CLIENT_URL || "http://localhost:3000",
  credentials: true,
}));
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.status(200).json({
    success: true,
    message: "PizzaHub API is running",
  });
});

app.listen(PORT, () => {
  console.log(`PizzaHub API running on port ${PORT}`);
});