import type { Telegraf } from 'telegraf';
import { config } from '../config.js';
import { getAdminStats, isAdminUser, listAllUsersWithAccounts, setUserRole } from '../db/index.js';

export const adminService = {
  async isAdmin(telegramId: number): Promise<boolean> {
    return isAdminUser(telegramId);
  },

  async setAdminRole(telegramId: number, role: 'admin' | 'owner'): Promise<void> {
    await setUserRole(telegramId, role);
  },

  async getOverview() {
    return getAdminStats();
  },

  async getUsers() {
    return listAllUsersWithAccounts();
  },

  async broadcast(bot: Telegraf, text: string, excludeAdmins = true): Promise<number> {
    const users = await this.getUsers();
    let sent = 0;

    for (const item of users) {
      if (excludeAdmins && (item.user.role === 'admin' || item.user.role === 'owner')) {
        continue;
      }

      try {
        await bot.telegram.sendMessage(item.user.telegram_id, text);
        sent += 1;
      } catch {
        // ignore failed recipients
      }
    }

    return sent;
  },

  requireToken(token: string | undefined): boolean {
    return token === config.ADMIN_API_TOKEN;
  },
};
