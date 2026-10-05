import { defineConfig } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const port = Number(process.env.SDDFW_DEMO_PORT ?? 4173);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid SDDFW_DEMO_PORT.');
const baseURL = `http://127.0.0.1:${port}`;
const isolatedDataDir = join(tmpdir(), `sddfw-favorites-test-${randomUUID()}`);

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: [['list']],
  metadata: { demoDataDir: isolatedDataDir, demoDataFile: join(isolatedDataDir, 'favorites.json') },
  globalTeardown: './tests/cleanup.mjs',
  use: { baseURL, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: 'node server.mjs',
    url: `${baseURL}/api/items`,
    reuseExistingServer: false,
    timeout: 15_000,
    env: { SDDFW_DEMO_PORT: String(port), SDDFW_DEMO_TEST_MODE: '1', SDDFW_DEMO_DATA: join(isolatedDataDir, 'favorites.json') },
  },
});
