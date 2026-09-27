import pg from 'pg';
import { config } from '../config.js';
import type { AccountRow, UserRole, UserRow, WhatsappSessionRow } from '../types.js';

const { Pool } = pg;

export const db = new Pool({
  connectionString: config.DATABASE_URL,
  ssl: config.DATABASE_URL.includes('neon')
    ? { rejectUnauthorized: false }
    : undefined,
});

const schemaSql = `
  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    telegram_id BIGINT UNIQUE NOT NULL,
    first_name TEXT,
    username TEXT,
    is_admin BOOLEAN DEFAULT FALSE,
    role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin', 'owner')),
    referral_code TEXT UNIQUE,
    referred_by INTEGER REFERENCES users(id),
    balance NUMERIC(12,2) DEFAULT 0,
    last_activity_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS accounts (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    phone TEXT NOT NULL,
    session_key TEXT,
    pairing_mode TEXT,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'connected', 'disconnected')),
    session_data JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_phone_per_user UNIQUE (user_id, phone)
  );

  CREATE TABLE IF NOT EXISTS whatsapp_sessions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_id INTEGER REFERENCES accounts(id) ON DELETE CASCADE,
    phone TEXT NOT NULL,
    session_key TEXT UNIQUE NOT NULL,
    pairing_mode TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'connected', 'expired', 'closed')),
    pairing_code TEXT,
    qr_data TEXT,
    expires_at TIMESTAMPTZ,
    session_data JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS warmups (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    mode TEXT NOT NULL,
    duration_hours INTEGER NOT NULL,
    delay_min INTEGER NOT NULL,
    delay_max INTEGER NOT NULL,
    account_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
    status TEXT NOT NULL DEFAULT 'running',
    started_at TIMESTAMPTZ DEFAULT NOW(),
    ends_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS activity_logs (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    confirmed_at TIMESTAMPTZ DEFAULT NOW(),
    source TEXT DEFAULT 'manual'
  );
`;

export async function initDatabase(): Promise<void> {
  await db.query(schemaSql);
}

export async function ensureUser(input: {
  telegramId: number;
  firstName?: string | null;
  username?: string | null;
  referredBy?: string | null;
}): Promise<UserRow> {
  const referralCode = `ref_${input.telegramId}`;
  const computedRole: UserRole = input.telegramId === config.BOT_OWNER_ID ? 'owner' : 'user';

  const existing = await db.query<UserRow>(
    'SELECT * FROM users WHERE telegram_id = $1 LIMIT 1',
    [input.telegramId],
  );

  if (existing.rows[0]) {
    const row = existing.rows[0];
    const nextRole = row.role === 'admin' || row.role === 'owner' ? row.role : input.telegramId === config.BOT_OWNER_ID ? 'owner' : row.role ?? computedRole;
    await db.query(
      'UPDATE users SET first_name = COALESCE($1, first_name), username = COALESCE($2, username), role = $4, is_admin = ($4 IN (\'admin\', \'owner\')), last_activity_at = NOW() WHERE telegram_id = $3',
      [input.firstName ?? row.first_name, input.username ?? row.username, input.telegramId, nextRole],
    );
    return { ...row, role: nextRole, is_admin: nextRole === 'admin' || nextRole === 'owner', last_activity_at: new Date().toISOString() };
  }

  const parent = input.referredBy
    ? await db.query<UserRow>('SELECT * FROM users WHERE referral_code = $1 LIMIT 1', [input.referredBy])
    : { rows: [] as UserRow[] };

  const userResult = await db.query<UserRow>(`
    INSERT INTO users (telegram_id, first_name, username, role, is_admin, referral_code, referred_by, last_activity_at)
    VALUES ($1, $2, $3, $4, ($4 IN ('admin', 'owner')), $5, $6, NOW())
    RETURNING *
  `, [input.telegramId, input.firstName ?? null, input.username ?? null, computedRole, referralCode, parent.rows[0]?.id ?? null]);

  const newUser = userResult.rows[0];

  if (parent.rows[0]) {
    await db.query('UPDATE users SET balance = COALESCE(balance, 0) + 0.05 WHERE id = $1', [parent.rows[0].id]);
  }

  return newUser;
}

export async function getUserByTelegramId(telegramId: number): Promise<UserRow | null> {
  const result = await db.query<UserRow>('SELECT * FROM users WHERE telegram_id = $1 LIMIT 1', [telegramId]);
  return result.rows[0] ?? null;
}

export async function listAccountsForUser(userId: number): Promise<AccountRow[]> {
  const result = await db.query<AccountRow>('SELECT * FROM accounts WHERE user_id = $1 ORDER BY created_at DESC', [userId]);
  return result.rows;
}

export async function getAccountById(accountId: number): Promise<AccountRow | null> {
  const result = await db.query<AccountRow>('SELECT * FROM accounts WHERE id = $1 LIMIT 1', [accountId]);
  return result.rows[0] ?? null;
}

export async function addAccount(input: {
  userId: number;
  phone: string;
  sessionKey: string | null;
  pairingMode: 'code' | 'qr';
  status?: 'pending' | 'connected' | 'disconnected';
  sessionData?: Record<string, unknown>;
}): Promise<AccountRow> {
  const result = await db.query<AccountRow>(`
    INSERT INTO accounts (user_id, phone, session_key, pairing_mode, status, session_data, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, NOW())
    ON CONFLICT (user_id, phone)
    DO UPDATE SET session_key = EXCLUDED.session_key, pairing_mode = EXCLUDED.pairing_mode, status = EXCLUDED.status, session_data = EXCLUDED.session_data, updated_at = NOW()
    RETURNING *
  `, [input.userId, input.phone, input.sessionKey ?? null, input.pairingMode, input.status ?? 'pending', input.sessionData ?? {}]);

  return result.rows[0];
}

export async function deleteAccount(accountId: number, userId: number): Promise<boolean> {
  const result = await db.query('DELETE FROM accounts WHERE id = $1 AND user_id = $2', [accountId, userId]);
  return (result.rowCount ?? 0) > 0;
}

export async function updateActivity(telegramId: number): Promise<void> {
  await db.query('UPDATE users SET last_activity_at = NOW() WHERE telegram_id = $1', [telegramId]);
}

export async function confirmActivity(telegramId: number): Promise<void> {
  const user = await getUserByTelegramId(telegramId);
  if (!user) return;

  await db.query('INSERT INTO activity_logs (user_id, source) VALUES ($1, $2)', [user.id, 'manual']);
  await db.query('UPDATE users SET last_activity_at = NOW() WHERE telegram_id = $1', [telegramId]);
}

export async function listUsersForAdmin(): Promise<UserRow[]> {
  const result = await db.query<UserRow>('SELECT * FROM users ORDER BY created_at DESC');
  return result.rows;
}

export async function setUserRole(telegramId: number, role: UserRole): Promise<void> {
  await db.query('UPDATE users SET role = $1, is_admin = ($1 IN (\'admin\', \'owner\')) WHERE telegram_id = $2', [role, telegramId]);
}

export async function isAdminUser(telegramId: number): Promise<boolean> {
  const result = await db.query<{ role: UserRole }>('SELECT role FROM users WHERE telegram_id = $1 LIMIT 1', [telegramId]);
  const role = result.rows[0]?.role;
  return role === 'admin' || role === 'owner';
}

export async function getAdminStats(): Promise<{ users: number; accounts: number; active: number; admins: number; owners: number; sessions: number; pendingSessions: number; connectedSessions: number }> {
  const stats = await db.query(`
    SELECT
      (SELECT COUNT(*) FROM users) AS users,
      (SELECT COUNT(*) FROM accounts) AS accounts,
      (SELECT COUNT(*) FROM users WHERE last_activity_at >= NOW() - INTERVAL '10 minutes') AS active,
      (SELECT COUNT(*) FROM users WHERE role = 'admin') AS admins,
      (SELECT COUNT(*) FROM users WHERE role = 'owner') AS owners,
      (SELECT COUNT(*) FROM whatsapp_sessions) AS sessions,
      (SELECT COUNT(*) FROM whatsapp_sessions WHERE status = 'pending') AS pending_sessions,
      (SELECT COUNT(*) FROM whatsapp_sessions WHERE status = 'connected') AS connected_sessions
  `);

  return {
    users: Number(stats.rows[0]?.users ?? 0),
    accounts: Number(stats.rows[0]?.accounts ?? 0),
    active: Number(stats.rows[0]?.active ?? 0),
    admins: Number(stats.rows[0]?.admins ?? 0),
    owners: Number(stats.rows[0]?.owners ?? 0),
    sessions: Number(stats.rows[0]?.sessions ?? 0),
    pendingSessions: Number(stats.rows[0]?.pending_sessions ?? 0),
    connectedSessions: Number(stats.rows[0]?.connected_sessions ?? 0),
  };
}

export async function updateAccountStatus(
  accountId: number,
  status: 'pending' | 'connected' | 'disconnected',
  sessionData?: Record<string, unknown>,
): Promise<void> {
  await db.query(
    'UPDATE accounts SET status = $1, session_data = COALESCE($2, session_data), updated_at = NOW() WHERE id = $3',
    [status, sessionData ?? null, accountId],
  );
}

export async function saveAccountSession(accountId: number, sessionKey: string, sessionData: Record<string, unknown>): Promise<void> {
  await db.query(
    'UPDATE accounts SET session_key = $1, session_data = $2, status = $3, updated_at = NOW() WHERE id = $4',
    [sessionKey, sessionData, 'connected', accountId],
  );
}

export async function endWarmupForUser(userId: number): Promise<void> {
  await db.query('UPDATE warmups SET status = $1 WHERE user_id = $2 AND status = $3', ['stopped', userId, 'running']);
}

export async function countAccountsByUser(userId: number): Promise<number> {
  const result = await db.query('SELECT COUNT(*) AS total FROM accounts WHERE user_id = $1', [userId]);
  return Number(result.rows[0]?.total ?? 0);
}

export async function isPhoneTaken(userId: number, phone: string): Promise<boolean> {
  const result = await db.query('SELECT 1 FROM accounts WHERE user_id = $1 AND phone = $2 LIMIT 1', [userId, phone]);
  return result.rowCount !== null && result.rowCount > 0;
}

export async function listAllUsersWithAccounts(): Promise<Array<{ user: UserRow; accounts: AccountRow[] }>> {
  const users = await listUsersForAdmin();
  const output: Array<{ user: UserRow; accounts: AccountRow[] }> = [];

  for (const user of users) {
    const accounts = await listAccountsForUser(user.id);
    output.push({ user, accounts });
  }

  return output;
}

export async function recordWarmupJob(input: {
  userId: number;
  mode: 'one_to_one' | 'one_to_all';
  durationHours: number;
  delayMin: number;
  delayMax: number;
  accountIds: number[];
}): Promise<void> {
  await db.query(
    `INSERT INTO warmups (user_id, mode, duration_hours, delay_min, delay_max, account_ids, status, started_at, ends_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'running', NOW(), NOW() + ($3 * interval '1 hour'))`,
    [input.userId, input.mode, input.durationHours, input.delayMin, input.delayMax, JSON.stringify(input.accountIds)],
  );
}

export async function createWhatsappSession(input: {
  userId: number;
  accountId: number | null;
  phone: string;
  pairingMode: 'code' | 'qr';
  sessionKey: string;
  pairingCode?: string | null;
  qrData?: string | null;
  expiresAt?: Date | null;
  sessionData?: Record<string, unknown>;
}): Promise<WhatsappSessionRow> {
  const result = await db.query<WhatsappSessionRow>(`
    INSERT INTO whatsapp_sessions (user_id, account_id, phone, session_key, pairing_mode, status, pairing_code, qr_data, expires_at, session_data, updated_at)
    VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7, $8, $9, NOW())
    RETURNING *
  `, [
    input.userId,
    input.accountId,
    input.phone,
    input.sessionKey,
    input.pairingMode,
    input.pairingCode ?? null,
    input.qrData ?? null,
    input.expiresAt ? input.expiresAt.toISOString() : null,
    input.sessionData ?? {},
  ]);

  return result.rows[0];
}

export async function getWhatsappSessionByKey(sessionKey: string): Promise<WhatsappSessionRow | null> {
  const result = await db.query<WhatsappSessionRow>('SELECT * FROM whatsapp_sessions WHERE session_key = $1 LIMIT 1', [sessionKey]);
  return result.rows[0] ?? null;
}

export async function updateWhatsappSession(sessionKey: string, patch: Partial<WhatsappSessionRow>): Promise<WhatsappSessionRow | null> {
  const fields: string[] = [];
  const values: unknown[] = [];
  let index = 1;

  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) {
      fields.push(`${key} = $${index}`);
      values.push(value);
      index += 1;
    }
  }

  if (!fields.length) {
    return getWhatsappSessionByKey(sessionKey);
  }

  values.push(sessionKey);
  const result = await db.query<WhatsappSessionRow>(`UPDATE whatsapp_sessions SET ${fields.join(', ')}, updated_at = NOW() WHERE session_key = $${index} RETURNING *`, values);
  return result.rows[0] ?? null;
}

export async function deleteWhatsappSession(sessionKey: string): Promise<void> {
  await db.query('DELETE FROM whatsapp_sessions WHERE session_key = $1', [sessionKey]);
}

export async function listWhatsappSessionsForUser(userId: number): Promise<WhatsappSessionRow[]> {
  const result = await db.query<WhatsappSessionRow>('SELECT * FROM whatsapp_sessions WHERE user_id = $1 ORDER BY created_at DESC', [userId]);
  return result.rows;
}

export async function findExpiredSessions(): Promise<WhatsappSessionRow[]> {
  const result = await db.query<WhatsappSessionRow>(
    "SELECT * FROM whatsapp_sessions WHERE status IN ('pending', 'connected') AND expires_at IS NOT NULL AND expires_at < NOW()",
  );
  return result.rows;
}
