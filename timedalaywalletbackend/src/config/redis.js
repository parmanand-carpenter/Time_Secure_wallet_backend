import Redis from "ioredis";
import { env } from "./env.js";
import { logger } from "../utils/logger.js";

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
});

redis.on("connect", () => logger.success("Redis connected"));
redis.on("error",   (err) => logger.error(`Redis error: ${err.message}`));
