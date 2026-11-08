import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  LOCAL_HUMAN,
  UPLOAD_SLOT_TTL_MS,
  createAgent,
  createProject,
  expireUploadSlots,
  getSession,
  requestUpload,
  revokeAgent,
  submitScreenshot,
  type Actor,
} from '@opsis/core';
import { buildApp, redactUploadToken } from './app.js';
import { createTestEnv, makeImage, type TestEnv } from './testing/support.js';

let env: TestEnv;
let app: FastifyInstance;
let agent: Actor;
let projectId: string;

beforeEach(async () => {
  env = createTestEnv();
  app = await buildApp({ ctx: env.ctx, bus: env.bus });
  const { agent: created } = createAgent(env.ctx, LOCAL_HUMAN, { name: 'a' });
  agent = { type: 'agent', id: created.id, name: created.name };
  projectId = createProject(env.ctx, agent, { name: 'Shop' }).id;
});
afterEach(async () => {
  await app.close();
  env.cleanup();
});

const put = (token: string, body: Uint8Array | string, type = 'image/png') =>
  app.inject({
    method: 'PUT',
    url: `/api/v1/uploads/${token}`,
    headers: { 'content-type': type },
    payload: typeof body === 'string' ? body : Buffer.from(body),
  });

const requested = () =>
  requestUpload(env.ctx, agent, { projectId, source: 'mcp', uiPath: '/big', metadata: {} });

describe('two-stage upload', () => {
  it('keeps the session in "uploading" until the image arrives', async () => {
    const slot = requested();
    expect(slot.session.status).toBe('uploading');
    expect(slot.token).toMatch(/^opsisupl_[A-Za-z0-9_-]{43}$/);
    expect(env.db.get('SELECT token_hash FROM upload_slots')).not.toEqual({ token_hash: slot.token });

    const response = await put(slot.token, await makeImage('webp'), 'application/octet-stream');
    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body) as { session_id: string; screenshot_id: string; status: string };
    expect(body).toMatchObject({ session_id: slot.session.id, status: 'awaiting_review' });
    const details = getSession(env.ctx, agent, slot.session.id);
    expect(details.screenshots.map((s) => s.id)).toEqual([body.screenshot_id]);
    expect(details.screenshots[0]?.mimeType).toBe('image/webp');
  });

  it('accepts a token only once', async () => {
    const slot = requested();
    expect((await put(slot.token, await makeImage())).statusCode).toBe(201);
    const again = await put(slot.token, await makeImage('png', 320, 200, 3));
    expect(again.statusCode).toBe(404);
  });

  it('rejects unknown and malformed tokens uniformly', async () => {
    const image = await makeImage();
    expect((await put(`opsisupl_${'A'.repeat(43)}`, image)).statusCode).toBe(404);
    expect((await put('nonsense', image)).statusCode).toBe(404);
  });

  it('leaves the slot open after a rejected image', async () => {
    const slot = requested();
    expect((await put(slot.token, 'not an image')).statusCode).toBeGreaterThanOrEqual(400);
    expect((await put(slot.token, await makeImage())).statusCode).toBe(201);
  });

  it('refuses unsupported content types', async () => {
    const slot = requested();
    expect((await put(slot.token, 'x', 'text/plain')).statusCode).toBe(415);
  });

  it('expires the slot and fails the waiting session', async () => {
    const slot = requested();
    env.clock.advance(UPLOAD_SLOT_TTL_MS + 1);
    expect(expireUploadSlots(env.ctx)).toBe(1);
    expect(expireUploadSlots(env.ctx)).toBe(0);
    expect(getSession(env.ctx, agent, slot.session.id).session.status).toBe('failed');
    expect((await put(slot.token, await makeImage())).statusCode).toBe(404);
  });

  it('expires lazily when the late upload arrives', async () => {
    const slot = requested();
    env.clock.advance(UPLOAD_SLOT_TTL_MS + 1);
    expect((await put(slot.token, await makeImage())).statusCode).toBe(404);
    expect(getSession(env.ctx, agent, slot.session.id).session.status).toBe('failed');
  });

  it('adds a variant to an open session without changing its status', async () => {
    const first = await submitScreenshot(
      env.ctx,
      agent,
      { projectId, source: 'mcp', uiPath: '/x', metadata: {} },
      await makeImage(),
    );
    const slot = requestUpload(env.ctx, agent, {
      projectId,
      source: 'mcp',
      sessionId: first.session.id,
      metadata: { variantLabel: 'dark' },
    });
    expect(slot.sessionCreated).toBe(false);
    expect((await put(slot.token, await makeImage('png', 320, 200, 5))).statusCode).toBe(201);
    const details = getSession(env.ctx, agent, first.session.id);
    expect(details.session.status).toBe('awaiting_review');
    expect(details.screenshots).toHaveLength(2);
  });

  it('stops working when the agent is revoked', async () => {
    const slot = requested();
    revokeAgent(env.ctx, LOCAL_HUMAN, agent.id);
    expect((await put(slot.token, await makeImage())).statusCode).toBe(404);
  });

  it('redacts the token from request logs', () => {
    expect(redactUploadToken(`/api/v1/uploads/opsisupl_${'A'.repeat(43)}`)).toBe(
      '/api/v1/uploads/[redacted]',
    );
    expect(redactUploadToken('/api/v1/projects')).toBe('/api/v1/projects');
  });
});
