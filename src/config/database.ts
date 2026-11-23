
import dns from "node:dns";
import { MongoClient, type Db } from "mongodb";
import "dotenv/config";

// ============================================
// DATABASE ENVIRONMENT CONFIGURATION
// ============================================

const mongoUri = process.env.MONGODB_URI;
const dbName = process.env.DB_NAME;

if (!mongoUri || !dbName) {
  throw new Error(
    "MONGODB_URI or DB_NAME environment variable is missing."
  );
}

// ============================================
// OPTIONAL LOCAL DNS CONFIGURATION
// ============================================

// Avoid overriding the platform's DNS settings on Vercel.
const dnsServers = process.env.DNS_SERVERS;

if (!process.env.VERCEL && dnsServers) {
  dns.setServers(
    dnsServers
      .split(",")
      .map((server) => server.trim())
      .filter(Boolean)
  );
}

// ============================================
// REUSABLE MONGODB CLIENT
// ============================================

// Cache one client per warm Node.js runtime.
// The MongoDB driver also manages an internal
// connection pool for concurrent database operations.

export const mongoClient = new MongoClient(mongoUri, {
  serverSelectionTimeoutMS: 20000,
  connectTimeoutMS: 10000,
  maxPoolSize: 10,
  minPoolSize: 0,
});

export const db: Db = mongoClient.db(dbName);

// Share an in-progress connection attempt.
let connectionPromise: Promise<MongoClient> | null = null;

export async function getMongoClient(): Promise<MongoClient> {
  if (!connectionPromise) {
    connectionPromise = mongoClient
      .connect()
      .catch((error: unknown) => {
        connectionPromise = null;
        throw error;
      });
  }

  return connectionPromise;
}

// ============================================
// CONNECT DATABASE AND INITIALIZE INDEXES
// ============================================

export async function connectDatabase(): Promise<Db> {
  await getMongoClient();

  // Verify that Atlas can answer a command.
  await db.command({ ping: 1 });

  // Preserve the existing restaurant owner index.
  await db.collection("restaurants").createIndex(
    { ownerId: 1 },
    { unique: true }
  );

  // Preserve the existing menu item index.
  await db.collection("menuItems").createIndex({
    restaurantId: 1,
    isActive: 1,
  });

  console.log("MongoDB connected successfully.");

  return db;
}
