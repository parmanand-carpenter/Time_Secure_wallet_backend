import dotenv from "dotenv";
dotenv.config();

const required = [
  "RPC_URL",
  "FACTORY_ADDRESS",
  "XHAVIC_RPC_URL",
  "XHAVIC_FACTORY_ADDRESS",
  "DATABASE_URL",
  "REDIS_URL",
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_USER",
  "SMTP_PASS",
  "EMAIL_FROM",
  "PORT",
  "FRONTEND_URL",
];

for (const key of required) {
  if (!process.env[key]) {
    console.error(`[ENV] Missing required env variable: ${key}`);
    process.exit(1);
  }
}

export const env = {
  RPC_URL:                 process.env.RPC_URL,
  FACTORY_ADDRESS:         process.env.FACTORY_ADDRESS,
  XHAVIC_RPC_URL:          process.env.XHAVIC_RPC_URL,
  XHAVIC_FACTORY_ADDRESS:  process.env.XHAVIC_FACTORY_ADDRESS,
  DATABASE_URL:     process.env.DATABASE_URL,
  REDIS_URL:        process.env.REDIS_URL,
  SMTP_HOST:        process.env.SMTP_HOST,
  SMTP_PORT:        Number(process.env.SMTP_PORT),
  SMTP_USER:        process.env.SMTP_USER,
  SMTP_PASS:        process.env.SMTP_PASS,
  EMAIL_FROM:       process.env.EMAIL_FROM,
  PORT:             Number(process.env.PORT) || 3000,
  FRONTEND_URL:     process.env.FRONTEND_URL,
};
