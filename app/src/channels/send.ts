// One place to send anything to a user, on whatever channel they use.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { run } from '../db.ts';
import { config } from '../config.ts';
import { enqueue, registerHandler } from '../jobs.ts';
import { logInteraction } from '../interactions.ts';
import { nowIso } from '../util.ts';
import { phoneOf, type User } from '../users.ts';
import { buildPayloads, sendPayload } from './whatsapp.ts';
import type { OutMsg } from './types.ts';

const PUBLIC_AUDIO = join(process.cwd(), 'public', 'audio');

export const whatsappConfigured = (): boolean => !!(config.wa.accessToken && config.wa.phoneNumberId);

export function withinWhatsAppWindow(u: User): boolean {
  return !!u.last_inbound_at && Date.now() - Date.parse(u.last_inbound_at) < 23.5 * 3600_000;
}

export function send(u: User, msg: OutMsg): void {
  // Attach a native-speaker audio clip when one has been recorded for this message key.
  if (msg.audioKey && !existsSync(join(PUBLIC_AUDIO, u.lang, `${msg.audioKey}.ogg`))) msg = { ...msg, audioKey: undefined };
  // Until WhatsApp Cloud API credentials are set, WhatsApp messages cannot be delivered. Record them as
  // undelivered (so evidence never counts them as sent) and skip the queue. Owners still get the
  // confirmation link through the rider.
  if (u.channel !== 'web' && !whatsappConfigured()) {
    logInteraction({ userId: u.id, channel: u.channel, direction: 'out', kind: 'undelivered', lang: u.lang, text: msg.text });
    return;
  }
  logInteraction({ userId: u.id, channel: u.channel, direction: 'out', kind: msg.template ? 'template' : 'text', lang: u.lang, text: msg.text });
  if (u.channel === 'web') {
    run('INSERT INTO web_outbox (user_id, message, created_at) VALUES (?,?,?)', u.id, JSON.stringify(msg), nowIso());
    return;
  }
  for (const p of buildPayloads(phoneOf(u), msg, u.lang)) enqueue('wa_send', p, `wa:${u.id}`);
}

registerHandler('wa_send', async (payload) => { await sendPayload(payload); });
