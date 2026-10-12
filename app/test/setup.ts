// Shared test setup: in-memory DB, mock models. Import this FIRST in every test file.
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.NODE_TEST = '1';
process.env.MODEL_MODE = 'mock';
process.env.PUBLIC_BASE_URL = 'https://ridepass.test';
process.env.ADMIN_API_KEY = 'test-admin-key';
process.env.DATA_DIR = join(tmpdir(), `ridepass-test-${process.pid}`); // backups/uploads never touch app/data
