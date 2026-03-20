import { Worker } from "bullmq";
import { redis } from "../config/redis.js";
import prisma from "../config/db.js";
import { sendCancelEmail, sendExecuteEmail } from "../services/emailService.js";
import { addExecuteEmailJob } from "../queue/transactionQueue.js";
import { logger } from "../utils/logger.js";

async function processJob(job) {
  const { name, data } = job;

  // ─── Job: transaction-queued ───────────────────────────────────────
  if (name === "transaction-queued") {
    const { txId, walletAddress, toAddress, value, token, executeAfter } = data;

    const wallet = await prisma.wallet.findUnique({ where: { walletAddress } });

    if (!wallet) {
      logger.warn(`Wallet not registered in DB — skip email | wallet: ${walletAddress}`);
      return;
    }

    await prisma.transaction.upsert({
      where:  { txId_walletAddress: { txId: Number(txId), walletAddress } },
      update: {},
      create: {
        txId:         Number(txId),
        walletAddress,
        toAddress,
        value:        value.toString(),
        token,
        executeAfter: Number(executeAfter),
        status:       "PENDING",
      },
    });

    try {
      await sendCancelEmail({
        email: wallet.email,
        walletAddress,
        txId,
        toAddress,
        value: value.toString(),
        token,
        executeAfter,
      });
    } catch (emailErr) {
      logger.error(`Cancel email failed | txId: ${txId} | ${emailErr.message}`);
    }

    const nowMs      = Date.now();
    const executeMs  = Number(executeAfter) * 1000;
    const delayMs    = Math.max(executeMs - nowMs, 0);

    await addExecuteEmailJob({ txId, walletAddress, toAddress, value: value.toString(), token }, delayMs);
  }

  // ─── Job: send-execute-email ───────────────────────────────────────
  else if (name === "send-execute-email") {
    const { txId, walletAddress, toAddress, value, token } = data;

    const txn = await prisma.transaction.findUnique({
      where: { txId_walletAddress: { txId: Number(txId), walletAddress } },
    });

    if (!txn) {
      logger.warn(`Transaction not found in DB | txId: ${txId} | wallet: ${walletAddress}`);
      return;
    }

    if (txn.status !== "PENDING") {
      logger.info(`Transaction already ${txn.status} — skip execute email | txId: ${txId}`);
      return;
    }

    if (txn.executeMailSent) {
      logger.info(`Execute email already sent | txId: ${txId}`);
      return;
    }

    const wallet = await prisma.wallet.findUnique({ where: { walletAddress } });

    if (!wallet) {
      logger.warn(`Wallet not registered | wallet: ${walletAddress}`);
      return;
    }

    await sendExecuteEmail({ email: wallet.email, walletAddress, txId, toAddress, value, token });

    await prisma.transaction.update({
      where:  { txId_walletAddress: { txId: Number(txId), walletAddress } },
      data:   { executeMailSent: true },
    });
  }

  // ─── Job: transaction-cancelled ───────────────────────────────────
  else if (name === "transaction-cancelled") {
    const { txId, walletAddress } = data;

    await prisma.transaction.updateMany({
      where: { txId: Number(txId), walletAddress },
      data:  { status: "CANCELLED" },
    });

    logger.success(`DB updated → CANCELLED | txId: ${txId} | wallet: ${walletAddress}`);
  }

  // ─── Job: transaction-executed ────────────────────────────────────
  else if (name === "transaction-executed") {
    const { txId, walletAddress } = data;

    await prisma.transaction.updateMany({
      where: { txId: Number(txId), walletAddress },
      data:  { status: "EXECUTED" },
    });

    logger.success(`DB updated → EXECUTED | txId: ${txId} | wallet: ${walletAddress}`);
  }
}

export function startWorker() {
  const worker = new Worker("transactions", processJob, {
    connection: redis,
    concurrency: 10,
  });

  worker.on("completed", (job) => {
    logger.success(`Job completed → ${job.name} | id: ${job.id}`);
  });

  worker.on("failed", (job, err) => {
    logger.error(`Job failed → ${job?.name} | id: ${job?.id} | ${err.message}`);
  });

  logger.success("BullMQ worker started");
}
