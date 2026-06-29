/**
 * Mio — Playwright E2E test configuration
 *
 * Starts the Mio HTTP+WebSocket server before all tests on a dynamically
 * assigned port, so tests can run in parallel without port conflicts.
 *
 * The server URL is exposed via `process.env.MIO_TEST_BASE_URL` and
 * `process.env.MIO_TEST_WS_URL`.
 */

import { defineConfig, devices } from '@playwright/test';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { startServer } from '../../dist/server/index.js';

const systemChrome = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
  || (existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : undefined);

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  timeout: 30_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false, // sequential tests (they share server state)
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [
    ['list'],
    ['json', { outputFile: 'test-results.json' }],
  ],
  use: {
    baseURL: 'http://127.0.0.1:0', // updated by globalSetup
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  // Start the Mio server before running tests
  globalSetup: './playwright.global-setup.ts',

  // No webServer block needed — we manage the server in globalSetup
  // for more control over shutdown ordering.

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        headless: true,
        launchOptions: systemChrome ? { executablePath: systemChrome } : undefined,
      },
    },
  ],
});
