import dotenv from 'dotenv';

dotenv.config();

export const config = {
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN ?? '',
  BOT_USERNAME: process.env.BOT_USERNAME ?? 'your_bot_username',
  DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/whatsapp_warmup',
  PORT: Number(process.env.PORT ?? 3000),
  APP_URL: process.env.APP_URL ?? 'http://localhost:3000',
  BOT_OWNER_ID: Number(process.env.BOT_OWNER_ID ?? 0),
  ADMIN_API_TOKEN: process.env.ADMIN_API_TOKEN ?? 'change-me-admin-token',
  MAX_ACCOUNTS_PER_USER: Number(process.env.MAX_ACCOUNTS_PER_USER ?? 10),
  ACTIVITY_CHECK_SECONDS: Number(process.env.ACTIVITY_CHECK_SECONDS ?? 600),
  SESSION_TTL_MINUTES: Number(process.env.SESSION_TTL_MINUTES ?? 60),
  PAIRING_TTL_SECONDS: Number(process.env.PAIRING_TTL_SECONDS ?? 90),
  NODE_ENV: process.env.NODE_ENV ?? 'development',
};
