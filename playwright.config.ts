import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from '@playwright/test';

/**
 * End-to-end tests against the built server (`npm run build` first, `npm run e2e` does both).
 * Each run uses a fresh data directory. The browser is the installed Chrome by default;
 * `OPSIS_E2E_CHANNEL=` (empty) uses Playwright's own Chromium after `npx playwright install`.
 */
const port = Number(process.env['OPSIS_E2E_PORT'] ?? 4790);
const baseURL = `http://127.0.0.1:${String(port)}`;
const channel = process.env['OPSIS_E2E_CHANNEL'] ?? 'chrome';

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: process.env['CI'] ? 'line' : 'list',
  use: {
    baseURL,
    locale: 'en-US',
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
    ...(channel === '' ? {} : { channel }),
  },
  webServer: {
    command: 'node packages/server/dist/main.js',
    url: `${baseURL}/api/v1/health`,
    reuseExistingServer: false,
    env: {
      OPSIS_PORT: String(port),
      OPSIS_DATA_DIR: mkdtempSync(join(tmpdir(), 'opsis-e2e-')),
      OPSIS_LOG_LEVEL: 'warn',
    },
  },
});
