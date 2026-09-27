import { Telegraf } from 'telegraf';
import { config } from '../config.js';
import {
  addAccount,
  confirmActivity,
  countAccountsByUser,
  deleteAccount,
  ensureUser,
  getAdminStats,
  getUserByTelegramId,
  isAdminUser,
  isPhoneTaken,
  listAccountsForUser,
  listAllUsersWithAccounts,
  listWhatsappSessionsForUser,
  setUserRole,
  updateActivity,
} from '../db/index.js';
import { pairingService } from '../services/pairingService.js';
import { warmupService } from '../services/warmupService.js';
import {
  buildAccountListKeyboard,
  buildAdminPanelKeyboard,
  buildAdminUsersKeyboard,
  buildDeleteConfirmKeyboard,
  buildMainMenu,
  buildModeKeyboard,
  buildPairingActions,
  buildUserManagementKeyboard,
  buildWarmupSettingsKeyboard,
} from './keyboards.js';

const pendingAddMode = new Map<number, 'code' | 'qr'>();
const pendingBroadcast = new Map<number, boolean>();
const warmupConfig = new Map<number, { mode: 'one_to_one' | 'one_to_all'; durationHours: number; delayMin: number; delayMax: number }>();

const phoneRegex = /^(?:\+7|7|8)\d{10}$|^9\d{9}$/;

export async function startBot(): Promise<Telegraf> {
  const bot = new Telegraf(config.TELEGRAM_BOT_TOKEN);

  bot.start(async (ctx) => {
    const from = ctx.from;
    if (!from) {
      return;
    }

    const user = await ensureUser({
      telegramId: from.id,
      firstName: from.first_name,
      username: from.username,
    });

    await updateActivity(from.id);
    await ctx.reply(`Привет, ${user.first_name ?? 'друг'}!`, {
      reply_markup: buildMainMenu(await isAdminUser(from.id)),
    });
  });

  bot.command('menu', async (ctx) => {
    const user = await getUserByTelegramId(ctx.from?.id ?? 0);
    await ctx.reply('Главное меню', { reply_markup: buildMainMenu(Boolean(user && (user.role === 'admin' || user.role === 'owner'))) });
  });

  bot.action('main_menu', async (ctx) => {
    const user = await getUserByTelegramId(ctx.from?.id ?? 0);
    await ctx.answerCbQuery('Главное меню');
    await ctx.editMessageText('Главное меню', { reply_markup: buildMainMenu(Boolean(user && (user.role === 'admin' || user.role === 'owner'))) });
  });

  bot.action('add_account', async (ctx) => {
    await ctx.answerCbQuery('Выберите способ подключения');
    await ctx.editMessageText('Выберите способ подключения аккаунта', { reply_markup: buildModeKeyboard() });
  });

  bot.action('mode_code', async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) {
      return;
    }

    pendingAddMode.set(userId, 'code');
    await ctx.answerCbQuery('Подтвержден тип: код 8');
    await ctx.editMessageText('Введите номер телефона в формате: +7XXXXXXXXXX или 8XXXXXXXXXX', {
      reply_markup: buildModeKeyboard(),
    });
  });

  bot.action('mode_qr', async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) {
      return;
    }

    pendingAddMode.set(userId, 'qr');
    await ctx.answerCbQuery('Подтвержден тип: QR');
    await ctx.editMessageText('Введите номер телефона в формате: +7XXXXXXXXXX или 8XXXXXXXXXX', {
      reply_markup: buildModeKeyboard(),
    });
  });

  bot.action('my_accounts', async (ctx) => {
    const user = await getUserByTelegramId(ctx.from?.id ?? 0);
    if (!user) {
      return;
    }

    const accounts = await listAccountsForUser(user.id);
    const keyboard = buildAccountListKeyboard(accounts);
    await ctx.answerCbQuery('Список аккаунтов');
    await ctx.editMessageText('Ваши аккаунты:', { reply_markup: keyboard });
  });

  bot.action(/^delete_account_(\d+)$/, async (ctx) => {
    const match = ctx.match?.[0] ?? '';
    const accountId = Number(match.replace(/[^\d]/g, ''));
    const user = await getUserByTelegramId(ctx.from?.id ?? 0);
    if (!user) {
      return;
    }

    await ctx.answerCbQuery('Подтвердите удаление');
    await ctx.editMessageText('Вы уверены, что хотите удалить номер?', {
      reply_markup: buildDeleteConfirmKeyboard(accountId),
    });
  });

  bot.action(/^confirm_delete_account_(\d+)$/, async (ctx) => {
    const accountId = Number((ctx.match?.[0] ?? '').replace(/[^\d]/g, ''));
    const user = await getUserByTelegramId(ctx.from?.id ?? 0);
    if (!user) {
      return;
    }

    const deleted = await deleteAccount(accountId, user.id);
    if (deleted) {
      await ctx.answerCbQuery('Номер успешно удалён');
      const accounts = await listAccountsForUser(user.id);
      await ctx.editMessageText('Список аккаунтов после удаления:', {
        reply_markup: buildAccountListKeyboard(accounts),
      });
    }
  });

  bot.action('warmup_settings', async (ctx) => {
    await ctx.answerCbQuery('Выберите тип прогрева');
    await ctx.editMessageText('Настройка прогрева', {
      reply_markup: buildWarmupSettingsKeyboard(),
    });
  });

  bot.action('warmup_type_one_to_one', async (ctx) => {
    const userId = ctx.from?.id ?? 0;
    const existing = warmupConfig.get(userId) ?? { mode: 'one_to_one', durationHours: 6, delayMin: 20, delayMax: 250 };
    warmupConfig.set(userId, { ...existing, mode: 'one_to_one' });
    await ctx.answerCbQuery('Тип: 1 к 1');
    await ctx.editMessageText('Настройка прогрева', { reply_markup: buildWarmupSettingsKeyboard() });
  });

  bot.action('warmup_type_one_to_all', async (ctx) => {
    const userId = ctx.from?.id ?? 0;
    const existing = warmupConfig.get(userId) ?? { mode: 'one_to_all', durationHours: 6, delayMin: 20, delayMax: 250 };
    warmupConfig.set(userId, { ...existing, mode: 'one_to_all' });
    await ctx.answerCbQuery('Тип: 1 ко всем');
    await ctx.editMessageText('Настройка прогрева', { reply_markup: buildWarmupSettingsKeyboard() });
  });

  bot.action('warmup_duration_6', async (ctx) => {
    const userId = ctx.from?.id ?? 0;
    const existing = warmupConfig.get(userId) ?? { mode: 'one_to_one', durationHours: 6, delayMin: 20, delayMax: 250 };
    warmupConfig.set(userId, { ...existing, durationHours: 6 });
    await ctx.answerCbQuery('Длительность: 6 часов');
    await ctx.editMessageText('Настройка прогрева', { reply_markup: buildWarmupSettingsKeyboard() });
  });

  bot.action('warmup_duration_12', async (ctx) => {
    const userId = ctx.from?.id ?? 0;
    const existing = warmupConfig.get(userId) ?? { mode: 'one_to_one', durationHours: 12, delayMin: 20, delayMax: 250 };
    warmupConfig.set(userId, { ...existing, durationHours: 12 });
    await ctx.answerCbQuery('Длительность: 12 часов');
    await ctx.editMessageText('Настройка прогрева', { reply_markup: buildWarmupSettingsKeyboard() });
  });

  bot.command('start_warmup', async (ctx) => {
    const user = await getUserByTelegramId(ctx.from?.id ?? 0);
    if (!user) {
      return;
    }

    const accounts = await listAccountsForUser(user.id);
    if (accounts.length < 2) {
      await ctx.reply('Добавьте минимум 2 аккаунта, чтобы запустить прогрев.');
      return;
    }

    const configForUser = warmupConfig.get(user.id) ?? { mode: 'one_to_one', durationHours: 6, delayMin: 20, delayMax: 250 };

    if (configForUser.delayMin < 20 || configForUser.delayMin > 250 || configForUser.delayMax < 20 || configForUser.delayMax > 250) {
      await ctx.reply('Лимит задержки: 20-250 секунд. Настройка сброшена до стартовых значений.');
      configForUser.delayMin = 20;
      configForUser.delayMax = 250;
    }

    if (accounts.length <= 2 && configForUser.delayMin < 60) {
      await ctx.reply('Предупреждение: при малом числе аккаунтов задержка ниже 60 сек может выглядеть агрессивно.');
    }

    const job = warmupService.startWarmup({
      userId: user.id,
      accountIds: accounts.map((account) => account.id),
      mode: configForUser.mode,
      durationHours: configForUser.durationHours,
      delayMin: configForUser.delayMin,
      delayMax: configForUser.delayMax,
    });

    await ctx.reply(`Прогрев запущен. Тип: ${job.mode}. Длительность: ${job.durationHours} часов. Сессия активна до ${new Date(job.endsAt).toISOString()}.`);
  });

  bot.command('accounts', async (ctx) => {
    const user = await getUserByTelegramId(ctx.from?.id ?? 0);
    if (!user) {
      return;
    }

    const accounts = await listAccountsForUser(user.id);
    await ctx.reply('Ваши аккаунты:', { reply_markup: buildAccountListKeyboard(accounts) });
  });

  bot.command('activity', async (ctx) => {
    const user = await getUserByTelegramId(ctx.from?.id ?? 0);
    if (!user) {
      return;
    }

    await confirmActivity(user.telegram_id);
    await ctx.reply('Подтверждение активности сохранено.');
  });

  bot.command('admin', async (ctx) => {
    const userId = ctx.from?.id ?? 0;
    const isAdmin = await isAdminUser(userId);
    if (!isAdmin) {
      await ctx.reply('Нет доступа к админ-панели.');
      return;
    }

    await ctx.reply('Админ-панель', { reply_markup: buildAdminPanelKeyboard() });
  });

  bot.action('admin_menu', async (ctx) => {
    const userId = ctx.from?.id ?? 0;
    const isAdmin = await isAdminUser(userId);
    if (!isAdmin) {
      await ctx.answerCbQuery('Доступ закрыт');
      return;
    }

    await ctx.answerCbQuery('Админ-панель');
    await ctx.editMessageText('Админ-панель', { reply_markup: buildAdminPanelKeyboard() });
  });

  bot.action('admin_stats', async (ctx) => {
    const stats = await getAdminStats();
    const text = [
      '📊 Статистика сервиса',
      `Пользователи: ${stats.users}`,
      `Администраторы: ${stats.admins}`,
      `Владельцы: ${stats.owners}`,
      `Аккаунты: ${stats.accounts}`,
      `Сессии: ${stats.sessions}`,
      `Активные за 10 минут: ${stats.active}`,
      `Ожидают подтверждения: ${stats.pendingSessions}`,
      `Подключены: ${stats.connectedSessions}`,
    ].join('\n');
    await ctx.answerCbQuery('Статистика загружена');
    await ctx.editMessageText(text, { reply_markup: buildAdminPanelKeyboard() });
  });

  bot.action('admin_users', async (ctx) => {
    const users = await listAllUsersWithAccounts();
    const list = users.map(({ user, accounts }) => ({
      id: user.id,
      telegramId: user.telegram_id,
      name: user.first_name ?? user.username ?? `user_${user.telegram_id}`,
      role: user.role,
      accounts: accounts.length,
      sessions: 0,
    }));

    for (const item of list) {
      const sessions = await listWhatsappSessionsForUser(item.id);
      item.sessions = sessions.length;
    }

    const text = list.length
      ? list.map((user) => `• ${user.name} — ${user.role} | аккаунты: ${user.accounts} | сессии: ${user.sessions}`).join('\n')
      : 'Пользователи не найдены.';

    await ctx.answerCbQuery('Список пользователей');
    await ctx.editMessageText(text, { reply_markup: buildAdminUsersKeyboard(list) });
  });

  bot.action(/^user_manage_(\d+)$/, async (ctx) => {
    const telegramId = Number((ctx.match?.[0] ?? '').replace(/\D/g, ''));
    const user = await getUserByTelegramId(telegramId);
    if (!user) {
      await ctx.answerCbQuery('Пользователь не найден');
      return;
    }

    const accounts = await listAccountsForUser(user.id);
    const sessions = await listWhatsappSessionsForUser(user.id);
    const text = [
      `👤 ${user.first_name ?? user.username ?? `user_${user.telegram_id}`}`,
      `Роль: ${user.role}`,
      `Аккаунтов: ${accounts.length}`,
      `Сессий: ${sessions.length}`,
    ].join('\n');

    await ctx.answerCbQuery('Управление пользователем');
    await ctx.editMessageText(text, { reply_markup: buildUserManagementKeyboard(user.telegram_id, user.role) });
  });

  bot.action(/^set_user_role_(\d+)_(user|admin|owner)$/, async (ctx) => {
    const telegramId = Number(ctx.match?.[1] ?? 0);
    const role = ctx.match?.[2] as 'user' | 'admin' | 'owner';
    const targetUser = await getUserByTelegramId(telegramId);
    if (!targetUser) {
      await ctx.answerCbQuery('Пользователь не найден');
      return;
    }

    await setUserRole(targetUser.telegram_id, role);
    await ctx.answerCbQuery(`Роль изменена на ${role}`);
    const text = `👤 ${targetUser.first_name ?? targetUser.username ?? `user_${targetUser.telegram_id}`}\nНовая роль: ${role}`;
    await ctx.editMessageText(text, { reply_markup: buildUserManagementKeyboard(targetUser.telegram_id, role) });
  });

  bot.action('admin_broadcast', async (ctx) => {
    const user = await getUserByTelegramId(ctx.from?.id ?? 0);
    if (!user || !isAdminUser(user.telegram_id)) {
      return;
    }

    pendingBroadcast.set(user.telegram_id, true);
    await ctx.answerCbQuery('Готово к рассылке');
    await ctx.reply('Введите текст рассылки для всех пользователей.');
  });

  bot.on('text', async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) {
      return;
    }

    if (pendingBroadcast.get(telegramId)) {
      pendingBroadcast.delete(telegramId);
      const users = await listAllUsersWithAccounts();
      const text = ctx.message.text;
      for (const item of users) {
        try {
          await ctx.telegram.sendMessage(item.user.telegram_id, text);
        } catch {
          // ignore invalid chat ids
        }
      }
      await ctx.reply('Рассылка отправлена всем пользователям.');
      return;
    }

    const mode = pendingAddMode.get(telegramId);
    if (!mode) {
      return;
    }

    const rawPhone = ctx.message.text.trim();
    const normalized = rawPhone.replace(/\D/g, '');
    if (!phoneRegex.test(rawPhone) && !phoneRegex.test(normalized)) {
      await ctx.reply('Номер введён не в корректном формате. Используйте +7XXXXXXXXXX или 8XXXXXXXXXX.');
      return;
    }

    const finalPhone = normalized.startsWith('8') ? `7${normalized.slice(1)}` : normalized;

    const user = await getUserByTelegramId(telegramId);
    if (!user) {
      await ctx.reply('Сначала нажмите /start.');
      return;
    }

    const count = await countAccountsByUser(user.id);
    if (count >= config.MAX_ACCOUNTS_PER_USER) {
      await ctx.reply(`Лимит аккаунтов: ${config.MAX_ACCOUNTS_PER_USER}. Удалите лишние номера или увеличьте лимит в .env.`);
      pendingAddMode.delete(telegramId);
      return;
    }

    if (await isPhoneTaken(user.id, finalPhone)) {
      await ctx.reply('Такой номер уже добавлен.');
      pendingAddMode.delete(telegramId);
      return;
    }

    const result = await pairingService.createPairingSession({
      telegramId: telegramId,
      phone: finalPhone,
      mode,
    });

    pendingAddMode.delete(telegramId);

    if (mode === 'qr') {
      await ctx.replyWithPhoto({ url: result.qrData ?? '' }, {
        caption: 'Отсканируйте QR-код в WhatsApp > Подключить устройство',
      });
    } else {
      await ctx.reply(`Код подключения: ${result.code ?? '—'}. Он действует около 90 секунд.`, {
        reply_markup: buildPairingActions(result.sessionKey),
      });
    }

    if (mode === 'qr') {
      await ctx.reply('После подключения нажмите кнопку ниже.', {
        reply_markup: buildPairingActions(result.sessionKey),
      });
    }
  });

  bot.action(/^activate_pairing_(.+)$/, async (ctx) => {
    const sessionKey = ctx.match?.[1] ?? '';
    const result = await pairingService.confirmSession(sessionKey);
    const user = await getUserByTelegramId(ctx.from?.id ?? 0);
    if (!user) {
      return;
    }

    if (result.connected) {
      await ctx.answerCbQuery('Аккаунт активирован');
      await ctx.editMessageText('Аккаунт успешно активирован и сохранён.');
    } else {
      await ctx.answerCbQuery('Аккаунт ещё не вошёл в WhatsApp');
    }
  });

  bot.action(/^retry_pairing_(.+)$/, async (ctx) => {
    const sessionKey = ctx.match?.[1] ?? '';
    try {
      const result = await pairingService.retrySession(sessionKey);
      await ctx.answerCbQuery('Новый код отправлен');
      if (result.mode === 'qr') {
        await ctx.replyWithPhoto({ url: result.qrData ?? '' }, {
          caption: 'Новый QR-код для подключения',
        });
      } else {
        await ctx.reply(`Новый код: ${result.code ?? '—'}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown_error';
      await ctx.reply(`Не удалось повторить подключение: ${message}`);
    }
  });

  bot.command('ref', async (ctx) => {
    const user = await getUserByTelegramId(ctx.from?.id ?? 0);
    if (!user) {
      return;
    }

    const link = `https://t.me/${config.BOT_USERNAME}?start=${user.referral_code ?? 'ref'}`;
    await ctx.reply(`Реферальная ссылка: ${link}\nВы получаете 5% от выплат приглашённых пользователей.`);
  });

  const activityCheck = async () => {
    const users = await listAllUsersWithAccounts();
    for (const item of users) {
      const lastActivity = new Date(item.user.last_activity_at).getTime();
      const elapsedMinutes = (Date.now() - lastActivity) / 60000;
      if (elapsedMinutes > 10) {
        try {
          await bot.telegram.sendMessage(item.user.telegram_id, 'Подтвердите активность — каждые 10 минут нужно подтверждать вход в систему.', {
            reply_markup: { inline_keyboard: [[{ text: '✅ Подтвердить активность', callback_data: 'activity_confirm' }]] },
          });
        } catch {
          // ignore invalid recipients
        }
      }
    }
  };

  bot.action('activity_confirm', async (ctx) => {
    const user = await getUserByTelegramId(ctx.from?.id ?? 0);
    if (!user) {
      return;
    }

    await confirmActivity(user.telegram_id);
    await ctx.answerCbQuery('Активность подтверждена');
  });

  setInterval(() => {
    void activityCheck();
  }, (config.ACTIVITY_CHECK_SECONDS ?? 600) * 1000);

  await bot.launch();
  console.log(`Telegram bot started for ${config.BOT_USERNAME}`);
  return bot;
}
