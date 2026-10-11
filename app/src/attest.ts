// Two-sided verification: the owner/lessor confirms payments the rider reports.
import { one, run, all, type Row } from './db.ts';
import { config } from './config.ts';
import { sha256 } from './crypto.ts';
import { naira, nowIso, token, uid } from './util.ts';
import { t } from './i18n.ts';
import { createUser, findByPhone, getUser, nameOf, phoneOf, type User } from './users.ts';
import { send, withinWhatsAppWindow } from './channels/send.ts';
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

export function respondAttestation(attId: string, confirmed: boolean, via: 'whatsapp' | 'web'): Row | null {
  const a = one('SELECT * FROM attestations WHERE id = ?', attId);
  if (!a || a.status !== 'pending') return a ?? null;
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
