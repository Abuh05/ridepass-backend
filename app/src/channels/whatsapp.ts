// WhatsApp Cloud API: webhook verification, signature check, parsing, media download, sending.
import { createHmac } from 'node:crypto';
import { config } from '../config.ts';
import { safeEqual } from '../crypto.ts';
import type { Inbound, OutMsg } from './types.ts';

const GRAPH = () => `https://graph.facebook.com/${config.wa.graphVersion}`;

export function verifySignature(rawBody: string, header: string | undefined): boolean {
  if (!config.wa.appSecret) return process.env.NODE_ENV !== 'production'; // dev without secret
  if (!header?.startsWith('sha256=')) return false;
  const expected = 'sha256=' + createHmac('sha256', config.wa.appSecret).update(rawBody).digest('hex');
  return safeEqual(expected, header);
}

/** Extract rider messages from a webhook payload (ignores status callbacks). */
export function parseWebhook(body: any): Inbound[] {
  const out: Inbound[] = [];
  for (const entry of body?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      const v = change?.value;
      const names = new Map<string, string>((v?.contacts ?? []).map((c: any) => [c.wa_id, c.profile?.name]));
      for (const m of v?.messages ?? []) {
        const base = { channel: 'whatsapp' as const, from: m.from, externalId: m.id, profileName: names.get(m.from) };
        if (m.type === 'text') out.push({ ...base, kind: 'text', text: m.text?.body ?? '' });
        else if (m.type === 'audio') out.push({ ...base, kind: 'audio', waMediaId: m.audio?.id, mime: m.audio?.mime_type });
        else if (m.type === 'interactive') {
          const r = m.interactive?.button_reply ?? m.interactive?.list_reply;
          out.push({ ...base, kind: 'button', buttonId: r?.id, text: r?.title });
        } else if (m.type === 'button') out.push({ ...base, kind: 'button', buttonId: m.button?.payload, text: m.button?.text });
        else out.push({ ...base, kind: 'text', text: '' }); // images, stickers etc.
      }
    }
  }
  return out;
}

export async function downloadMedia(mediaId: string): Promise<{ data: Buffer; mime: string }> {
  const auth = { Authorization: `Bearer ${config.wa.accessToken}` };
  const meta = await fetch(`${GRAPH()}/${mediaId}`, { headers: auth });
  if (!meta.ok) throw new Error(`media meta ${meta.status}`);
  const { url, mime_type, file_size } = await meta.json() as { url: string; mime_type: string; file_size: number };
  if (file_size > config.maxAudioBytes) throw Object.assign(new Error('audio too large'), { tooLarge: true });
  const bin = await fetch(url, { headers: auth });
  if (!bin.ok) throw new Error(`media download ${bin.status}`);
  return { data: Buffer.from(await bin.arrayBuffer()), mime: mime_type };
}

const trim = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

export function buildPayloads(to: string, msg: OutMsg, lang: string): object[] {
  const base = { messaging_product: 'whatsapp', recipient_type: 'individual', to };
  if (msg.template) {
    return [{ ...base, type: 'template', template: { name: msg.template.name, language: { code: waLangCode(lang) },
      components: [
        { type: 'body', parameters: msg.template.params.map((p) => ({ type: 'text', text: p })) },
        ...(msg.template.buttonPayloads ?? []).map((payload, index) => ({ type: 'button', sub_type: 'quick_reply', index: String(index), parameters: [{ type: 'payload', payload }] })),
      ] } }];
  }
  const payloads: object[] = [];
  if (msg.audioKey) payloads.push({ ...base, type: 'audio', audio: { link: `${config.publicBaseUrl}/audio/${lang}/${msg.audioKey}.ogg` } });
  const body = trim(msg.text, 1024);
  if (msg.buttons?.length && msg.buttons.length <= 3) {
    payloads.push({ ...base, type: 'interactive', interactive: { type: 'button', body: { text: body },
      action: { buttons: msg.buttons.map((b) => ({ type: 'reply', reply: { id: b.id, title: trim(b.title, 20) } })) } } });
  } else if (msg.buttons?.length) {
    payloads.push({ ...base, type: 'interactive', interactive: { type: 'list', body: { text: body },
      action: { button: 'Choose', sections: [{ title: 'Options', rows: msg.buttons.slice(0, 10).map((b) => ({ id: b.id, title: trim(b.title, 24) })) }] } } });
  } else payloads.push({ ...base, type: 'text', text: { body: trim(msg.text, 4096), preview_url: true } });
  return payloads;
}

export async function sendPayload(payload: object): Promise<void> {
  if (!config.wa.accessToken || !config.wa.phoneNumberId) {
    console.log('[whatsapp:dry-run]', JSON.stringify(payload).slice(0, 300));
    return;
  }
  const r = await fetch(`${GRAPH()}/${config.wa.phoneNumberId}/messages`, {
    method: 'POST', headers: { Authorization: `Bearer ${config.wa.accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  if (!r.ok) {
    const txt = await r.text();
    const err = new Error(`WhatsApp send ${r.status}: ${txt.slice(0, 300)}`);
    // 4xx other than rate-limit are permanent (bad number, outside 24h window, template missing)
    if (r.status >= 400 && r.status < 500 && r.status !== 429) (err as any).permanent = true;
    throw err;
  }
}

function waLangCode(lang: string): string {
  return ({ en: 'en', pcm: 'en', ha: 'ha', yo: 'en', ig: 'en' } as Record<string, string>)[lang] ?? 'en';
}
