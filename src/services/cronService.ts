import cron from 'node-cron';
import type { Telegraf } from 'telegraf';
import { config } from '../config.js';
import { findExpiredSessions, listAllUsersWithAccounts } from '../db/index.js';
import { whatsappService } from './whatsappService.js';

export function startCronJobs(bot: Telegraf): void {
  cron.schedule('*/10 * * * *', async () => {
    const users = await listAllUsersWithAccounts();

    for (const item of users) {
      const elapsedMinutes = (Date.now() - new Date(item.user.last_activity_at).getTime()) / 60000;
      if (elapsedMinutes <= 10) {
        continue;
      }

      try {
        await bot.telegram.sendMessage(
          item.user.telegram_id,
          'Подтвердите активность: каждые 10 минут нужно подтверждать работу аккаунта.',
        );
      } catch {
        // ignore invalid recipients
      }
    }
  });

  cron.schedule('* * * * *', async () => {
    const expired = await findExpiredSessions();

    for (const session of expired) {
      try {
        if (session.session_key) {
          await whatsappService.logoutSession(session.session_key);
        }
      } catch {
        // ignore stale session cleanup failures
      }
    }
  });

  if (config.NODE_ENV !== 'production') {
    console.log('cron jobs started');
  }
}
