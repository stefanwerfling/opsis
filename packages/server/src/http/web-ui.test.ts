import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WEB_CSP, buildApp } from '../app.js';
import { createTestEnv, type TestEnv } from '../testing/support.js';

const HOST = { host: '127.0.0.1:4777' };
const INDEX = '<!doctype html><title>OPSIS</title><script type="module" src="/assets/app-abc.js"></script>';

let env: TestEnv;
let app: FastifyInstance;
let webRoot: string;

beforeEach(async () => {
  env = createTestEnv();
  webRoot = mkdtempSync(join(tmpdir(), 'opsis-web-'));
  mkdirSync(join(webRoot, 'assets'));
  writeFileSync(join(webRoot, 'index.html'), INDEX);
  writeFileSync(join(webRoot, 'assets', 'app-abc.js'), 'console.log(1);');
  app = await buildApp({ ctx: env.ctx, bus: env.bus, webRoot });
});
afterEach(async () => {
  await app.close();
  env.cleanup();
  rmSync(webRoot, { recursive: true, force: true });
});

describe('web UI delivery', () => {
  it('serves index.html with CSP and framing protection', async () => {
    const response = await app.inject({ method: 'GET', url: '/index.html', headers: HOST });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/^text\/html/);
    expect(response.headers['content-security-policy']).toBe(WEB_CSP);
    expect(response.headers['x-frame-options']).toBe('DENY');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });

  it.each(['/', '/projects/prj_123', '/sessions/ses_1', '/projects/p/ui/ui-x'])(
    'falls back to index.html for the client route %s',
    async (url) => {
      const response = await app.inject({ method: 'GET', url, headers: HOST });
      expect(response.statusCode).toBe(200);
      expect(response.body).toBe(INDEX);
      expect(response.headers['content-security-policy']).toBe(WEB_CSP);
      expect(response.headers['cache-control']).toBe('no-cache');
    },
  );

  it('serves hashed assets as immutable', async () => {
    const response = await app.inject({ method: 'GET', url: '/assets/app-abc.js', headers: HOST });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toContain('immutable');
    expect(response.headers['content-security-policy']).toBeUndefined();
  });

  it('serves files that appear after startup (web UI rebuilt while running)', async () => {
    writeFileSync(join(webRoot, 'assets', 'app-new.js'), 'console.log(2);');
    const response = await app.inject({ method: 'GET', url: '/assets/app-new.js', headers: HOST });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/javascript/);
    expect(response.body).toBe('console.log(2);');
  });

  it.each(['/assets/missing.js', '/assets/old-hash.css', '/favicon.ico', '/robots.txt'])(
    'answers a missing file %s with 404 instead of the app shell',
    async (url) => {
      const response = await app.inject({ method: 'GET', url, headers: HOST });
      expect(response.statusCode).toBe(404);
      expect(response.body).not.toBe(INDEX);
    },
  );

  it('keeps JSON 404 for unknown API routes and non-GET requests', async () => {
    const api = await app.inject({ method: 'GET', url: '/api/v1/nope', headers: HOST });
    expect(api.statusCode).toBe(404);
    expect(api.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'Route not found' } });

    const post = await app.inject({ method: 'POST', url: '/somewhere', headers: HOST, payload: {} });
    expect(post.statusCode).toBe(404);
  });

  it('does not serve files outside the web root', async () => {
    for (const url of ['/../package.json', '/%2e%2e/%2e%2e/etc/passwd', '/assets/..%2f..%2findex.html']) {
      const response = await app.inject({ method: 'GET', url, headers: HOST });
      // Either the SPA shell or a 4xx – never the content of a file outside the root.
      expect(response.body === INDEX || response.statusCode >= 400).toBe(true);
    }
  });

  it('still applies the host guard to the web UI', async () => {
    const response = await app.inject({ method: 'GET', url: '/', headers: { host: 'evil.example' } });
    expect(response.statusCode).toBe(403);
  });
});
