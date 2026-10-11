// Generates production secrets for .env. Run once: npm run keys
import { generateKeyPairSync, randomBytes } from 'node:crypto';
const kp = generateKeyPairSync('ed25519');
const pem = (k: string) => k.trim().replace(/\n/g, '\\n');
console.log(`# --- paste into .env (keep secret; back up DATA_KEY — without it encrypted names/phones are unreadable) ---
DATA_KEY=${randomBytes(32).toString('hex')}
HASH_KEY=${randomBytes(32).toString('hex')}
ADMIN_API_KEY=${randomBytes(24).toString('base64url')}
MODEL_SERVICE_TOKEN=${randomBytes(24).toString('base64url')}
SIGNING_PRIVATE_KEY="${pem(kp.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString())}"
SIGNING_PUBLIC_KEY="${pem(kp.publicKey.export({ type: 'spki', format: 'pem' }).toString())}"`);
