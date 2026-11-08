import type {
  ComponentDiff,
  ComponentHistoryEntry,
  SpecValue,
  UiVersion,
  VersionComparison,
} from '@opsis/core';
import { buildAnnotation } from '@opsis/core/browser';
import { api, type VersionDetails } from '../api.js';
import { compareStage, type CompareMode, type StageImage } from '../components/compare-stage.js';
import { diffSummary } from '../components/diff-summary.js';
import { h, replaceChildren, type Child } from '../dom.js';
import { t, type MessageKey } from '../i18n/i18n.js';
import { pathTo } from '../router.js';
import { Disposer, errorBox, formatDateTime, liveSection, type View } from '../ui.js';

const MODES: readonly CompareMode[] = ['overlay', 'wipe', 'side', 'pixel'];

const stageImage = (details: VersionDetails): StageImage => {
  const { snapshot } = details;
  const screenshot = snapshot.screenshots.find((candidate) => candidate.id === snapshot.primaryScreenshotId);
  return {
    url: api.screenshotImageUrl(snapshot.primaryScreenshotId),
    width: screenshot?.width ?? 1,
    height: screenshot?.height ?? 1,
    annotation: buildAnnotation(snapshot, snapshot.primaryScreenshotId),
  };
};

const valueText = (value: SpecValue | null): string =>
  value === null ? t('editor.notSpecified') : `${value.value} (${t(`origin.${value.origin}`)})`;

/** One changed component: what differs, field by field (before → after). */
const changeLines = (change: ComponentDiff, a: VersionDetails, b: VersionDetails): Child[] => {
  const nameIn = (details: VersionDetails, id: string | null): string =>
    id === null
      ? t('diff.root')
      : (details.snapshot.components.find((component) => component.componentId === id)?.name ?? id);
  const rect = (r: { x: number; y: number; width: number; height: number }): string =>
    `x ${String(r.x)}, y ${String(r.y)}, ${String(r.width)}×${String(r.height)}`;
  const lines: Child[] = [];
  if (change.rename) lines.push(h('li', {}, t('diff.rename', { ...change.rename })));
  if (change.kind) {
    lines.push(
      h(
        'li',
        {},
        t('diff.kind', { before: t(`kind.${change.kind.before}`), after: t(`kind.${change.kind.after}`) }),
      ),
    );
  }
  if (change.parent) {
    lines.push(
      h(
        'li',
        {},
        t('diff.parent', {
          before: nameIn(a, change.parent.before),
          after: nameIn(b, change.parent.after),
        }),
      ),
    );
  }
  if (change.reordered === true) lines.push(h('li', {}, t('diff.reordered')));
  for (const geometry of change.geometry) {
    lines.push(
      h(
        'li',
        {},
        t('diff.geometry', {
          device: t(`device.${geometry.deviceCategory}`),
          before: rect(geometry.before),
          after: rect(geometry.after),
        }),
      ),
    );
  }
  for (const field of change.fields) {
    lines.push(
      h(
        'li',
        {},
        h('strong', {}, t(`spec.${field.field}` as MessageKey)),
        h(
          'dl',
          { class: 'before-after' },
          h('dt', {}, t('diff.before')),
          h('dd', {}, valueText(field.before)),
          h('dt', {}, t('diff.after')),
          h('dd', {}, valueText(field.after)),
        ),
      ),
    );
  }
  return lines;
};

const historyList = (entries: readonly ComponentHistoryEntry[]): HTMLElement =>
  h(
    'ol',
    { class: 'component-history' },
    entries.map((entry) =>
      h(
        'li',
        {},
        h(
          'a',
          { attrs: { href: pathTo('versions', entry.version.id) } },
          `V${String(entry.version.versionNo)}`,
        ),
        ' ',
        entry.change === null
          ? h('span', { class: 'muted' }, t('diff.notInVersion'))
          : h('span', { class: `badge diff-${entry.change.status}` }, t(`diff.${entry.change.status}`)),
        entry.revision !== null && ` ${entry.revision.name}`,
      ),
    ),
  );

/**
 * History of a UI view (architecture 05 §4–5): timeline of versions, visual comparison of
 * two versions (overlay, wipe, side by side, detected pixel differences) and the
 * component-level diff with the history of each component.
 */
export const historyView: View = (root, params) => {
  const projectId = params['projectId'] ?? '';
  const uiId = params['uiId'] ?? '';
  const disposer = new Disposer();
  const query = new URLSearchParams(location.search);
  let a = query.get('a');
  let b = query.get('b');
  let mode: CompareMode = 'overlay';
  let frames = true;
  let amount = 0.5;
  let pixelUrl: string | null = null;
  let sequence = 0;
  let changesSequence = 0;
  const cache = new Map<string, Promise<VersionDetails>>();
  const details = (id: string): Promise<VersionDetails> => {
    let entry = cache.get(id);
    if (!entry) {
      entry = api.getVersion(id);
      cache.set(id, entry);
    }
    return entry;
  };
  const releasePixelUrl = (): void => {
    if (pixelUrl !== null) URL.revokeObjectURL(pixelUrl);
    pixelUrl = null;
  };
  disposer.addCallback(releasePixelUrl);

  const controls = h('div', { class: 'row compare-controls' });
  const stage = h('div', { class: 'compare-area' });
  const changes = h('section', { class: 'component-changes' });
  let versions: readonly UiVersion[] = [];

  const select = (value: string | null, onChange: (id: string) => void): HTMLSelectElement => {
    const element = h(
      'select',
      {
        onChange: () => {
          onChange(element.value);
        },
      },
      versions.map((version) =>
        h(
          'option',
          { attrs: { value: version.id }, props: { selected: version.id === value } },
          `V${String(version.versionNo)} · ${formatDateTime(version.createdAt)}`,
        ),
      ),
    );
    return element;
  };

  const renderControls = (): void => {
    const range = h('input', {
      attrs: {
        type: 'range',
        min: 0,
        max: 100,
        value: Math.round(amount * 100),
        'aria-label': t(mode === 'wipe' ? 'history.wipe' : 'history.opacity'),
      },
      onInput: () => {
        amount = Number(range.value) / 100;
        void renderStage();
      },
    });
    replaceChildren(
      controls,
      h(
        'label',
        {},
        t('history.compareA'),
        ' ',
        select(a, (id) => {
          a = id;
          update();
        }),
      ),
      h(
        'label',
        {},
        t('history.compareB'),
        ' ',
        select(b, (id) => {
          b = id;
          update();
        }),
      ),
      h(
        'div',
        { class: 'strip', attrs: { role: 'tablist' } },
        MODES.map((value) =>
          h(
            'button',
            {
              attrs: { type: 'button', role: 'tab', 'aria-selected': String(value === mode) },
              onClick: () => {
                mode = value;
                renderControls();
                void renderStage();
              },
            },
            t(`history.mode.${value}`),
          ),
        ),
      ),
      (mode === 'overlay' || mode === 'wipe') &&
        h('label', {}, t(mode === 'wipe' ? 'history.wipe' : 'history.opacity'), ' ', range),
      mode !== 'pixel' &&
        h(
          'label',
          { class: 'check' },
          h('input', {
            attrs: { type: 'checkbox' },
            props: { checked: frames },
            onChange: (event) => {
              frames = (event.currentTarget as HTMLInputElement).checked;
              void renderStage();
            },
          }),
          t('history.frames'),
        ),
    );
  };

  const renderStage = async (): Promise<void> => {
    if (a === null || b === null) return;
    const current = ++sequence;
    try {
      const [detailsA, detailsB] = await Promise.all([details(a), details(b)]);
      if (current !== sequence) return;
      if (mode !== 'pixel') {
        replaceChildren(
          stage,
          compareStage(stageImage(detailsA), stageImage(detailsB), { mode, frames, amount }),
          frames && h('p', { class: 'muted' }, t('history.legend')),
        );
        return;
      }
      replaceChildren(stage, h('p', { class: 'muted' }, t('common.loading')));
      const result = await api.pixelDiff(a, b);
      if (current !== sequence) return;
      releasePixelUrl();
      pixelUrl = URL.createObjectURL(result.blob);
      const percent = (100 * result.differentPixels) / Math.max(1, result.width * result.height);
      replaceChildren(
        stage,
        h(
          'p',
          {},
          t('history.pixelResult', {
            count: result.differentPixels.toLocaleString(),
            percent: percent.toFixed(2),
            size: `${String(result.width)}×${String(result.height)}`,
          }),
          ' ',
          h('span', { class: 'muted' }, t('history.pixelNote')),
        ),
        result.resized &&
          h(
            'p',
            { class: 'notice warning' },
            t('history.pixelResized', {
              a: result.aspectRatioA.toFixed(3),
              b: result.aspectRatioB.toFixed(3),
            }),
          ),
        h('img', { class: 'pixel-diff', attrs: { src: pixelUrl, alt: t('history.mode.pixel') } }),
      );
    } catch (error) {
      if (current === sequence) replaceChildren(stage, errorBox(error));
    }
  };

  const renderChanges = async (): Promise<void> => {
    if (a === null || b === null) return;
    const current = ++changesSequence;
    try {
      const [comparison, detailsA, detailsB]: [VersionComparison, VersionDetails, VersionDetails] =
        await Promise.all([api.compareVersions(a, b), details(a), details(b)]);
      if (current !== changesSequence) return;
      const changed = comparison.diff.components.filter((component) => component.status !== 'unchanged');
      replaceChildren(
        changes,
        h('h2', {}, t('history.components')),
        diffSummary(comparison.diff),
        changed.map((change) => {
          const historyBox = h('div');
          return h(
            'details',
            { class: 'component-change' },
            h(
              'summary',
              {},
              h('span', { class: `badge diff-${change.status}` }, t(`diff.${change.status}`)),
              ' ',
              change.name,
            ),
            h('ul', {}, changeLines(change, detailsA, detailsB)),
            h(
              'button',
              {
                class: 'link',
                attrs: { type: 'button' },
                onClick: () => {
                  api
                    .componentHistory(projectId, uiId, change.componentId)
                    .then((entries) => {
                      replaceChildren(
                        historyBox,
                        h('h3', {}, t('history.componentHistory')),
                        historyList(entries),
                      );
                    })
                    .catch((error: unknown) => {
                      replaceChildren(historyBox, errorBox(error));
                    });
                },
              },
              t('history.componentHistory'),
            ),
            historyBox,
          );
        }),
      );
    } catch (error) {
      if (current === changesSequence) replaceChildren(changes, errorBox(error));
    }
  };

  const update = (): void => {
    const search = new URLSearchParams();
    if (a !== null) search.set('a', a);
    if (b !== null) search.set('b', b);
    history.replaceState(null, '', `${location.pathname}?${search.toString()}`);
    renderControls();
    void renderStage();
    void renderChanges();
  };

  const timeline = disposer.add(
    liveSection({
      load: () => api.listVersions(projectId, uiId),
      relevant: (event) => event.type === 'UiVersionCreated' && event.projectId === projectId,
      onData: (list) => {
        versions = list;
        if (list.length < 2) {
          replaceChildren(controls);
          replaceChildren(stage);
          replaceChildren(changes);
          return;
        }
        const known = (id: string | null): id is string => list.some((version) => version.id === id);
        if (!known(b)) b = list[list.length - 1]?.id ?? null;
        if (!known(a)) {
          const index = list.findIndex((version) => version.id === b);
          a = list[Math.max(0, index - 1)]?.id ?? null;
        }
        update();
      },
      render: (list) =>
        list.length < 2
          ? h('p', { class: 'muted' }, t('history.needTwo'))
          : h(
              'ol',
              { class: 'timeline' },
              [...list].reverse().map((version, index, reversed) => {
                const predecessor = reversed[index + 1];
                return h(
                  'li',
                  {},
                  h(
                    'a',
                    { attrs: { href: pathTo('versions', version.id) } },
                    h('strong', {}, `V${String(version.versionNo)}`),
                  ),
                  ' · ',
                  formatDateTime(version.createdAt),
                  version.changeDescription !== '' && ` · ${version.changeDescription}`,
                  predecessor &&
                    h(
                      'button',
                      {
                        class: 'link',
                        attrs: { type: 'button' },
                        onClick: () => {
                          a = predecessor.id;
                          b = version.id;
                          update();
                        },
                      },
                      t('history.withPredecessor', { version: predecessor.versionNo }),
                    ),
                );
              }),
            ),
    }),
  );

  root.append(
    h(
      'nav',
      { class: 'breadcrumb' },
      h('a', { attrs: { href: '/' } }, t('projects.title')),
      ' / ',
      h('a', { attrs: { href: pathTo('projects', projectId, 'ui', uiId) } }, uiId),
    ),
    h('h1', {}, t('history.title'), ' ', h('code', { class: 'muted' }, uiId)),
    h('section', {}, h('h2', {}, t('history.timeline')), timeline.element),
    controls,
    stage,
    changes,
  );
  return disposer.dispose;
};
