import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import QRCode from 'qrcode';
import {
  Browsers,
  fetchLatestBaileysVersion,
  makeWASocket,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';

export type PairingMode = 'code' | 'qr';

export interface PairingSessionResult {
  sessionKey: string;
  phone: string;
  mode: PairingMode;
  code?: string;
  qrData?: string;
  expiresAt: string;
}

interface SocketSession {
  socket: ReturnType<typeof makeWASocket>;
  phone: string;
}

export class WhatsappService {
  private sessions = new Map<string, SocketSession>();

  async startPairing(phone: string, mode: PairingMode): Promise<PairingSessionResult> {
    const cleanPhone = phone.replace(/\D/g, '');
    const sessionKey = randomUUID();
    const authDir = join(process.cwd(), 'data', 'whatsapp', sessionKey);
    mkdirSync(authDir, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(authDir);
    const { version } = await fetchLatestBaileysVersion();

    const socket = makeWASocket({
      version,
      auth: state,
      browser: Browsers.windows('Chrome'),
      printQRInTerminal: false,
    });

    socket.ev.on('creds.update', saveCreds);

    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    this.sessions.set(sessionKey, { socket, phone: cleanPhone });

    if (mode === 'code') {
      const code = await socket.requestPairingCode(cleanPhone);
      return {
        sessionKey,
        phone: cleanPhone,
        mode,
        code,
        expiresAt,
      };
    }

    const qrData = await new Promise<string>((resolve) => {
      const handleUpdate = async (update: { qr?: string }) => {
        if (!update.qr) {
          return;
        }

        const result = await QRCode.toDataURL(update.qr);
        socket.ev.off('connection.update', handleUpdate);
        resolve(result);
      };

      socket.ev.on('connection.update', handleUpdate);
    });

    return {
      sessionKey,
      phone: cleanPhone,
      mode,
      qrData,
      expiresAt,
    };
  }

  async confirmConnection(sessionKey: string): Promise<boolean> {
    const session = this.sessions.get(sessionKey);
    if (!session) {
      return false;
    }

    const isConnected = session.socket.user !== undefined;
    return isConnected;
  }

  async retryPairing(phone: string, mode: PairingMode): Promise<PairingSessionResult> {
    return this.startPairing(phone, mode);
  }

  async logoutSession(sessionKey: string): Promise<void> {
    const session = this.sessions.get(sessionKey);
    if (!session) {
      return;
    }

    session.socket.end(undefined as never);
    this.sessions.delete(sessionKey);
  }
}

export const whatsappService = new WhatsappService();
