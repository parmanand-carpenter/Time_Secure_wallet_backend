import { PrismaClient } from "@prisma/client";
import { logger } from "../utils/logger.js";

const prisma = new PrismaClient();

export async function connectDB() {
  try {
    await prisma.$connect();
    logger.success("PostgreSQL connected via Prisma");
  } catch (err) {
    logger.error(`PostgreSQL connection failed: ${err.message}`);
    process.exit(1);
  }
}

export default prisma;
