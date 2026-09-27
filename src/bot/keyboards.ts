import { Markup } from 'telegraf';
import type { UserRole } from '../types.js';

export const buildMainMenu = (showAdmin = false) => ({
  inline_keyboard: [
    [Markup.button.callback('➕ Добавить аккаунт', 'add_account')],
    [Markup.button.callback('📋 Мои аккаунты', 'my_accounts')],
    [Markup.button.callback('⚙️ Настройки прогрева', 'warmup_settings')],
    ...(showAdmin ? [[Markup.button.callback('🧩 Админ-панель', 'admin_menu')]] : []),
  ],
});

export const buildModeKeyboard = () => ({
  inline_keyboard: [
    [Markup.button.callback('8-значный код', 'mode_code')],
    [Markup.button.callback('QR-код', 'mode_qr')],
    [Markup.button.callback('⬅️ Назад', 'main_menu')],
  ],
});

export const buildWarmupSettingsKeyboard = () => ({
  inline_keyboard: [
    [Markup.button.callback('1 к 1', 'warmup_type_one_to_one')],
    [Markup.button.callback('1 ко всем', 'warmup_type_one_to_all')],
    [Markup.button.callback('6 часов', 'warmup_duration_6')],
    [Markup.button.callback('12 часов', 'warmup_duration_12')],
    [Markup.button.callback('⬅️ Главное меню', 'main_menu')],
  ],
});

export const buildAccountListKeyboard = (accounts: Array<{ id: number; phone: string }>) => {
  const rows = accounts.map((account) => [Markup.button.callback(`🗑 ${account.phone}`, `delete_account_${account.id}`)]);
  rows.push([Markup.button.callback('➕ Добавить аккаунт', 'add_account')]);
  rows.push([Markup.button.callback('⬅️ Главное меню', 'main_menu')]);
  return { inline_keyboard: rows };
};

export const buildDeleteConfirmKeyboard = (accountId: number) => ({
  inline_keyboard: [
    [Markup.button.callback('✅ Подтвердить удаление', `confirm_delete_account_${accountId}`)],
    [Markup.button.callback('❌ Отмена', 'my_accounts')],
  ],
});

export const buildAdminPanelKeyboard = () => ({
  inline_keyboard: [
    [Markup.button.callback('📊 Статистика', 'admin_stats')],
    [Markup.button.callback('👥 Все пользователи', 'admin_users')],
    [Markup.button.callback('📢 Рассылка', 'admin_broadcast')],
    [Markup.button.callback('⬅️ Главное меню', 'main_menu')],
  ],
});

export const buildUserManagementKeyboard = (telegramId: number, role: UserRole) => ({
  inline_keyboard: [
    [Markup.button.callback(role === 'user' ? '✅ Выдать user' : '➡️ user', `set_user_role_${telegramId}_user`)],
    [Markup.button.callback(role === 'admin' ? '✅ Выдать admin' : '➡️ admin', `set_user_role_${telegramId}_admin`)],
    [Markup.button.callback(role === 'owner' ? '✅ Выдать owner' : '➡️ owner', `set_user_role_${telegramId}_owner`)],
    [Markup.button.callback('⬅️ Назад к списку', 'admin_users')],
  ],
});

export const buildAdminUsersKeyboard = (users: Array<{ telegramId: number; name: string; role: UserRole; accounts: number; sessions: number }>) => ({
  inline_keyboard: users.map((user) => [{
    text: `${user.name} · ${user.role} · ${user.accounts}/${user.sessions}`,
    callback_data: `user_manage_${user.telegramId}`,
  }])
    .concat([[Markup.button.callback('⬅️ Главное меню', 'main_menu')]]),
});

export const buildPairingActions = (sessionKey: string) => ({
  inline_keyboard: [
    [Markup.button.callback('✅ Активировал', `activate_pairing_${sessionKey}`)],
    [Markup.button.callback('🔄 Повтор', `retry_pairing_${sessionKey}`)],
  ],
});
