import { config } from './config.js';
import { initDatabase } from './db/index.js';
import { startBot } from './bot/bot.js';
import { startApiServer } from './api/server.js';
import { startCronJobs } from './services/cronService.js';

async function bootstrap(): Promise<void> {
  await initDatabase();

  const bot = await startBot();
  startCronJobs(bot);
  startApiServer(bot, config.PORT);

  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

void bootstrap();
