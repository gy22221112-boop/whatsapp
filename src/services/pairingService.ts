import { config } from '../config.js';
import {
  addAccount,
  countAccountsByUser,
  createWhatsappSession,
  getUserByTelegramId,
  getWhatsappSessionByKey,
  isPhoneTaken,
  saveAccountSession,
  updateAccountStatus,
  updateWhatsappSession,
} from '../db/index.js';
import { whatsappService, type PairingSessionResult } from './whatsappService.js';

export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (!digits) {
    return digits;
  }

  if (digits.startsWith('8')) {
    return `7${digits.slice(1)}`;
  }

  if (digits.startsWith('+7')) {
    return digits.slice(1);
  }

  return digits;
}

export function isValidPhone(phone: string): boolean {
  const normalized = normalizePhone(phone);
  return /^(?:7|9)\d{9}$/.test(normalized);
}

export interface CreatePairingPayload {
  telegramId: number;
  phone: string;
  mode: 'code' | 'qr';
}

export const pairingService = {
  async createPairingSession(payload: CreatePairingPayload): Promise<PairingSessionResult & { accountId: number }> {
    const user = await getUserByTelegramId(payload.telegramId);
    if (!user) {
      throw new Error('USER_NOT_FOUND');
    }

    const candidate = normalizePhone(payload.phone);
    if (!isValidPhone(candidate)) {
      throw new Error('INVALID_PHONE');
    }

    const accountCount = await countAccountsByUser(user.id);
    if (accountCount >= config.MAX_ACCOUNTS_PER_USER) {
      throw new Error('ACCOUNT_LIMIT_REACHED');
    }

    if (await isPhoneTaken(user.id, candidate)) {
      throw new Error('PHONE_ALREADY_EXISTS');
    }

    const sessionData = await whatsappService.startPairing(candidate, payload.mode);
    const account = await addAccount({
      userId: user.id,
      phone: candidate,
      sessionKey: sessionData.sessionKey,
      pairingMode: sessionData.mode,
      status: 'pending',
      sessionData: { sessionKey: sessionData.sessionKey, mode: sessionData.mode },
    });

    const dbSession = await createWhatsappSession({
      userId: user.id,
      accountId: account.id,
      phone: candidate,
      pairingMode: sessionData.mode,
      sessionKey: sessionData.sessionKey,
      pairingCode: sessionData.code ?? null,
      qrData: sessionData.qrData ?? null,
      expiresAt: new Date(Date.now() + config.PAIRING_TTL_SECONDS * 1000),
      sessionData: { phone: candidate, mode: sessionData.mode },
    });

    await updateAccountStatus(account.id, 'pending', { sessionKey: dbSession.session_key, mode: sessionData.mode });
    return {
      ...sessionData,
      accountId: account.id,
    };
  },

  async confirmSession(sessionKey: string): Promise<{ connected: boolean; accountId: number | null }> {
    const session = await getWhatsappSessionByKey(sessionKey);
    if (!session) {
      return { connected: false, accountId: null };
    }

    const connected = await whatsappService.confirmConnection(sessionKey);
    if (connected && session.account_id) {
      await updateAccountStatus(session.account_id, 'connected', { sessionKey, status: 'connected' });
      await saveAccountSession(session.account_id, sessionKey, { sessionKey, status: 'connected' });
      await updateWhatsappSession(sessionKey, {
        status: 'connected',
        session_data: { sessionKey, status: 'connected' },
        expires_at: new Date(Date.now() + config.SESSION_TTL_MINUTES * 60 * 1000).toISOString(),
      });
    }

    return { connected, accountId: session.account_id };
  },

  async retrySession(sessionKey: string): Promise<PairingSessionResult> {
    const session = await getWhatsappSessionByKey(sessionKey);
    if (!session) {
      throw new Error('SESSION_NOT_FOUND');
    }

    await whatsappService.logoutSession(sessionKey);
    const newSession = await whatsappService.startPairing(session.phone, session.pairing_mode as 'code' | 'qr');

    await updateWhatsappSession(sessionKey, {
      session_key: newSession.sessionKey,
      pairing_code: newSession.code ?? null,
      qr_data: newSession.qrData ?? null,
      status: 'pending',
      expires_at: new Date(Date.now() + config.PAIRING_TTL_SECONDS * 1000).toISOString(),
      session_data: { phone: session.phone, mode: newSession.mode },
    });

    if (session.account_id) {
      await updateAccountStatus(session.account_id, 'pending', { sessionKey: newSession.sessionKey, mode: newSession.mode });
    }

    return newSession;
  },
};
