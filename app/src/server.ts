import { createServer } from 'node:http';
import { join } from 'node:path';
import { config } from './config.ts';
import { Router } from './http.ts';
import { publicRoutes } from './routes/public.ts';
import { orgRoutes } from './routes/org.ts';
import { startWorker } from './jobs.ts';
import { startReminderClock } from './reminders.ts';
import './flow.ts'; // registers the inbound job handler
import './channels/send.ts'; // registers the WhatsApp send handler

const router = new Router();
publicRoutes(router);
orgRoutes(router);

const staticDir = join(process.cwd(), 'public');
const server = createServer((req, res) => { void router.handle(req, res, staticDir); });
server.requestTimeout = 60_000;

server.listen(config.port, () => {
  startWorker();
  startReminderClock();
  console.log(`RidePass listening on ${config.publicBaseUrl} (port ${config.port}, models: ${config.modelMode})`);
  if (config.modelMode === 'mock') console.warn('⚠️  MODEL_MODE=mock — N-ATLAS is NOT being called. Never run the pilot in mock mode.');
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => { server.close(); process.exit(0); });
