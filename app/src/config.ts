// Central configuration. Values come from environment / .env (see .env.example).
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const envFile = resolve(process.cwd(), '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const e = (k: string, d = ''): string => process.env[k] ?? d;
const n = (k: string, d: number): number => (process.env[k] ? Number(process.env[k]) : d);

export const config = {
  port: n('PORT', 8080),
  publicBaseUrl: e('PUBLIC_BASE_URL', 'http://localhost:8080').replace(/\/$/, ''),
  dbPath: e('DB_PATH', './data/ridepass.db'),
  dataDir: e('DATA_DIR', './data'),

  // N-ATLAS model access. MODEL_MODE=mock is ONLY for local UI work without a GPU —
  // every interaction logged in mock mode is marked model_path=mock and excluded from metrics.
  modelMode: e('MODEL_MODE', 'natlas') as 'natlas' | 'mock',
  asrUrl: e('ASR_URL', 'http://localhost:9000'),
  llmBaseUrl: e('LLM_BASE_URL', 'http://localhost:8000/v1'),
  llmModel: e('LLM_MODEL', 'n-atlas'),
  modelToken: e('MODEL_SERVICE_TOKEN'),
  llmTimeoutMs: n('LLM_TIMEOUT_MS', 30000),
  asrTimeoutMs: n('ASR_TIMEOUT_MS', 60000),

  // WhatsApp Cloud API
  wa: {
    accessToken: e('WA_ACCESS_TOKEN'),
    phoneNumberId: e('WA_PHONE_NUMBER_ID'),
    verifyToken: e('WA_VERIFY_TOKEN', 'ridepass-verify'),
    appSecret: e('WA_APP_SECRET'),
    graphVersion: e('WA_GRAPH_VERSION', 'v21.0'),
    approvedTemplates: new Set(e('WA_TEMPLATES_APPROVED').split(',').map((s) => s.trim()).filter(Boolean)),
  },

  // Security
  dataKeyHex: e('DATA_KEY'), // 64 hex chars (AES-256)
  hashKeyHex: e('HASH_KEY'), // 64 hex chars (HMAC for phone lookup)
  signingPrivateKeyPem: e('SIGNING_PRIVATE_KEY').replace(/\\n/g, '\n'),
  signingPublicKeyPem: e('SIGNING_PUBLIC_KEY').replace(/\\n/g, '\n'),
  adminApiKey: e('ADMIN_API_KEY'),

  // Licence guard (N-ATLAS research licence: 1,000 active end-users per organisation)
  userCap: n('USER_CAP', 1000),
  userCapWarn: n('USER_CAP_WARN', 900),

  // Product rules
  minScoreDays: n('MIN_SCORE_DAYS', 14),
  maxAudioBytes: n('MAX_AUDIO_BYTES', 8 * 1024 * 1024),
  retainAudioForBenchmark: e('RETAIN_AUDIO', '1') === '1', // only for riders who opted in
  passportValidityDays: n('PASSPORT_VALIDITY_DAYS', 30),
  shareCodeValidityDays: n('SHARE_CODE_VALIDITY_DAYS', 7),
  rateLimitPer5Min: n('RATE_LIMIT_PER_5MIN', 30),
  workerConcurrency: n('WORKER_CONCURRENCY', 4),

  // EV-switch calculator — ILLUSTRATIVE DEFAULTS, replace with Phoenix's real figures.
  ev: {
    petrolPricePerLitre: n('EV_PETROL_PRICE', 1000),
    electricityPricePerKwh: n('EV_ELECTRICITY_PRICE', 209),
    workingDaysPerMonth: n('EV_WORKING_DAYS', 26),
    kmPerLitre: { keke: n('EV_KEKE_KM_PER_L', 25), okada: n('EV_OKADA_KM_PER_L', 40), bus: n('EV_BUS_KM_PER_L', 9), car: n('EV_CAR_KM_PER_L', 12) } as Record<string, number>,
    kwhPerKm: { keke: n('EV_KEKE_KWH_PER_KM', 0.07), okada: n('EV_OKADA_KWH_PER_KM', 0.035), bus: n('EV_BUS_KWH_PER_KM', 0.25), car: n('EV_CAR_KWH_PER_KM', 0.15) } as Record<string, number>,
    conversionCost: { keke: n('EV_KEKE_CONVERSION', 2500000), okada: n('EV_OKADA_CONVERSION', 1200000), bus: n('EV_BUS_CONVERSION', 9000000), car: n('EV_CAR_CONVERSION', 7000000) } as Record<string, number>,
  },

  // Plausibility caps per day (anomaly detection)
  maxDailyIncome: { keke: n('CAP_KEKE_INCOME', 60000), okada: n('CAP_OKADA_INCOME', 50000), bus: n('CAP_BUS_INCOME', 200000), car: n('CAP_CAR_INCOME', 150000) } as Record<string, number>,
};

export type Config = typeof config;
