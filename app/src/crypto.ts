// Field-level encryption (NDPA: personal data encrypted at rest), lookup hashing, secrets hashing, signatures.
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scryptSync, timingSafeEqual,
  generateKeyPairSync, sign as edSign, verify as edVerify, createPrivateKey, createPublicKey } from 'node:crypto';
import { config } from './config.ts';

function key(hex: string, name: string): Buffer {
  if (!/^[0-9a-f]{64}$/i.test(hex)) {
    if (process.env.NODE_ENV === 'production') throw new Error(`${name} must be 64 hex chars`);
    // Dev fallback: deterministic key so local data stays readable. NEVER use in production.
    return createHash('sha256').update('ridepass-dev-' + name).digest();
  }
  return Buffer.from(hex, 'hex');
}
const DATA_KEY = key(config.dataKeyHex, 'DATA_KEY');
const HASH_KEY = key(config.hashKeyHex, 'HASH_KEY');

export function encrypt(plain: string | null | undefined): string | null {
  if (plain == null) return null;
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', DATA_KEY, iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
}
export function decrypt(blob: string | null | undefined): string | null {
  if (!blob) return null;
  const b = Buffer.from(blob, 'base64');
  const d = createDecipheriv('aes-256-gcm', DATA_KEY, b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
}
/** Keyed hash used to look up a phone number without storing it in the clear. */
export const lookupHash = (s: string): string => createHmac('sha256', HASH_KEY).update(s).digest('hex');
export const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

export function hashSecret(secret: string): string {
  const salt = randomBytes(16);
  return salt.toString('hex') + ':' + scryptSync(secret, salt, 32).toString('hex');
}
export function checkSecret(secret: string, stored: string | null | undefined): boolean {
  if (!stored) return false;
  const [s, h] = stored.split(':');
  const a = scryptSync(secret, Buffer.from(s, 'hex'), 32);
  const b = Buffer.from(h, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

// ---- Ed25519 passport signing ----
let priv = config.signingPrivateKeyPem;
let pub = config.signingPublicKeyPem;
if (!priv || !pub) {
  if (process.env.NODE_ENV === 'production') throw new Error('SIGNING_PRIVATE_KEY / SIGNING_PUBLIC_KEY required');
  const kp = generateKeyPairSync('ed25519');
  priv = kp.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  pub = kp.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  console.warn('[crypto] using ephemeral signing key (dev). Run `npm run keys` and set SIGNING_* in .env');
}
const PRIV = createPrivateKey(priv);
const PUB = createPublicKey(pub);
export const publicKeyPem = PUB.export({ type: 'spki', format: 'pem' }).toString();
export const signText = (text: string): string => edSign(null, Buffer.from(text), PRIV).toString('base64');
export const verifyText = (text: string, sig: string): boolean => {
  try { return edVerify(null, Buffer.from(text), PUB, Buffer.from(sig, 'base64')); } catch { return false; }
};
