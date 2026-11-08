import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { isLoopbackHost, loadConfig } from '../config.js';
import { createTestEnv, type TestEnv } from '../testing/support.js';

let env: TestEnv;
let app: FastifyInstance;
beforeEach(async () => {
  env = createTestEnv();
  app = await buildApp({ ctx: env.ctx, bus: env.bus });
});
afterEach(async () => {
  await app.close();
  env.cleanup();
});

const create = (headers: Record<string, string>) =>
  app.inject({ method: 'POST', url: '/api/v1/projects', headers, payload: { name: 'X' } });

describe('host guard (DNS rebinding, CSRF)', () => {
  it('rejects foreign Host headers, also for reads', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/projects',
      headers: { host: 'evil.example' },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { code: 'FORBIDDEN_HOST' } });
  });

  it('rejects state changes from another origin', async () => {
    const host = { host: '127.0.0.1:4777' };
    expect((await create({ ...host, origin: 'http://evil.example' })).statusCode).toBe(403);
    expect((await create({ ...host, origin: 'http://localhost:3000' })).statusCode).toBe(403);
    expect((await create({ ...host, origin: 'null' })).statusCode).toBe(403);
    // Fetch Metadata alone (no Origin header) is enough to reject.
    expect((await create({ ...host, 'sec-fetch-site': 'cross-site' })).statusCode).toBe(403);
    expect((await create({ ...host, 'sec-fetch-site': 'same-site' })).statusCode).toBe(403);
  });

  it('accepts same-origin browser requests and non-browser clients', async () => {
    const host = { host: '127.0.0.1:4777' };
    expect(
      (await create({ ...host, origin: 'http://127.0.0.1:4777', 'sec-fetch-site': 'same-origin' }))
        .statusCode,
    ).toBe(201);
    expect((await create(host)).statusCode).toBe(201);
    expect((await create({ host: 'localhost:4777', 'sec-fetch-site': 'none' })).statusCode).toBe(201);
  });
});

describe('bind address', () => {
  it('recognizes loopback addresses', () => {
    for (const host of ['127.0.0.1', '127.1.2.3', 'localhost', '::1', '[::1]'])
      expect(isLoopbackHost(host)).toBe(true);
    for (const host of ['0.0.0.0', '::', '192.168.1.5', 'opsis.example', '127.0.0.1.evil.example'])
      expect(isLoopbackHost(host)).toBe(false);
  });

  it('refuses a network address without explicit opt-in', () => {
    expect(() => loadConfig({ OPSIS_HOST: '0.0.0.0' })).toThrow(/OPSIS_UNSAFE_BIND/);
    expect(loadConfig({ OPSIS_HOST: '0.0.0.0', OPSIS_UNSAFE_BIND: '1' }).host).toBe('0.0.0.0');
    expect(loadConfig({}).host).toBe('127.0.0.1');
  });
});
