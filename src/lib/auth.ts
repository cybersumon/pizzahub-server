import { betterAuth } from "better-auth";
import { mongodbAdapter } from "@better-auth/mongo-adapter";
import { db, mongoClient } from "../config/database.js";

// Better Auth instance।
export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,

  database: mongodbAdapter(db, {
    client: mongoClient,
  }),

  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
  },

  trustedOrigins: [
    process.env.FRONTEND_URL || "http://localhost:3000",
  ],
});