import { writeFileSync, mkdirSync } from 'node:fs';
import { expect, test, type APIRequestContext } from '@playwright/test';
import sharp from 'sharp';

/**
 * Performance measurements (07, Phase 6): a screenshot 8000 px tall and a component tree
 * of 1000 components with markings. Measures the server (draft operations, draft load,
 * release, prompt) and the browser editor (load, selection, panning). The budgets are
 * deliberately generous – the numbers go to test-results/perf.json and the console.
 */

const COMPONENTS = 1000;
const WIDTH = 1440;
const HEIGHT = 8000;
const results: Record<string, number> = {};

const timed = async <T>(label: string, work: () => Promise<T>): Promise<T> => {
  const start = performance.now();
  const value = await work();
  results[label] = Math.round(performance.now() - start);
  return value;
};

const json = async <T>(response: Awaited<ReturnType<APIRequestContext['get']>>): Promise<T> => {
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()) as T;
};

/** Ten sections, each with 9 groups of 10 leaves + the group nodes (≈ 1000 components). */
const buildOperations = (screenshotId: string) => {
  const operations: Record<string, unknown>[] = [];
  let n = 0;
  const add = (parentId: string | null, x: number, y: number, width: number, height: number) => {
    n += 1;
    const componentId = `cmp_PERF${String(n).padStart(22, '0')}`;
    operations.push({
      op: 'addComponent',
      componentId,
      parentId,
      name: `Component ${String(n)}`,
      kind: parentId === null ? 'container' : 'component',
      region: { screenshotId, x, y, width, height },
    });
    return componentId;
  };
  for (let s = 0; s < 10 && n < COMPONENTS; s += 1) {
    const sectionY = s * 790 + 20;
    const section = add(null, 20, sectionY, WIDTH - 40, 760);
    for (let g = 0; g < 9 && n < COMPONENTS; g += 1) {
      const groupY = sectionY + 10 + g * 82;
      const group = add(section, 40, groupY, WIDTH - 80, 76);
      for (let l = 0; l < 10 && n < COMPONENTS; l += 1) add(group, 50 + l * 135, groupY + 8, 125, 60);
    }
  }
  return operations;
};

test('8000 px screenshot with 1000 components', async ({ page, request }) => {
  test.setTimeout(180_000);
  const project = await json<{ id: string }>(
    await request.post('/api/v1/projects', { data: { name: 'Perf' } }),
  );
  const image = await sharp({
    create: { width: WIDTH, height: HEIGHT, channels: 3, background: { r: 245, g: 247, b: 250 } },
  })
    .png()
    .toBuffer();

  const submitted = await timed('server.upload_8000px', async () =>
    json<{ session: { id: string }; screenshot: { id: string } }>(
      await request.post(`/api/v1/projects/${project.id}/screenshots`, {
        multipart: {
          uiPath: '/long-page',
          image: { name: 'long.png', mimeType: 'image/png', buffer: image },
        },
      }),
    ),
  );
  const sessionId = submitted.session.id;
  await json(await request.post(`/api/v1/sessions/${sessionId}/start-review`));

  const operations = buildOperations(submitted.screenshot.id);
  expect(operations).toHaveLength(COMPONENTS);
  await timed('server.add_1000_components', async () => {
    let revision = 0;
    for (let i = 0; i < operations.length; i += 500) {
      const result = await json<{ revision: number }>(
        await request.post(`/api/v1/sessions/${sessionId}/draft/operations`, {
          data: { baseRevision: revision, operations: operations.slice(i, i + 500) },
        }),
      );
      revision = result.revision;
    }
  });
  await timed('server.get_draft', async () => json(await request.get(`/api/v1/sessions/${sessionId}/draft`)));

  // Browser: open the editor, wait for the complete tree.
  await timed('browser.editor_load', async () => {
    await page.goto(`/sessions/${sessionId}`);
    await expect(page.getByRole('treeitem')).toHaveCount(COMPONENTS, { timeout: 30_000 });
  });
  // Measured inside the page (Playwright locators would dominate the timings): time from
  // the input event until the next frame has been painted.
  const inPage = await page.evaluate(async () => {
    const nextFrame = () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          setTimeout(resolve, 0);
        });
      });
    const measure = async (work: () => void) => {
      const start = performance.now();
      work();
      await nextFrame();
      return performance.now() - start;
    };
    const rows = [...document.querySelectorAll<HTMLElement>('[role="treeitem"]')];
    const select: number[] = [];
    for (const index of [10, 500, 990, 250, 750]) {
      const label = rows[index]?.querySelector<HTMLElement>('.tree-label') ?? rows[index];
      select.push(await measure(() => label?.click()));
    }
    const stage = document.querySelector<HTMLElement>('canvas')?.parentElement;
    if (!stage) throw new Error('stage not found');
    const rect = stage.getBoundingClientRect();
    const pan: number[] = [];
    for (let i = 0; i < 60; i += 1) {
      pan.push(
        await measure(() => {
          stage.dispatchEvent(
            new WheelEvent('wheel', {
              deltaY: 120,
              clientX: rect.x + rect.width / 2,
              clientY: rect.y + rect.height / 2,
              bubbles: true,
              cancelable: true,
            }),
          );
        }),
      );
    }
    const hover: number[] = [];
    for (let i = 0; i < 30; i += 1) {
      hover.push(
        await measure(() => {
          stage.dispatchEvent(
            new PointerEvent('pointermove', {
              clientX: rect.x + 100 + i * 20,
              clientY: rect.y + 200,
              bubbles: true,
            }),
          );
        }),
      );
    }
    return { select, pan, hover };
  });
  const percentile = (values: number[], p: number) => {
    const sorted = [...values].sort((a, b) => a - b);
    return Math.round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0);
  };
  for (const [name, values] of Object.entries(inPage)) {
    results[`browser.${name}_p50_ms`] = percentile(values, 0.5);
    results[`browser.${name}_max_ms`] = percentile(values, 1);
  }

  // Release with all completeness warnings acknowledged.
  const { session } = await json<{ session: { rowVersion: number } }>(
    await request.get(`/api/v1/sessions/${sessionId}`),
  );
  const blocked = await request.post(`/api/v1/sessions/${sessionId}/release`, {
    data: { rowVersion: session.rowVersion, acknowledgedWarnings: [] },
  });
  const warnings = (
    (await blocked.json()) as { error: { details?: { unacknowledgedWarnings?: { id: string }[] } } }
  ).error.details?.unacknowledgedWarnings?.map((warning) => warning.id);
  expect(warnings).toHaveLength(2 * COMPONENTS);
  const released = await timed('server.release', async () =>
    json<{ uiVersion: { id: string } }>(
      await request.post(`/api/v1/sessions/${sessionId}/release`, {
        data: { rowVersion: session.rowVersion, acknowledgedWarnings: warnings },
      }),
    ),
  );
  await timed('server.prompt', async () => {
    const response = await request.get(`/api/v1/versions/${released.uiVersion.id}/prompt`);
    expect(response.ok()).toBe(true);
    expect(await response.text()).toContain('Component 1000');
  });
  await timed('server.version_view', async () =>
    json(await request.get(`/api/v1/versions/${released.uiVersion.id}`)),
  );

  mkdirSync('test-results', { recursive: true });
  writeFileSync('test-results/perf.json', `${JSON.stringify(results, null, 2)}\n`);
  console.log(results);

  // Generous budgets: they catch regressions by orders of magnitude, not jitter.
  expect(results['server.add_1000_components']).toBeLessThan(10_000);
  expect(results['server.release']).toBeLessThan(10_000);
  expect(results['browser.editor_load']).toBeLessThan(10_000);
  expect(results['browser.select_max_ms']).toBeLessThan(1000);
  expect(results['browser.pan_max_ms']).toBeLessThan(200);
});
