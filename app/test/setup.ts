// Shared test setup: in-memory DB, mock models. Import this FIRST in every test file.
process.env.NODE_TEST = '1';
process.env.MODEL_MODE = 'mock';
process.env.PUBLIC_BASE_URL = 'https://ridepass.test';
