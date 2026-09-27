import express, { type Express } from 'express';
import type { Telegraf } from 'telegraf';
import { config } from '../config.js';
import { adminService } from '../services/adminService.js';
import { pairingService } from '../services/pairingService.js';

export function createApiServer(bot: Telegraf) {
  const app = express();

  app.use(express.json());

  app.get('/', (_req, res) => {
    res.json({ ok: true, service: 'whatsapp-warmup', status: 'running' });
  });

  app.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'whatsapp-warmup', uptime: process.uptime() });
  });

  app.get('/api/admin/stats', async (req, res) => {
    const token = String(req.headers['x-admin-token'] ?? '');
    if (!adminService.requireToken(token)) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    const stats = await adminService.getOverview();
    return res.json(stats);
  });

  app.post('/api/admin/broadcast', async (req, res) => {
    const token = String(req.headers['x-admin-token'] ?? '');
    if (!adminService.requireToken(token)) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    const text = String(req.body?.text ?? '').trim();
    if (!text) {
      return res.status(400).json({ error: 'text_required' });
    }

    const sent = await adminService.broadcast(bot, text);
    return res.json({ sent });
  });

  app.post('/api/pairing/create', async (req, res) => {
    const telegramId = Number(req.body?.telegramId ?? 0);
    const phone = String(req.body?.phone ?? '');
    const mode = String(req.body?.mode ?? 'code');

    if (!telegramId || !phone || !['code', 'qr'].includes(mode)) {
      return res.status(400).json({ error: 'invalid_payload' });
    }

    try {
      const result = await pairingService.createPairingSession({
        telegramId,
        phone,
        mode: mode as 'code' | 'qr',
      });

      return res.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown_error';
      return res.status(400).json({ error: message });
    }
  });

  app.post('/api/pairing/confirm', async (req, res) => {
    const sessionKey = String(req.body?.sessionKey ?? '');
    if (!sessionKey) {
      return res.status(400).json({ error: 'sessionKey_required' });
    }

    const result = await pairingService.confirmSession(sessionKey);
    return res.json(result);
  });

  app.post('/api/pairing/retry', async (req, res) => {
    const sessionKey = String(req.body?.sessionKey ?? '');
    if (!sessionKey) {
      return res.status(400).json({ error: 'sessionKey_required' });
    }

    try {
      const result = await pairingService.retrySession(sessionKey);
      return res.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown_error';
      return res.status(400).json({ error: message });
    }
  });

  return app;
}

export function startApiServer(bot: Telegraf, port = config.PORT): Express {
  const app = createApiServer(bot);
  app.listen(port, () => {
    console.log(`API server listening on ${port}`);
  });
  return app;
}
