import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { expect, test, type APIRequestContext } from '@playwright/test';
import sharp from 'sharp';

/**
 * The core flow of OPSIS through all layers: an agent submits a screenshot over MCP, the
 * human marks a component in the browser editor and releases, the agent receives the
 * implementation prompt and the session becomes "delivered".
 */

interface ToolResult {
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
  content: { type: string; text?: string }[];
}

const tool = async <T>(client: Client, name: string, args: Record<string, unknown>): Promise<T> => {
  const result = (await client.callTool({ name, arguments: args })) as ToolResult;
  expect(result.isError, `${name}: ${result.content[0]?.text ?? ''}`).not.toBe(true);
  return result.structuredContent as T;
};

const connectAgent = async (request: APIRequestContext, baseURL: string): Promise<Client> => {
  const created = await request.post('/api/v1/agents', { data: { name: 'e2e-agent' } });
  expect(created.status()).toBe(201);
  const { token } = (await created.json()) as { token: string };
  const client = new Client({ name: 'opsis-e2e', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL('/mcp', baseURL), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  return client;
};

const screenshot = async (): Promise<string> => {
  const image = await sharp({
    create: { width: 1280, height: 800, channels: 3, background: { r: 240, g: 244, b: 250 } },
  })
    .composite([
      {
        input: { create: { width: 1280, height: 72, channels: 3, background: { r: 30, g: 60, b: 120 } } },
        top: 0,
        left: 0,
      },
    ])
    .png()
    .toBuffer();
  return image.toString('base64');
};

test('agent submits, human specifies and releases, agent gets the prompt', async ({
  page,
  request,
  baseURL,
}) => {
  const client = await connectAgent(request, baseURL ?? '');
  try {
    const { project } = await tool<{ project: { project_id: string } }>(client, 'opsis_create_project', {
      name: 'E2E Shop',
    });
    const submitted = await tool<{ session_id: string; editor_url: string; status: string }>(
      client,
      'opsis_submit_screenshot',
      {
        project_id: project.project_id,
        ui_path: '/dashboard',
        image_base64: await screenshot(),
        viewport_width: 1280,
        viewport_height: 800,
        device_type: 'desktop',
        description: 'Dashboard with a header bar',
      },
    );
    expect(submitted.status).toBe('awaiting_review');

    // The human opens the editor link the agent passed on.
    await page.goto(new URL(submitted.editor_url).pathname);
    await page.getByRole('button', { name: 'Start review' }).click();

    // Draw one component over the header bar.
    await page.getByRole('button', { name: /Draw component/ }).click();
    const stage = page.getByLabel('Drag or scroll to pan', { exact: false });
    const box = await stage.boundingBox();
    if (!box) throw new Error('editor stage not visible');
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx - 150, cy - 40);
    await page.mouse.down();
    await page.mouse.move(cx + 150, cy + 40, { steps: 8 });
    await page.mouse.up();

    const name = page.getByRole('textbox', { name: 'Name', exact: true });
    await name.fill('Header bar');
    await name.press('Tab');
    await expect(page.getByText('All changes saved')).toBeVisible();

    // Release: acknowledge the completeness warnings, then release.
    await page.getByRole('button', { name: 'Release…' }).click();
    await page.getByRole('button', { name: 'Acknowledge all' }).click();
    await page.getByRole('button', { name: 'Release now' }).click();

    const status = async () =>
      (
        await tool<{ status: string }>(client, 'opsis_get_session_status', {
          session_id: submitted.session_id,
        })
      ).status;
    await expect.poll(status).toBe('ready');

    const done = await tool<{ done: boolean; status: string }>(client, 'opsis_wait_for_specification', {
      session_id: submitted.session_id,
      timeout_seconds: 5,
    });
    expect(done).toMatchObject({ done: true, status: 'ready' });

    const prompt = await tool<{ markdown: string; version_no: number }>(
      client,
      'opsis_get_implementation_prompt',
      { session_id: submitted.session_id },
    );
    expect(prompt.version_no).toBe(1);
    expect(prompt.markdown).toContain('Header bar');
    expect(await status()).toBe('delivered');

    // The browser shows the delivered state live (SSE), without a reload.
    await expect(page.getByText(/delivered/i).first()).toBeVisible();
  } finally {
    await client.close();
  }
});
