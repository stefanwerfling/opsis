import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DomainEvent } from '@opsis/core';
import { buildApp } from '../app.js';
import { createTestEnv, makeImage, type TestEnv } from '../testing/support.js';

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

// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- typed test helper
const json = <T = Record<string, unknown>>(body: string): T => JSON.parse(body) as T;
const HOST = { host: '127.0.0.1:4777' };

const upload = async (
  projectId: string,
  fields: Record<string, string>,
  image: Uint8Array<ArrayBuffer>,
  filename = 'shot.png',
) => {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  form.append('image', new Blob([image]), filename);
  return app.inject({
    method: 'POST',
    url: `/api/v1/projects/${projectId}/screenshots`,
    headers: HOST,
    payload: form,
  });
};

describe('REST API', () => {
  it('runs the basic flow: project → upload → session → image', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: HOST,
      payload: { name: 'Shop' },
    });
    expect(created.statusCode).toBe(201);
    const project = json<{ id: string }>(created.body);

    // A misleading file name must not matter – the format is detected from content.
    const response = await upload(
      project.id,
      { uiPath: '/dashboard', deviceCategory: 'desktop', viewportWidth: '1440', viewportHeight: '900' },
      await makeImage('jpeg', 1440, 900),
      'evil.png',
    );
    expect(response.statusCode).toBe(201);
    const result = json<{
      session: { id: string; status: string };
      screenshot: { id: string; mimeType: string };
    }>(response.body);
    expect(result.session.status).toBe('awaiting_review');
    expect(result.screenshot.mimeType).toBe('image/jpeg');

    const image = await app.inject({
      method: 'GET',
      url: `/api/v1/screenshots/${result.screenshot.id}/image`,
      headers: HOST,
    });
    expect(image.statusCode).toBe(200);
    expect(image.headers['content-type']).toBe('image/jpeg');
    expect(image.headers['x-content-type-options']).toBe('nosniff');

    const review = await app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${result.session.id}/start-review`,
      headers: HOST,
    });
    expect(json<{ status: string }>(review.body).status).toBe('in_progress');

    const sessions = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${project.id}/sessions?uiId=ui-dashboard&status=in_progress`,
      headers: HOST,
    });
    expect(json<{ sessions: unknown[] }>(sessions.body).sessions).toHaveLength(1);
  });

  it('maps domain errors to HTTP status codes with a uniform body', async () => {
    const missing = await app.inject({ method: 'GET', url: '/api/v1/projects/prj_missing', headers: HOST });
    expect(missing.statusCode).toBe(404);
    expect(json<{ error: { code: string } }>(missing.body).error.code).toBe('NOT_FOUND');

    const invalid = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: HOST,
      payload: { name: '' },
    });
    expect(invalid.statusCode).toBe(400);
    expect(json<{ error: { code: string } }>(invalid.body).error.code).toBe('VALIDATION');
  });

  it('rejects non-image uploads with 415 and oversized uploads with 413', async () => {
    const project = json<{ id: string }>(
      (await app.inject({ method: 'POST', url: '/api/v1/projects', headers: HOST, payload: { name: 'P' } }))
        .body,
    );
    const text = await upload(
      project.id,
      { uiPath: '/x' },
      new TextEncoder().encode('#!/bin/sh\necho hi'),
      'x.png',
    );
    expect(text.statusCode).toBe(415);

    const big = new Uint8Array(20 * 1024 * 1024 + 1);
    const tooLarge = await upload(project.id, { uiPath: '/x' }, big);
    expect(tooLarge.statusCode).toBe(413);
  });

  it('protects against DNS rebinding and cross-origin writes', async () => {
    const foreignHost = await app.inject({
      method: 'GET',
      url: '/api/v1/projects',
      headers: { host: 'evil.example:4777' },
    });
    expect(foreignHost.statusCode).toBe(403);

    const crossOrigin = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { ...HOST, origin: 'https://evil.example' },
      payload: { name: 'x' },
    });
    expect(crossOrigin.statusCode).toBe(403);

    const sameOrigin = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { ...HOST, origin: 'http://127.0.0.1:4777' },
      payload: { name: 'x' },
    });
    expect(sameOrigin.statusCode).toBe(201);
  });

  it('streams domain events via SSE', async () => {
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address();
    if (address === null || typeof address === 'string') throw new Error('no address');
    const controller = new AbortController();
    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/events`, {
      signal: controller.signal,
    });
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const reader = response.body?.getReader();
    if (!reader) throw new Error('no body');

    const event: DomainEvent = { type: 'ProjectChanged', projectId: 'prj_x' };
    await reader.read(); // ": connected"
    env.bus.publish(event);
    const chunk = new TextDecoder().decode((await reader.read()).value);
    expect(chunk).toContain('event: ProjectChanged');
    expect(chunk).toContain('"projectId":"prj_x"');
    controller.abort();
  });
});

describe('draft API', () => {
  it('reads and changes the draft, maps conflicts to 409', async () => {
    const project = json<{ id: string }>(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/projects',
          headers: HOST,
          payload: { name: 'Shop' },
        })
      ).body,
    );
    const uploaded = json<{ session: { id: string }; screenshot: { id: string } }>(
      (await upload(project.id, { uiPath: '/x' }, await makeImage('png', 400, 300))).body,
    );
    const sessionId = uploaded.session.id;

    const initial = await app.inject({
      method: 'GET',
      url: `/api/v1/sessions/${sessionId}/draft`,
      headers: HOST,
    });
    expect(initial.statusCode).toBe(200);
    expect(json<{ revision: number }>(initial.body).revision).toBe(0);

    const operations = [
      {
        op: 'addComponent',
        componentId: 'cmp_01JZ0000000000000000000001',
        parentId: null,
        name: 'Header',
        kind: 'container',
        region: { screenshotId: uploaded.screenshot.id, x: 0, y: 0, width: 400, height: 40 },
      },
    ];
    const changed = await app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/draft/operations`,
      headers: HOST,
      payload: { baseRevision: 0, operations },
    });
    expect(changed.statusCode).toBe(200);
    expect(json<{ revision: number; components: unknown[] }>(changed.body)).toMatchObject({ revision: 1 });

    const stale = await app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/draft/operations`,
      headers: HOST,
      payload: { baseRevision: 0, operations: [{ op: 'updateDraft', goal: 'x' }] },
    });
    expect(stale.statusCode).toBe(409);
    expect(json<{ error: { code: string; details: unknown } }>(stale.body).error).toMatchObject({
      code: 'VERSION_CONFLICT',
      details: { currentRevision: 1 },
    });
  });
});

describe('release API', () => {
  it('releases, maps INCOMPLETE to 422 and serves specification and prompt', async () => {
    const project = json<{ id: string }>(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/projects',
          headers: HOST,
          payload: { name: 'Shop' },
        })
      ).body,
    );
    const uploaded = json<{ session: { id: string } }>(
      (await upload(project.id, { uiPath: '/x' }, await makeImage('png', 400, 300))).body,
    );
    const sessionId = uploaded.session.id;
    const post = (url: string, payload: unknown) =>
      app.inject({ method: 'POST', url, headers: HOST, payload: payload as Record<string, unknown> });
    const rowVersion = async () =>
      json<{ session: { rowVersion: number } }>(
        (await app.inject({ method: 'GET', url: `/api/v1/sessions/${sessionId}`, headers: HOST })).body,
      ).session.rowVersion;

    await post(`/api/v1/sessions/${sessionId}/draft/operations`, {
      baseRevision: 0,
      operations: [
        {
          op: 'addComponent',
          componentId: 'cmp_01JZ0000000000000000000001',
          parentId: null,
          name: 'Header',
          kind: 'container',
        },
      ],
    });
    const refused = await post(`/api/v1/sessions/${sessionId}/release`, { rowVersion: await rowVersion() });
    expect(refused.statusCode).toBe(422);
    const error = json<{ error: { code: string; details: { unacknowledgedWarnings: { id: string }[] } } }>(
      refused.body,
    ).error;
    expect(error.code).toBe('INCOMPLETE');

    const released = await post(`/api/v1/sessions/${sessionId}/release`, {
      rowVersion: await rowVersion(),
      acknowledgedWarnings: error.details.unacknowledgedWarnings.map((warning) => warning.id),
    });
    expect(released.statusCode).toBe(201);
    const { uiVersion } = json<{ uiVersion: { id: string; versionNo: number } }>(released.body);
    expect(uiVersion.versionNo).toBe(1);

    const version = await app.inject({
      method: 'GET',
      url: `/api/v1/versions/${uiVersion.id}`,
      headers: HOST,
    });
    expect(
      json<{ snapshot: { components: unknown[] }; specRevision: Record<string, unknown> }>(version.body),
    ).toMatchObject({ snapshot: { components: [{ name: 'Header' }] } });
    expect(json<{ specRevision: Record<string, unknown> }>(version.body).specRevision).not.toHaveProperty(
      'snapshot',
    );

    const markdown = await app.inject({
      method: 'GET',
      url: `/api/v1/versions/${uiVersion.id}/specification?format=markdown`,
      headers: HOST,
    });
    expect(markdown.headers['content-type']).toBe('text/markdown; charset=utf-8');
    expect(markdown.body).toContain('# Specification: X (ui-x)');

    const prompt = await app.inject({
      method: 'GET',
      url: `/api/v1/versions/${uiVersion.id}/prompt`,
      headers: HOST,
    });
    expect(prompt.body).toContain('# Implementation prompt: X (ui-x)');

    const exported = await app.inject({
      method: 'GET',
      url: `/api/v1/versions/${uiVersion.id}/export/annotated`,
      headers: HOST,
    });
    expect(exported.statusCode).toBe(200);
    expect(exported.headers['content-type']).toBe('image/png');
    expect(exported.headers['content-disposition']).toBe(
      'attachment; filename="ui-x-v1-screenshot-1-annotated.png"',
    );
    const badKind = await app.inject({
      method: 'GET',
      url: `/api/v1/versions/${uiVersion.id}/export/zip`,
      headers: HOST,
    });
    expect(badKind.statusCode).toBe(400);

    const reopened = await post(`/api/v1/sessions/${sessionId}/reopen`, { reason: 'typo' });
    expect(json<{ status: string }>(reopened.body).status).toBe('in_progress');

    const list = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${project.id}/ui-views/ui-x/versions`,
      headers: HOST,
    });
    expect(json<{ versions: unknown[] }>(list.body).versions).toHaveLength(1);
  });
});
