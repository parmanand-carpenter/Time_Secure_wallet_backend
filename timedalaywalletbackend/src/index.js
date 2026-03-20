import "./config/env.js";
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { env } from "./config/env.js";
import { connectDB } from "./config/db.js";
import { startListener } from "./listener/blockchainListener.js";
import { startWorker } from "./worker/transactionWorker.js";
import routes from "./api/routes.js";
import { logger } from "./utils/logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  logger.info("Starting Time-Delay Wallet Backend...");

  // 1. Connect database
  await connectDB();

  // 2. Start BullMQ worker
  startWorker();

  // 3. Start blockchain listener
  await startListener();

  // 4. Start Express API
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use(express.static(path.join(__dirname, "../")));
  app.use("/api", routes);
  app.use(routes);

  app.get("/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  app.listen(env.PORT, () => {
    logger.success(`API server running on http://localhost:${env.PORT}`);
  });
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
