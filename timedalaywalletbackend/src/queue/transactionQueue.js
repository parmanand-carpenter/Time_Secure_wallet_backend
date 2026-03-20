import { Queue } from "bullmq";
import { redis } from "../config/redis.js";
import { logger } from "../utils/logger.js";

export const transactionQueue = new Queue("transactions", {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: 100,
    removeOnFail: 200,
  },
});

export async function addQueuedJob(data) {
  await transactionQueue.add("transaction-queued", data);
  logger.info(`Job added → transaction-queued | wallet: ${data.walletAddress} | txId: ${data.txId}`);
}

export async function addCancelledJob(data) {
  await transactionQueue.add("transaction-cancelled", data);
  logger.info(`Job added → transaction-cancelled | wallet: ${data.walletAddress} | txId: ${data.txId}`);
}

export async function addExecutedJob(data) {
  await transactionQueue.add("transaction-executed", data);
  logger.info(`Job added → transaction-executed | wallet: ${data.walletAddress} | txId: ${data.txId}`);
}

export async function addExecuteEmailJob(data, delayMs) {
  await transactionQueue.add("send-execute-email", data, { delay: delayMs });
  logger.info(`Delayed job scheduled → send-execute-email | in ${Math.round(delayMs / 1000)}s | txId: ${data.txId}`);
}
