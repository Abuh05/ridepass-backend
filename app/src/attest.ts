// Two-sided verification: the owner/lessor confirms payments the rider reports.
import { one, run, all, type Row } from './db.ts';
import { config } from './config.ts';
import { sha256 } from './crypto.ts';
import { naira, nowIso, token, uid } from './util.ts';
import { t } from './i18n.ts';
import { createUser, findByPhone, getUser, nameOf, phoneOf, type User } from './users.ts';
import { send, withinWhatsAppWindow, whatsappConfigured } from './channels/send.ts';
import { recordConsent } from './grants.ts';

export function linkOwner(rider: User, ownerPhone: string): User {
  const owner = findByPhone(ownerPhone) ?? createUser(ownerPhone, { role: 'owner', lang: rider.lang, channel: 'whatsapp' });
  run('UPDATE users SET owner_id = ? WHERE id = ?', owner.id, rider.id);
  return owner;
}

const vehicleWord = (v: string | null) => (v === 'okada' ? 'okada' : v === 'bus' ? 'bus' : 'keke');

/** Ask the owner to confirm a repayment entry. Returns what the rider should be told. */
export function requestAttestation(rider: User, entry: Row): { sentToOwner: boolean; link: string } {
  const owner = rider.owner_id ? getUser(rider.owner_id) : undefined;
  const tok = token(18);
  const id = uid();
  const link = `${config.publicBaseUrl}/a/${tok}`;
  if (!owner) return { sentToOwner: false, link };
  run('INSERT INTO attestations (id, entry_id, rider_id, owner_id, token_hash, created_at) VALUES (?,?,?,?,?,?)',
    id, entry.id, rider.id, owner.id, sha256(tok), nowIso());
  const vars = { rider: nameOf(rider) || 'Your rider', amount: naira(entry.amount), day: entry.day, vehicle: vehicleWord(rider.vehicle) };
  const text = t(owner.lang, 'owner_attest', vars);
  const buttons = [{ id: `att:${id}:y`, title: t(owner.lang, 'owner_yes') }, { id: `att:${id}:n`, title: t(owner.lang, 'owner_no') }];
  // Without WhatsApp credentials nothing can reach the owner, so the rider must forward the link.
  if (!whatsappConfigured()) return { sentToOwner: false, link };
  if (owner.channel === 'whatsapp' && withinWhatsAppWindow(owner)) {
    send(owner, { text, buttons });
    return { sentToOwner: true, link };
  }
  if (owner.channel === 'whatsapp' && config.wa.approvedTemplates.has('ridepass_payment_confirm')) {
    send(owner, { text, template: { name: 'ridepass_payment_confirm', params: [vars.rider, vars.amount, vars.day], buttonPayloads: [`att:${id}:y`, `att:${id}:n`] } });
    return { sentToOwner: true, link };
  }
  return { sentToOwner: false, link }; // rider forwards the signed link instead
}

/**
 * How a confirmation arrived decides whether it counts:
 *  - whatsapp: answered from the owner's own WhatsApp number
 *  - web_pin:  answered on the link with the owner's PIN (set in person by an agent or lessor)
 *  - web_link: answered on the link without a PIN. Anyone holding the link (including the rider
 *              who forwarded it) could have tapped it, so a "Yes" this way is recorded but not counted.
 */
export type AttestVia = 'whatsapp' | 'web_pin' | 'web_link'; // counted ones: COUNTED_VIA in scoring.ts

const PIN_MAX_FAILS = 5;
const PIN_WINDOW_MS = 24 * 3600_000;
export function pinFailures(ownerId: string): number {
  return (one('SELECT COUNT(*) c FROM owner_pin_failures WHERE owner_id = ? AND at > ?', ownerId, new Date(Date.now() - PIN_WINDOW_MS).toISOString())?.c as number) ?? 0;
}
export const pinLocked = (ownerId: string): boolean => pinFailures(ownerId) >= PIN_MAX_FAILS;
export const pinAttemptsLeft = (ownerId: string): number => Math.max(0, PIN_MAX_FAILS - pinFailures(ownerId));
export function recordPinFailure(ownerId: string): void { run('INSERT INTO owner_pin_failures (owner_id, at) VALUES (?,?)', ownerId, nowIso()); }
export function clearPinFailures(ownerId: string): void { run('DELETE FROM owner_pin_failures WHERE owner_id = ?', ownerId); }

/** Record the owner's answer. `byUserId` (when known) must be the owner, so nobody else can answer for them. */
export function respondAttestation(attId: string, confirmed: boolean, via: AttestVia, byUserId?: string): Row | null {
  const a = one('SELECT * FROM attestations WHERE id = ?', attId);
  if (!a) return null;
  if (byUserId !== undefined && byUserId !== a.owner_id) return null;
  if (a.status !== 'pending') return a;
  run('UPDATE attestations SET status = ?, via = ?, responded_at = ? WHERE id = ?', confirmed ? 'confirmed' : 'disputed', via, nowIso(), attId);
  recordConsent(a.owner_id as string, 'owner_attestation', true, { attId, via });
  const owner = getUser(a.owner_id as string);
  if (owner && via === 'whatsapp') send(owner, { text: t(owner.lang, 'owner_thanks') });
  if (!confirmed) {
    const rider = getUser(a.rider_id as string);
    const e = one('SELECT * FROM entries WHERE id = ?', a.entry_id);
    if (rider && e) send(rider, { text: t(rider.lang, 'rider_disputed', { amount: naira(e.amount), day: e.day }) });
  }
  return one('SELECT * FROM attestations WHERE id = ?', attId)!;
}

export function attestationByToken(tok: string): Row | undefined {
  return one('SELECT * FROM attestations WHERE token_hash = ?', sha256(tok));
}
export function pendingForOwner(ownerId: string): Row[] {
  return all(`SELECT * FROM attestations WHERE owner_id = ? AND status = 'pending' ORDER BY created_at`, ownerId);
}
export function ownerPhoneMatchesRider(rider: User, phone: string): boolean { return phoneOf(rider) === phone; }
