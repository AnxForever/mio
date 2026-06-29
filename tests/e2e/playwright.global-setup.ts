/**
 * Playwright global setup: start the Mio server on a free port.
 *
 * Exposes the resolved URL via environment variables:
 *   - MIO_TEST_BASE_URL   (e.g. http://127.0.0.1:54321)
 *   - MIO_TEST_WS_URL     (e.g. ws://127.0.0.1:54321/ws)
 *
 * Unlike Playwright's built-in webServer, this uses the actual
 * `startServer()` from the Mio codebase so we get the exact same
 * server instance that production uses.
 */

import { createServer } from 'node:http';
import { type RunningServer, startServer } from '../../dist/server/index.js';

let server: RunningServer | undefined;

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const addr = s.address();
      if (typeof addr === 'object' && addr) {
        const p = addr.port;
        s.close(() => resolve(p));
      } else {
        s.close(() => reject(new Error('could not get port')));
      }
    });
  });
}

async function globalSetup(): Promise<void> {
  // The shared E2E server is exercised by both browser route checks and API
  // tests. Keep its limiter high, then test strict 429 behavior in isolation.
  process.env.MIO_RATE_LIMIT_MAX ??= '500';
  process.env.MIO_RATE_LIMIT_WINDOW_MS ??= '60000';

  // Suppress server startup logs during tests
  const origLog = console.log;
  const origError = console.error;
  if (!process.env.MIO_TEST_VERBOSE) {
    console.log = () => {};
    console.error = () => {};
  }

  const port = await getFreePort();
  server = await startServer({ port, host: '127.0.0.1' });

  // Restore logging
  if (!process.env.MIO_TEST_VERBOSE) {
    console.log = origLog;
    console.error = origError;
  }

  const baseUrl = `http://127.0.0.1:${server.port}`;
  const wsUrl = `ws://127.0.0.1:${server.port}/ws`;

  process.env.MIO_TEST_BASE_URL = baseUrl;
  process.env.MIO_TEST_WS_URL = wsUrl;

  console.log(`[e2e] Mio server started on ${baseUrl}`);
}

export default globalSetup;
