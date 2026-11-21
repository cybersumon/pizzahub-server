import dns from "node:dns";
const dnsServers = process.env.DNS_SERVERS;

if (dnsServers) {
  dns.setServers(
    dnsServers.split(",").map((server) => server.trim())
  );
}

import { MongoClient, type Db } from "mongodb";
import "dotenv/config";

// Database connection string।
const mongoUri = process.env.MONGODB_URI;

// MongoDB database name।
const dbName = process.env.DB_NAME;
if (!mongoUri || !dbName) {
  throw new Error("MONGODB_URI or DB_NAME is missing in .env");
}

export const mongoClient = new MongoClient(mongoUri, {
  serverSelectionTimeoutMS: 10000,
});

export const db: Db = mongoClient.db(dbName);
export async function connectDatabase(): Promise<Db> {
  await mongoClient.connect();
  await db.command({ ping: 1 });

await db
  .collection("restaurants")
  .createIndex({ ownerId: 1 }, { unique: true });

  console.log("✅ MongoDB connected successfully!");

await db.collection("menuItems").createIndex({
  restaurantId: 1,
  isActive: 1,
});

  return db;
}