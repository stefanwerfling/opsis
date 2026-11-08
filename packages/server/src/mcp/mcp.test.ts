import type { AddressInfo } from 'node:net';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { InMemoryServerEventBus, type ServerEvent } from '@modelcontextprotocol/server';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  IMAGE_LIMITS,
  LOCAL_HUMAN,
  changeDraft,
  createAgent,
  createProject,
  getSession,
  newId,
  releaseSpecification,
} from '@opsis/core';
import { buildApp } from '../app.js';
import { createTestEnv, makeImage, type TestEnv } from '../testing/support.js';

let env: TestEnv;
let app: FastifyInstance;
let url: string;
let serverEvents: ServerEvent[];
const clients: Client[] = [];

beforeEach(async () => {
  env = createTestEnv();
  app = await buildApp({
    ctx: env.ctx,
    bus: env.bus,
    publicUrl: 'http://127.0.0.1:4777',
    mcpWait: { pollMs: 50, progressMs: 40 },
    mcpEvents: (() => {
      const bus = new InMemoryServerEventBus();
      serverEvents = [];
      bus.subscribe((event) => serverEvents.push(event));
      return bus;
    })(),
  });
  await app.listen({ host: '127.0.0.1', port: 0 });
  url = `http://127.0.0.1:${String((app.server.address() as AddressInfo).port)}/mcp`;
});
afterEach(async () => {
  for (const client of clients.splice(0)) await client.close();
  await app.close();
  env.cleanup();
});

const connect = async (token: string): Promise<Client> => {
  const client = new Client({ name: 'opsis-test', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  await client.connect(transport);
  clients.push(client);
  return client;
};

const newAgent = async (name: string, projectIds: string[] = []) => {
  const { agent, token } = createAgent(env.ctx, LOCAL_HUMAN, { name, projectIds });
  return { agent, client: await connect(token) };
};

interface ToolResult {
  isError?: boolean;
  content: { type: string; text?: string; data?: string; mimeType?: string }[];
  structuredContent?: Record<string, unknown>;
}

const call = async (client: Client, name: string, args: Record<string, unknown>): Promise<ToolResult> =>
  (await client.callTool({ name, arguments: args })) as ToolResult;

/** Calls a tool that must succeed and returns its structured content. */
const ok = async <T = Record<string, unknown>>(
  client: Client,
  name: string,
  args: Record<string, unknown>,
) => {
  const result = await call(client, name, args);
  if (result.isError === true) throw new Error(`${name} failed: ${result.content[0]?.text ?? ''}`);
  return result.structuredContent as T;
};

/** The error code of a tool call that must fail. */
const errorCode = async (client: Client, name: string, args: Record<string, unknown>): Promise<string> => {
  const result = await call(client, name, args);
  if (result.isError !== true) return 'no error';
  const body = JSON.parse(result.content[0]?.text ?? '{}') as { error?: { code?: string } };
  return body.error?.code ?? 'unknown';
};

const base64Image = async (seed = 0) =>
  Buffer.from(await makeImage('png', 640, 400, seed)).toString('base64');

/** Human side: specify one component and release. */
const humanReleases = (sessionId: string, screenshotId: string) => {
  const componentId = newId('component');
  changeDraft(env.ctx, LOCAL_HUMAN, sessionId, {
    baseRevision: 0,
    operations: [
      {
        op: 'addComponent',
        componentId,
        parentId: null,
        name: 'Header',
        kind: 'container',
        region: { screenshotId, x: 10, y: 10, width: 200, height: 60 },
      },
    ],
  });
  return releaseSpecification(env.ctx, LOCAL_HUMAN, sessionId, {
    rowVersion: getSession(env.ctx, LOCAL_HUMAN, sessionId).session.rowVersion,
    acknowledgedWarnings: [`missing_description:${componentId}`, `missing_acceptance:${componentId}`],
  });
};

const TOOLS = [
  'opsis_list_projects',
  'opsis_get_project',
  'opsis_create_project',
  'opsis_update_project',
  'opsis_list_ui_views',
  'opsis_get_ui_view',
  'opsis_create_ui_view',
  'opsis_get_ui_history',
  'opsis_submit_screenshot',
  'opsis_request_upload',
  'opsis_get_screenshot',
  'opsis_list_screenshots',
  'opsis_get_session',
  'opsis_get_session_status',
  'opsis_wait_for_specification',
  'opsis_get_specification',
  'opsis_get_implementation_prompt',
  'opsis_cancel_session',
];

describe('MCP endpoint', () => {
  it('requires a valid agent token and rejects foreign origins', async () => {
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });
    const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
    const anonymous = await fetch(url, { method: 'POST', headers, body });
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers.get('www-authenticate')).toBe('Bearer');
    await expect(connect('opsis_invalid')).rejects.toThrow();

    const { token } = createAgent(env.ctx, LOCAL_HUMAN, { name: 'a' });
    const foreign = await fetch(url, {
      method: 'POST',
      headers: { ...headers, authorization: `Bearer ${token}`, origin: 'http://evil.example' },
      body,
    });
    expect(foreign.status).toBe(403);
  });

  it('lists exactly the documented tools with schemas and annotations', async () => {
    const { client } = await newAgent('a');
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([...TOOLS].sort());
    for (const tool of tools) {
      expect(tool.outputSchema, tool.name).toBeDefined();
      expect(tool.annotations?.readOnlyHint, tool.name).toBeTypeOf('boolean');
      expect(tool.description, tool.name).not.toBe('');
    }
    // No tool edits or releases a specification (principle 10).
    expect(tools.some((tool) => /release|draft|component/.test(tool.name))).toBe(false);
  });

  it('runs the agent flow: submit → human releases → prompt → delivered', async () => {
    const { client } = await newAgent('claude-code');
    const { project } = await ok<{ project: { project_id: string } }>(client, 'opsis_create_project', {
      name: 'Shop',
    });
    const projectId = project.project_id;
    expect((await ok<{ projects: unknown[] }>(client, 'opsis_list_projects', {})).projects).toHaveLength(1);

    const submitted = await ok<{
      session_id: string;
      screenshot_id: string;
      ui_id: string;
      status: string;
      editor_url: string;
    }>(client, 'opsis_submit_screenshot', {
      project_id: projectId,
      ui_path: '/dashboard',
      image_base64: await base64Image(),
      mime_type: 'image/png',
      viewport_width: 1280,
      viewport_height: 800,
      device_type: 'desktop',
      description: 'New dashboard',
      agent_session_ref: 'conversation-1',
    });
    expect(submitted).toMatchObject({ ui_id: 'ui-dashboard', status: 'awaiting_review' });
    expect(submitted.editor_url).toBe(`http://127.0.0.1:4777/sessions/${submitted.session_id}`);
    const sessionId = submitted.session_id;

    expect(await errorCode(client, 'opsis_get_specification', { session_id: sessionId })).toBe('NOT_READY');
    expect(await errorCode(client, 'opsis_get_implementation_prompt', { session_id: sessionId })).toBe(
      'NOT_READY',
    );
    const waiting = await ok<{ status: string; next_action: string }>(client, 'opsis_get_session_status', {
      session_id: sessionId,
    });
    expect(waiting.next_action).toContain('opsis_wait_for_specification');

    const released = humanReleases(sessionId, submitted.screenshot_id);

    expect(
      (await ok<{ status: string }>(client, 'opsis_get_session_status', { session_id: sessionId })).status,
    ).toBe('ready');
    const spec = await ok<{ specification: string }>(client, 'opsis_get_specification', {
      session_id: sessionId,
      format: 'markdown',
    });
    expect(spec.specification).toContain('Header');
    const prompt = await ok<{ markdown: string; version_no: number; ui_version_id: string }>(
      client,
      'opsis_get_implementation_prompt',
      { session_id: sessionId },
    );
    expect(prompt).toMatchObject({ version_no: 1, ui_version_id: released.uiVersion.id });
    expect(prompt.markdown).toContain('Header');
    expect(getSession(env.ctx, LOCAL_HUMAN, sessionId).session.status).toBe('delivered');
    // Later retrievals return the same prompt; by version id as well.
    const again = await ok<{ markdown: string }>(client, 'opsis_get_implementation_prompt', {
      version_id: released.uiVersion.id,
    });
    expect(again.markdown).toBe(prompt.markdown);

    const history = await ok<{ versions: { version_no: number }[] }>(client, 'opsis_get_ui_history', {
      project_id: projectId,
      ui_id: 'ui-dashboard',
    });
    expect(history.versions.map((version) => version.version_no)).toEqual([1]);
    const details = await ok<{ status_history: { to: string }[] }>(client, 'opsis_get_session', {
      session_id: sessionId,
    });
    expect(details.status_history.map((event) => event.to)).toEqual([
      'created',
      'uploading',
      'awaiting_review',
      'in_progress',
      'ready',
      'delivered',
    ]);
  });

  it('returns a thumbnail on request and validates the image input', async () => {
    const { client } = await newAgent('a');
    const { project } = await ok<{ project: { project_id: string } }>(client, 'opsis_create_project', {
      name: 'Shop',
    });
    const submitted = await ok<{ screenshot_id: string }>(client, 'opsis_submit_screenshot', {
      project_id: project.project_id,
      ui_path: '/x',
      image_base64: await base64Image(),
    });
    const result = await call(client, 'opsis_get_screenshot', {
      screenshot_id: submitted.screenshot_id,
      include_image: true,
    });
    expect(result.content.map((block) => block.type)).toEqual(['text', 'image']);
    expect(result.content[1]?.mimeType).toBe('image/webp');

    const submit = (image_base64: string) =>
      errorCode(client, 'opsis_submit_screenshot', {
        project_id: project.project_id,
        ui_path: '/x',
        image_base64,
      });
    expect(await submit('data:image/png;base64,AAAA')).toBe('VALIDATION');
    expect(await submit('not base64!')).toBe('VALIDATION');
    expect(await submit(Buffer.from('plain text, not an image').toString('base64'))).toBe(
      'UNSUPPORTED_MEDIA',
    );
    expect(await submit('A'.repeat(Math.ceil(IMAGE_LIMITS.maxBytes / 3) * 4 + 4))).toBe('PAYLOAD_TOO_LARGE');
  });

  it('runs the two-stage upload: request_upload → PUT → awaiting_review', async () => {
    const { client } = await newAgent('a');
    const { project } = await ok<{ project: { project_id: string } }>(client, 'opsis_create_project', {
      name: 'Shop',
    });
    const slot = await ok<{
      session_id: string;
      status: string;
      upload_url: string;
      method: string;
      expires_at: string;
    }>(client, 'opsis_request_upload', { project_id: project.project_id, ui_path: '/big', title: 'Big' });
    expect(slot).toMatchObject({ status: 'uploading', method: 'PUT' });
    expect(slot.upload_url).toMatch(/^http:\/\/127\.0\.0\.1:4777\/api\/v1\/uploads\/opsisupl_/);

    const target = new URL(slot.upload_url);
    const uploaded = await fetch(new URL(target.pathname, url), {
      method: 'PUT',
      headers: { 'content-type': 'image/png' },
      body: Buffer.from(await base64Image(), 'base64'),
    });
    expect(uploaded.status).toBe(201);
    const status = await ok<{ status: string }>(client, 'opsis_get_session_status', {
      session_id: slot.session_id,
    });
    expect(status.status).toBe('awaiting_review');
  });

  it('hides internal error details from the agent', async () => {
    const { client } = await newAgent('a');
    env.ctx.repos.projects.list = () => {
      throw new Error('SQLITE_CORRUPT: /home/secret/data/opsis.db');
    };
    const result = await call(client, 'opsis_list_projects', {});
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe('{"error":{"code":"INTERNAL","message":"Internal server error"}}');
    const failure = await client.listResources().catch((error: unknown) => String(error));
    expect(failure).toContain('Internal server error');
    expect(failure).not.toMatch(/secret|SQLITE/);
  });

  it('answers every tool with NOT_FOUND for another project', async () => {
    // Owner agent with a full set of records.
    const owner = await newAgent('owner');
    const { project } = await ok<{ project: { project_id: string } }>(owner.client, 'opsis_create_project', {
      name: 'Secret',
    });
    const projectId = project.project_id;
    const submitted = await ok<{ session_id: string; screenshot_id: string }>(
      owner.client,
      'opsis_submit_screenshot',
      { project_id: projectId, ui_path: '/secret', image_base64: await base64Image() },
    );
    const versionId = humanReleases(submitted.session_id, submitted.screenshot_id).uiVersion.id;

    // Another agent, granted only its own project.
    const ownProject = createProject(env.ctx, LOCAL_HUMAN, { name: 'Own' }).id;
    const { client } = await newAgent('intruder', [ownProject]);
    const image = await base64Image(1);

    const attempts: [tool: string, args: Record<string, unknown>][] = [
      ['opsis_get_project', { project_id: projectId }],
      ['opsis_update_project', { project_id: projectId, name: 'Owned' }],
      ['opsis_list_ui_views', { project_id: projectId }],
      ['opsis_get_ui_view', { project_id: projectId, ui_id: 'ui-secret' }],
      ['opsis_create_ui_view', { project_id: projectId, path: '/new' }],
      ['opsis_get_ui_history', { project_id: projectId, ui_id: 'ui-secret' }],
      ['opsis_submit_screenshot', { project_id: projectId, ui_path: '/x', image_base64: image }],
      [
        'opsis_submit_screenshot',
        { project_id: ownProject, session_id: submitted.session_id, image_base64: image },
      ],
      ['opsis_request_upload', { project_id: projectId, ui_path: '/x' }],
      ['opsis_request_upload', { project_id: ownProject, session_id: submitted.session_id }],
      ['opsis_get_screenshot', { screenshot_id: submitted.screenshot_id, include_image: true }],
      ['opsis_list_screenshots', { project_id: projectId }],
      ['opsis_get_session', { session_id: submitted.session_id }],
      ['opsis_get_session_status', { session_id: submitted.session_id }],
      ['opsis_wait_for_specification', { session_id: submitted.session_id, timeout_seconds: 1 }],
      ['opsis_get_specification', { session_id: submitted.session_id }],
      ['opsis_get_specification', { version_id: versionId, format: 'markdown' }],
      ['opsis_get_implementation_prompt', { session_id: submitted.session_id }],
      ['opsis_get_implementation_prompt', { version_id: versionId }],
      ['opsis_cancel_session', { session_id: submitted.session_id, reason: 'x' }],
    ];
    // Every tool that takes a project, session, screenshot or version is covered.
    const covered = new Set(attempts.map(([tool]) => tool));
    expect(TOOLS.filter((tool) => !covered.has(tool))).toEqual([
      'opsis_list_projects',
      'opsis_create_project',
    ]);

    for (const [tool, args] of attempts) {
      expect([tool, await errorCode(client, tool, args)]).toEqual([tool, 'NOT_FOUND']);
    }
    const listed = await ok<{ projects: { name: string }[] }>(client, 'opsis_list_projects', {});
    expect(listed.projects.map((p) => p.name)).toEqual(['Own']);
    // The attempts changed nothing: not delivered, not cancelled, not renamed.
    expect(getSession(env.ctx, LOCAL_HUMAN, submitted.session_id).session.status).toBe('ready');
    expect(
      (await ok<{ project: { name: string } }>(owner.client, 'opsis_get_project', { project_id: projectId }))
        .project.name,
    ).toBe('Secret');
  });

  it('lets only the creating agent cancel its session', async () => {
    const projectId = createProject(env.ctx, LOCAL_HUMAN, { name: 'Shared' }).id;
    const first = await newAgent('first', [projectId]);
    const second = await newAgent('second', [projectId]);
    const submitted = await ok<{ session_id: string }>(first.client, 'opsis_submit_screenshot', {
      project_id: projectId,
      ui_path: '/x',
      image_base64: await base64Image(),
    });
    expect(
      await errorCode(second.client, 'opsis_cancel_session', {
        session_id: submitted.session_id,
        reason: 'x',
      }),
    ).toBe('FORBIDDEN_ACTOR');
    const cancelled = await ok<{ session: { status: string } }>(first.client, 'opsis_cancel_session', {
      session_id: submitted.session_id,
      reason: 'wrong screenshot',
    });
    expect(cancelled.session.status).toBe('cancelled');
  });

  it('waits for the release with progress notifications and a resume hint', async () => {
    const { client } = await newAgent('a');
    const { project } = await ok<{ project: { project_id: string } }>(client, 'opsis_create_project', {
      name: 'Shop',
    });
    const submitted = await ok<{ session_id: string; screenshot_id: string }>(
      client,
      'opsis_submit_screenshot',
      {
        project_id: project.project_id,
        ui_path: '/x',
        image_base64: await base64Image(),
      },
    );

    const timedOut = await ok<{
      done: boolean;
      status: string;
      resume: { tool: string; arguments: unknown };
    }>(client, 'opsis_wait_for_specification', { session_id: submitted.session_id, timeout_seconds: 1 });
    expect(timedOut).toMatchObject({
      done: false,
      status: 'awaiting_review',
      resume: {
        tool: 'opsis_wait_for_specification',
        arguments: { session_id: submitted.session_id, timeout_seconds: 1 },
      },
    });

    const progress: { progress: number; message?: string | undefined }[] = [];
    setTimeout(() => {
      humanReleases(submitted.session_id, submitted.screenshot_id);
    }, 300);
    const result = (await client.callTool(
      {
        name: 'opsis_wait_for_specification',
        arguments: { session_id: submitted.session_id, timeout_seconds: 30 },
      },
      { onprogress: (entry) => progress.push(entry), resetTimeoutOnProgress: true },
    )) as ToolResult;
    expect(result.structuredContent).toMatchObject({ done: true, status: 'ready' });
    expect(result.structuredContent).not.toHaveProperty('resume');
    expect(progress.length).toBeGreaterThanOrEqual(1);
    expect(progress[0]?.message).toMatch(/^awaiting_review: 0 components$/);
  });

  it('cleans up the wait when the client cancels the request', async () => {
    const { client } = await newAgent('a');
    const { project } = await ok<{ project: { project_id: string } }>(client, 'opsis_create_project', {
      name: 'Shop',
    });
    const submitted = await ok<{ session_id: string }>(client, 'opsis_submit_screenshot', {
      project_id: project.project_id,
      ui_path: '/x',
      image_base64: await base64Image(),
    });
    const baseline = env.bus.listenerCount;
    const controller = new AbortController();
    const pending = client.callTool(
      {
        name: 'opsis_wait_for_specification',
        arguments: { session_id: submitted.session_id, timeout_seconds: 60 },
      },
      { signal: controller.signal },
    );
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(env.bus.listenerCount).toBe(baseline + 1);
    controller.abort();
    await expect(pending).rejects.toThrow();
    // The server notices the cancellation and unsubscribes.
    for (let i = 0; i < 50 && env.bus.listenerCount > baseline; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(env.bus.listenerCount).toBe(baseline);
  });
});

describe('MCP resources', () => {
  const read = async (client: Client, uri: string) => (await client.readResource({ uri })).contents[0];
  const readJson = async <T = Record<string, unknown>>(client: Client, uri: string) => {
    const content = await read(client, uri);
    if (content === undefined || !('text' in content)) throw new Error(`no text for ${uri}`);
    expect(content.mimeType).toBe('application/json');
    return JSON.parse(content.text) as T;
  };

  const setup = async () => {
    const owner = await newAgent('owner');
    const { project } = await ok<{ project: { project_id: string } }>(owner.client, 'opsis_create_project', {
      name: 'Shop',
    });
    const image = await base64Image();
    const submitted = await ok<{ session_id: string; screenshot_id: string }>(
      owner.client,
      'opsis_submit_screenshot',
      { project_id: project.project_id, ui_path: '/dashboard', image_base64: image },
    );
    return { owner: owner.client, projectId: project.project_id, image, ...submitted };
  };

  it('offers the documented templates and lists only accessible resources', async () => {
    const { owner, projectId, session_id } = await setup();
    const { resourceTemplates } = await owner.listResourceTemplates();
    expect(resourceTemplates.map((template) => template.uriTemplate).sort()).toEqual([
      'opsis://projects/{project_id}',
      'opsis://projects/{project_id}/ui/{ui_id}',
      'opsis://projects/{project_id}/ui/{ui_id}/history',
      'opsis://projects/{project_id}/ui/{ui_id}/versions/{version_no}',
      'opsis://screenshots/{screenshot_id}',
      'opsis://sessions/{session_id}',
      'opsis://sessions/{session_id}/prompt',
      'opsis://sessions/{session_id}/specification',
    ]);
    const { resources } = await owner.listResources();
    expect(resources.map((resource) => resource.uri).sort()).toEqual([
      `opsis://projects/${projectId}`,
      `opsis://projects/${projectId}/ui/ui-dashboard`,
      `opsis://sessions/${session_id}`,
    ]);
    const other = await newAgent('other');
    expect((await other.client.listResources()).resources).toEqual([]);
  });

  it('reads session, specification, prompt, history, version and screenshot', async () => {
    const { owner, projectId, session_id, screenshot_id, image } = await setup();
    const session = await readJson<{ session: { status: string }; next_action: string }>(
      owner,
      `opsis://sessions/${session_id}`,
    );
    expect(session.session.status).toBe('awaiting_review');
    await expect(read(owner, `opsis://sessions/${session_id}/specification`)).rejects.toThrow(/NOT_READY/);
    await expect(read(owner, `opsis://sessions/${session_id}/prompt`)).rejects.toThrow(/NOT_READY/);

    humanReleases(session_id, screenshot_id);
    const spec = await readJson<{ format: string }>(owner, `opsis://sessions/${session_id}/specification`);
    expect(spec.format).toBe('opsis-specification/v1');
    const prompt = await read(owner, `opsis://sessions/${session_id}/prompt`);
    expect(prompt?.mimeType).toBe('text/markdown');
    expect(prompt && 'text' in prompt ? prompt.text : '').toContain('Header');
    expect(getSession(env.ctx, LOCAL_HUMAN, session_id).session.status).toBe('delivered');

    const history = await readJson<{ versions: { version_no: number }[] }>(
      owner,
      `opsis://projects/${projectId}/ui/ui-dashboard/history`,
    );
    expect(history.versions.map((version) => version.version_no)).toEqual([1]);
    const version = await readJson<{ version: { version_no: number }; specification: { format: string } }>(
      owner,
      `opsis://projects/${projectId}/ui/ui-dashboard/versions/1`,
    );
    expect(version).toMatchObject({
      version: { version_no: 1 },
      specification: { format: 'opsis-specification/v1' },
    });
    await expect(read(owner, `opsis://projects/${projectId}/ui/ui-dashboard/versions/2`)).rejects.toThrow();

    const screenshot = await read(owner, `opsis://screenshots/${screenshot_id}`);
    expect(screenshot?.mimeType).toBe('image/png');
    expect(screenshot && 'blob' in screenshot ? screenshot.blob : '').toBe(image);
  });

  it('answers every resource of another project as not found', async () => {
    const { projectId, session_id, screenshot_id } = await setup();
    humanReleases(session_id, screenshot_id);
    const { client } = await newAgent('intruder');
    const uris = [
      `opsis://projects/${projectId}`,
      `opsis://projects/${projectId}/ui/ui-dashboard`,
      `opsis://projects/${projectId}/ui/ui-dashboard/history`,
      `opsis://projects/${projectId}/ui/ui-dashboard/versions/1`,
      `opsis://sessions/${session_id}`,
      `opsis://sessions/${session_id}/specification`,
      `opsis://sessions/${session_id}/prompt`,
      `opsis://screenshots/${screenshot_id}`,
    ];
    for (const uri of uris) {
      const error = await read(client, uri).then(
        () => undefined,
        (thrown: unknown) => thrown as { code?: number; data?: unknown },
      );
      expect([uri, error?.code, error?.data]).toEqual([uri, -32602, { uri }]);
    }
    expect(getSession(env.ctx, LOCAL_HUMAN, session_id).session.status).toBe('ready');
  });

  it('publishes resource updates for status changes and new versions', async () => {
    const { projectId, session_id, screenshot_id } = await setup();
    serverEvents.length = 0;
    humanReleases(session_id, screenshot_id);
    const uris = serverEvents.filter((event) => event.kind === 'resource_updated').map((event) => event.uri);
    expect(uris).toEqual(
      expect.arrayContaining([
        `opsis://sessions/${session_id}`,
        `opsis://sessions/${session_id}/specification`,
        `opsis://sessions/${session_id}/prompt`,
        `opsis://projects/${projectId}/ui/ui-dashboard/history`,
      ]),
    );
  });
});
