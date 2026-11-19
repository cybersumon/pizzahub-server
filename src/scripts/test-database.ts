import dns from "node:dns";
dns.setServers(["8.8.8.8", "8.8.4.4"]);
async function main() {
  let client;

  try {
    const { connectDatabase, mongoClient } =
      await import("../config/database.js");

    client = mongoClient;

    // MongoDB Atlas connection test।
    const database = await connectDatabase();

    console.log("Database:", database.databaseName);
  } catch (error) {
    console.error("❌ MongoDB connection failed:", error);
    process.exitCode = 1;
  } finally {
    if (client) {
      await client.close();
    }
  }
}

void main();