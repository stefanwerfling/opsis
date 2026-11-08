import { describe, expect, it } from 'vitest';
import { assessCompleteness } from '../completeness.js';
import { applyDraftOperations, emptyDraft, type DraftOperation } from '../draft.js';
import type { Project } from '../project.js';
import type { Screenshot } from '../screenshot.js';
import type { Session } from '../session.js';
import type { UiView } from '../ui-view.js';
import type { PromptLanguage } from '../vocabulary.js';
import { compareVersions } from '../diff.js';
import { canonicalJson } from './canonical-json.js';
import { renderSpecificationMarkdown } from './markdown.js';
import { generatePrompt } from './prompt.js';
import {
  buildSnapshot,
  buildSpecificationDocument,
  componentContent,
  type ReleaseReferences,
  type SpecSnapshot,
} from './snapshot.js';

/** Deterministic, valid ids (`cmp_01JZ0…0HEADER` style) so snapshot files stay stable. */
const fid = (prefix: string, tag: string): string => `${prefix}_01JZ${tag.padStart(22, '0')}`;

const NOW = '2026-11-08T10:00:00.000Z';
const DESKTOP = fid('scr', 'DESK');
const MOBILE = fid('scr', 'MB');

const project = (promptLanguage: PromptLanguage): Project => ({
  id: fid('prj', 'SHP'),
  slug: 'demo-shop',
  name: 'Demo Shop',
  description: 'Online shop for garden tools. Web app built with TypeScript.',
  promptLanguage,
  metadata: {},
  createdAt: NOW,
  updatedAt: NOW,
  archivedAt: null,
});

const uiView: UiView = {
  id: fid('uiv', 'DASH'),
  projectId: fid('prj', 'SHP'),
  uiId: 'ui-dashboard',
  path: '/dashboard',
  name: 'Dashboard',
  description: '',
  headVersionId: null,
  createdAt: NOW,
  updatedAt: NOW,
};

const session: Session = {
  id: fid('ses', 'S1'),
  projectId: fid('prj', 'SHP'),
  uiViewId: fid('uiv', 'DASH'),
  agentId: fid('agt', 'A1'),
  agentSessionRef: 'conversation-42',
  intent: 'create',
  title: 'Dashboard first draft',
  status: 'in_progress',
  assignment: 'confirmed',
  proposedPath: null,
  assignmentNote: null,
  baseVersionId: null,
  rebasedFromVersionId: null,
  resultVersionId: null,
  statusReason: null,
  rowVersion: 3,
  createdAt: NOW,
  updatedAt: NOW,
};

const screenshot = (id: string, sequenceNo: number, extra: Partial<Screenshot>): Screenshot => ({
  id,
  projectId: fid('prj', 'SHP'),
  uiViewId: fid('uiv', 'DASH'),
  sessionId: session.id,
  blobSha256: String(sequenceNo).repeat(64).slice(0, 64),
  mimeType: 'image/png',
  width: 1440,
  height: 900,
  viewportWidth: 1440,
  viewportHeight: 900,
  deviceCategory: 'desktop',
  variantLabel: null,
  sequenceNo,
  capturedAt: null,
  source: 'mcp',
  submittedBy: 'agent:agt_1',
  description: '',
  createdAt: NOW,
  ...extra,
});

const desktop = screenshot(DESKTOP, 1, { description: 'Logged-in state' });
const mobile = screenshot(MOBILE, 2, {
  width: 390,
  height: 844,
  viewportWidth: 390,
  viewportHeight: 844,
  deviceCategory: 'mobile',
  variantLabel: 'iPhone',
});

const refs: ReleaseReferences = {
  uiVersionId: fid('uvr', 'V1'),
  versionNo: 1,
  specRevisionId: fid('spr', 'R1'),
  revisionNo: 1,
  predecessor: null,
  releasedAt: NOW,
  releasedBy: 'human:local',
  changeDescription: 'First version of the dashboard',
};

const ids = {
  header: fid('cmp', 'HEADER'),
  logo: fid('cmp', 'MARK'),
  nav: fid('cmp', 'NAV'),
  stats: fid('cmp', 'STATS'),
  chart: fid('cmp', 'CHART'),
  legend: fid('cmp', 'KEY'),
  item: fid('cmp', 'ENTRY'),
};

const add = (
  componentId: string,
  parentId: string | null,
  name: string,
  kind: 'component' | 'container' | 'visual_area' | 'interactive' | 'group',
  rect?: { x: number; y: number; width: number; height: number },
  screenshotId = DESKTOP,
): DraftOperation => ({
  op: 'addComponent',
  componentId,
  parentId,
  name,
  kind,
  ...(rect === undefined ? {} : { region: { screenshotId, ...rect } }),
});

const set = (
  componentId: string,
  group: string,
  field: string,
  value: string,
  origin: 'user' | 'screenshot_derived' | 'auto_detected' = 'user',
  note?: string,
): DraftOperation =>
  ({
    op: 'setSpecValue',
    componentId,
    group,
    field,
    value: { value, origin, ...(note === undefined ? {} : { note }) },
  }) as DraftOperation;

const make = (
  operations: DraftOperation[],
  options: { language?: PromptLanguage; acknowledge?: 'all'; screenshots?: Screenshot[] } = {},
): SpecSnapshot => {
  const screenshots = options.screenshots ?? [desktop];
  const draft = applyDraftOperations(emptyDraft(session.id, NOW), operations, { screenshots });
  const completeness = assessCompleteness(draft, { assignment: 'confirmed' });
  return buildSnapshot({
    project: project(options.language ?? 'en'),
    uiView,
    session,
    baseVersion: null,
    screenshots,
    draft,
    completeness,
    acknowledgedWarnings: options.acknowledge === 'all' ? completeness.warnings.map((w) => w.id) : [],
  });
};

/** Fully specified dashboard: no warnings, two screenshot variants. */
const completeOps = (): DraftOperation[] => [
  add(ids.header, null, 'Header', 'container', { x: 0, y: 0, width: 1440, height: 80 }),
  add(ids.logo, ids.header, 'Logo', 'visual_area', { x: 24, y: 16, width: 140, height: 48 }),
  add(ids.nav, ids.header, 'MainNavigation', 'interactive', { x: 900, y: 20, width: 500, height: 40 }),
  add(ids.stats, null, 'StatisticsCard', 'component', { x: 24, y: 120, width: 400, height: 240 }),
  {
    op: 'setRegion',
    componentId: ids.header,
    screenshotId: MOBILE,
    rect: { x: 0, y: 0, width: 390, height: 64 },
  },
  set(ids.header, 'general', 'description', 'Top bar with logo and navigation'),
  set(ids.header, 'layout', 'positioning', 'Sticky at the top, full width'),
  set(ids.header, 'visual', 'colors', 'Background #2457d6, text white', 'screenshot_derived'),
  set(ids.header, 'visual', 'responsive', 'Below 768 px the navigation collapses into a menu button'),
  set(ids.header, 'acceptance', 'expectedLayout', 'Header stays visible while scrolling'),
  set(ids.header, 'acceptance', 'responsiveRequirements', 'Height 64 px on mobile'),
  set(ids.logo, 'general', 'description', 'Shop logo, links to the start page'),
  set(ids.logo, 'acceptance', 'expectedBehavior', 'Click opens /'),
  set(ids.nav, 'general', 'description', 'Links: Dashboard, Orders, Settings'),
  set(ids.nav, 'interaction', 'hover', 'Underline the hovered link'),
  set(ids.nav, 'interaction', 'keyboard', 'Tab moves through the links, Enter opens'),
  set(ids.nav, 'functional', 'actions', 'Navigates to the selected page'),
  set(ids.nav, 'acceptance', 'expectedBehavior', 'Active page link is highlighted'),
  set(ids.stats, 'general', 'description', 'Revenue of the last 30 days'),
  set(ids.stats, 'functional', 'dataSources', 'GET /api/stats/revenue?days=30'),
  set(ids.stats, 'interaction', 'loading', 'Skeleton placeholder'),
  set(ids.stats, 'interaction', 'error', 'Message "Could not load revenue" with retry button'),
  set(ids.stats, 'acceptance', 'functionalRequirements', 'Amount formatted in EUR'),
  {
    op: 'addRelation',
    relationId: fid('rel', 'R1'),
    fromComponentId: ids.nav,
    toComponentId: ids.stats,
    kind: 'controls',
    description: 'Selecting "Orders" replaces the card',
  },
  {
    op: 'updateDraft',
    goal: 'Implement the dashboard page as shown.',
    acceptance: ['Page loads in under 1 s', 'No layout shift after loading'],
  },
];

const complete = (language: PromptLanguage = 'en'): SpecSnapshot =>
  make(completeOps(), { language, screenshots: [desktop, mobile] });

/**
 * V2 of `complete`: renamed and resized components, changed/removed fields, a removed and
 * a new component, a changed and a new relation, one more global acceptance criterion.
 */
const revised = (language: PromptLanguage = 'en'): SpecSnapshot =>
  make(
    [
      ...completeOps(),
      { op: 'updateComponent', componentId: ids.stats, name: 'RevenueCard' },
      {
        op: 'setRegion',
        componentId: ids.header,
        screenshotId: DESKTOP,
        rect: { x: 0, y: 0, width: 1440, height: 96 },
      },
      set(ids.header, 'layout', 'positioning', 'Sticky at the top, full width\nShadow when scrolled'),
      { op: 'setSpecValue', componentId: ids.nav, group: 'interaction', field: 'hover', value: null },
      { op: 'deleteComponent', componentId: ids.logo },
      add(ids.item, ids.header, 'SearchField', 'interactive', { x: 400, y: 24, width: 360, height: 48 }),
      set(ids.item, 'general', 'description', 'Search over orders'),
      set(ids.item, 'acceptance', 'expectedBehavior', 'Enter opens the result list'),
      {
        op: 'updateRelation',
        relationId: fid('rel', 'R1'),
        description: 'Selecting "Orders" filters the card',
      },
      {
        op: 'addRelation',
        relationId: fid('rel', 'R2'),
        fromComponentId: ids.item,
        toComponentId: ids.stats,
        kind: 'data_flow',
        description: '',
      },
      {
        op: 'updateDraft',
        changeSummary: 'Search in the header, taller header, logo removed.',
        acceptance: [
          'Page loads in under 1 s',
          'No layout shift after loading',
          'Search answers in under 300 ms',
        ],
      },
    ],
    { language, screenshots: [desktop, mobile] },
  );

const refsV2: ReleaseReferences = {
  ...refs,
  uiVersionId: fid('uvr', 'V2'),
  versionNo: 2,
  specRevisionId: fid('spr', 'R2'),
  revisionNo: 2,
  predecessor: { id: fid('uvr', 'V1'), versionNo: 1 },
  changeDescription: 'Header search',
};

/** Little specified: missing fields, auto-detected value, open questions – released with acknowledged warnings. */
const incomplete = (): SpecSnapshot =>
  make(
    [
      add(ids.header, null, 'Header', 'container', { x: 0, y: 0, width: 1440, height: 80 }),
      add(ids.stats, null, 'StatisticsCard', 'component'),
      set(ids.header, 'visual', 'colors', '#2457d6', 'auto_detected'),
      set(ids.stats, 'general', 'description', 'Shows revenue'),
      { op: 'updateDraft', openQuestions: ['Which currency?', 'Is there a dark mode?'] },
    ],
    { acknowledge: 'all' },
  );

/** Resolved contradiction + geometry hint, German prompt. */
const contradictory = (): SpecSnapshot =>
  make(
    [
      add(ids.stats, null, 'Statistikkarte', 'container', { x: 24, y: 120, width: 400, height: 240 }),
      add(ids.chart, ids.stats, 'Diagramm', 'visual_area', { x: 300, y: 300, width: 300, height: 120 }),
      set(ids.stats, 'general', 'description', 'Umsatz der letzten 30 Tage'),
      set(ids.stats, 'layout', 'sizing', 'Feste Breite 400 px'),
      set(ids.stats, 'acceptance', 'expectedLayout', 'Karte ist 400 px breit'),
      set(ids.chart, 'general', 'description', 'Liniendiagramm'),
      set(ids.chart, 'layout', 'sizing', 'Volle Breite des Inhaltsbereichs'),
      set(ids.chart, 'interaction', 'disabled', 'Ausgegraut ohne Daten'),
      set(ids.chart, 'acceptance', 'expectedBehavior', 'Zeigt 30 Datenpunkte'),
      {
        op: 'addConflict',
        conflictId: fid('cfl', 'C1'),
        componentIds: [ids.stats, ids.chart],
        description: 'Karte hat feste Breite, Diagramm soll volle Breite haben',
      },
      {
        op: 'updateConflict',
        conflictId: fid('cfl', 'C1'),
        status: 'resolved',
        resolution: 'Diagramm nutzt die volle Breite der Karte, nicht der Seite',
      },
    ],
    { language: 'de', acknowledge: 'all' },
  );

/** Four levels deep, multi-line values with notes, German prompt. */
const nested = (): SpecSnapshot =>
  make(
    [
      add(ids.stats, null, 'Karte', 'container', { x: 0, y: 0, width: 600, height: 400 }),
      add(ids.chart, ids.stats, 'Inhalt', 'group', { x: 10, y: 50, width: 580, height: 300 }),
      add(ids.legend, ids.chart, 'Legende', 'component', { x: 20, y: 300, width: 300, height: 40 }),
      add(ids.item, ids.legend, 'Legendeneintrag', 'interactive', { x: 24, y: 304, width: 90, height: 30 }),
      add(ids.header, ids.stats, 'Kartenkopf', 'component', { x: 10, y: 10, width: 580, height: 36 }),
      set(ids.stats, 'general', 'description', 'Karte mit Kopf und Inhalt'),
      set(
        ids.item,
        'interaction',
        'click',
        'Klick blendet die Datenreihe aus.\nErneuter Klick blendet sie wieder ein.\n\n- Zustand bleibt beim Neuladen erhalten',
        'user',
        'Mit dem Produktteam abgestimmt',
      ),
      set(ids.item, 'acceptance', 'expectedBehavior', 'Ausgeblendete Reihe ist durchgestrichen'),
      {
        op: 'updateDraft',
        goal: 'Karte gemäß Screenshot umsetzen.\nBestehende Komponenten wiederverwenden.',
      },
    ],
    { language: 'de', acknowledge: 'all' },
  );

describe('prompt and specification generator (snapshots)', () => {
  const cases: [string, () => SpecSnapshot][] = [
    ['complete.en', () => complete('en')],
    ['complete.de', () => complete('de')],
    ['incomplete.en', incomplete],
    ['contradictory.de', contradictory],
    ['nested.de', nested],
  ];
  for (const [name, build] of cases) {
    it(`renders the ${name} prompt`, async () => {
      await expect(generatePrompt(build(), refs)).toMatchFileSnapshot(`__snapshots__/prompt.${name}.md`);
    });
    it(`renders the ${name} specification`, async () => {
      await expect(renderSpecificationMarkdown(build(), refs)).toMatchFileSnapshot(
        `__snapshots__/specification.${name}.md`,
      );
    });
  }
});

describe('revision prompt (snapshots)', () => {
  for (const language of ['en', 'de'] as const) {
    it(`lists the changes to the predecessor (${language})`, async () => {
      await expect(generatePrompt(revised(language), refsV2, complete(language))).toMatchFileSnapshot(
        `__snapshots__/prompt.revision.${language}.md`,
      );
    });
  }

  it('says so when nothing changed and stays without the section for a first version', () => {
    const prompt = generatePrompt(complete(), refsV2, complete());
    expect(prompt).toContain('## Changes compared to V1');
    expect(prompt).toContain('_No specified differences to V1._');
    expect(generatePrompt(complete(), refs, complete())).not.toContain('## Changes compared to');
  });

  it('lists confirmed values with unchanged text in one line, real changes before/after', () => {
    const build = (origin: 'auto_detected' | 'user', size: string) =>
      make([
        add(ids.header, null, 'Header', 'container', { x: 0, y: 0, width: 1440, height: 80 }),
        set(ids.header, 'visual', 'colors', '#2457d6', origin),
        set(ids.header, 'visual', 'sizes', size, origin),
        set(ids.header, 'acceptance', 'expectedLayout', 'Full width'),
      ]);
    const prompt = generatePrompt(build('user', '80 px high'), refsV2, build('auto_detected', '72 px high'));
    expect(prompt).toContain(
      '  - Confirmed with unchanged text (only auto-detected in V1, now a requirement): Visual properties › Colours',
    );
    expect(prompt).not.toContain('#2457d6\n    - _after_');
    expect(prompt).toContain('  - **Visual properties › Sizes**');
    expect(prompt).toContain('80 px high');
  });

  it('assumes the predecessor implemented only if it was delivered to an agent', () => {
    const delivered = generatePrompt(revised('de'), refsV2, complete('de'));
    const undelivered = generatePrompt(revised('de'), refsV2, complete('de'), {
      predecessorDelivered: false,
    });
    expect(delivered).toContain('V1 gilt als umgesetzt.');
    expect(undelivered).not.toContain('V1 gilt als umgesetzt.');
    expect(undelivered).toContain('V1 wurde nie als an einen Agenten ausgeliefert vermerkt');
    expect(generatePrompt(revised('en'), refsV2, complete('en'), { predecessorDelivered: false })).toContain(
      'V1 was never recorded as delivered to an agent',
    );
  });
});

describe('compareVersions', () => {
  it('classifies components and finds field, geometry, relation and global changes', () => {
    const diff = compareVersions(complete(), revised());
    const status = Object.fromEntries(diff.components.map((component) => [component.name, component.status]));
    expect(status).toEqual({
      Header: 'changed',
      MainNavigation: 'changed',
      SearchField: 'added',
      RevenueCard: 'changed',
      Logo: 'removed',
    });
    expect(diff.counts).toEqual({ added: 1, removed: 1, changed: 3, unchanged: 0 });
    const nav = diff.components.find((component) => component.componentId === ids.nav);
    expect(nav?.fields).toEqual([
      {
        field: 'interaction.hover',
        before: { value: 'Underline the hovered link', origin: 'user' },
        after: null,
      },
    ]);
    const header = diff.components.find((component) => component.componentId === ids.header);
    expect(header?.geometry).toEqual([
      {
        deviceCategory: 'desktop',
        before: { x: 0, y: 0, width: 1440, height: 80 },
        after: { x: 0, y: 0, width: 1440, height: 96 },
        moved: true,
        resized: true,
      },
    ]);
    expect(header?.fields.map((change) => change.field)).toEqual(['layout.positioning']);
    expect(diff.components.find((component) => component.componentId === ids.stats)?.rename).toEqual({
      before: 'StatisticsCard',
      after: 'RevenueCard',
    });
    expect(diff.relations.added.map((relation) => relation.id)).toEqual([fid('rel', 'R2')]);
    expect(diff.relations.changed).toHaveLength(1);
    expect(diff.acceptance).toEqual({ added: ['Search answers in under 300 ms'], removed: [] });
    expect(diff.goal).toBeUndefined();
  });

  it('ignores sub-pixel geometry noise and screenshot changes, compares across sizes', () => {
    const wide = screenshot(fid('scr', 'WIDE'), 3, { width: 2880, height: 1800 });
    const a = make([add(ids.header, null, 'Header', 'container', { x: 10, y: 10, width: 200, height: 50 })]);
    const same = make(
      [add(ids.header, null, 'Header', 'container', { x: 20, y: 21, width: 400, height: 100 }, wide.id)],
      { screenshots: [wide] },
    );
    expect(compareVersions(a, same).components[0]?.status).toBe('unchanged');
    const moved = make(
      [add(ids.header, null, 'Header', 'container', { x: 40, y: 20, width: 400, height: 100 }, wide.id)],
      { screenshots: [wide] },
    );
    expect(compareVersions(a, moved).components[0]?.geometry).toMatchObject([
      { moved: true, resized: false },
    ]);
  });

  it('reports a reorder only relative to siblings present in both versions', () => {
    const a = make([
      add(ids.header, null, 'A', 'component'),
      add(ids.nav, null, 'B', 'component'),
      add(ids.stats, null, 'C', 'component'),
    ]);
    const removedFirst = make([add(ids.nav, null, 'B', 'component'), add(ids.stats, null, 'C', 'component')]);
    expect(compareVersions(a, removedFirst).counts).toMatchObject({ removed: 1, unchanged: 2 });
    const swapped = make([
      add(ids.header, null, 'A', 'component'),
      add(ids.stats, null, 'C', 'component'),
      add(ids.nav, null, 'B', 'component'),
    ]);
    expect(
      compareVersions(a, swapped)
        .components.filter((component) => component.reordered === true)
        .map((component) => component.name),
    ).toEqual(['C', 'B']);
  });
});

describe('prompt generator rules', () => {
  it('is deterministic', () => {
    expect(generatePrompt(complete(), refs)).toBe(generatePrompt(complete(), refs));
    expect(canonicalJson(complete())).toBe(canonicalJson(complete()));
  });

  it('contains the required sections in order', () => {
    const headings = generatePrompt(complete(), refs)
      .split('\n')
      .filter((line) => line.startsWith('## '));
    expect(headings).toEqual([
      '## References',
      '## Project context',
      '## Implementation goal',
      '## Reference screenshots',
      '## Component tree',
      '## Component descriptions',
      '## Visual description',
      '## Layout rules',
      '## Functional requirements',
      '## Interaction states',
      '## Responsive behaviour',
      '## Relations between components',
      '## Acceptance criteria',
      '## Open questions and limitations',
    ]);
  });

  it('references UI-ID, path, version, revision and screenshot', () => {
    const prompt = generatePrompt(complete(), refs);
    for (const text of [
      '`ui-dashboard`',
      '`/dashboard`',
      `V1 (\`${refs.uiVersionId}\`)`,
      refs.specRevisionId,
      DESKTOP,
    ]) {
      expect(prompt).toContain(text);
    }
  });

  it('never presents unconfirmed or missing values as requirements', () => {
    const prompt = generatePrompt(incomplete(), refs);
    expect(prompt).toContain('_(auto-detected, NOT confirmed – not a requirement)_: #2457d6');
    expect(prompt).toContain('Implementation goal\n\n_not specified_');
    expect(prompt).toContain('_Not specified for:_ Header, StatisticsCard');
    expect(prompt).toContain('- Which currency?');
  });

  it('copies user text verbatim, also in the German frame', () => {
    const prompt = generatePrompt(nested(), refs);
    expect(prompt).toContain(
      '  > Klick blendet die Datenreihe aus.\n  > Erneuter Klick blendet sie wieder ein.\n  >\n  > - Zustand bleibt beim Neuladen erhalten\n  - _Hinweis:_ Mit dem Produktteam abgestimmt',
    );
    expect(prompt).toContain('# Implementierungsprompt: Dashboard (ui-dashboard)');
  });
});

describe('snapshot', () => {
  it('drops editor-only state and sorts acknowledgements', () => {
    const snapshot = complete();
    expect(snapshot.components[0]).not.toHaveProperty('hidden');
    expect(snapshot.primaryScreenshotId).toBe(DESKTOP);
    expect(snapshot.screenshots.map((shot) => shot.id)).toEqual([DESKTOP, MOBILE]);
  });

  it('component content ignores hierarchy, so moving a component keeps its revision', () => {
    const before = complete().components.find((component) => component.componentId === ids.logo);
    const moved = make([
      add(ids.header, null, 'Header', 'container', { x: 0, y: 0, width: 1440, height: 80 }),
      add(ids.logo, null, 'Logo', 'visual_area', { x: 24, y: 16, width: 140, height: 48 }),
      set(ids.logo, 'general', 'description', 'Shop logo, links to the start page'),
      set(ids.logo, 'acceptance', 'expectedBehavior', 'Click opens /'),
    ]).components.find((component) => component.componentId === ids.logo);
    expect(before && moved && canonicalJson(componentContent(moved))).toBe(
      before && canonicalJson(componentContent(before)),
    );
  });

  it('builds the machine-readable specification with references', () => {
    const document = buildSpecificationDocument(complete(), refs, 'opsis-prompt/1.0.0');
    expect(document.references).toMatchObject({
      uiId: 'ui-dashboard',
      uiPath: '/dashboard',
      versionNo: 1,
      revisionNo: 1,
      screenshotIds: [DESKTOP, MOBILE],
    });
  });
});

describe('canonicalJson', () => {
  it('sorts keys recursively and normalizes numbers', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { y: -0, x: 1.5 }], c: null }, u: undefined })).toBe(
      '{"a":{"c":null,"d":[3,{"x":1.5,"y":0}]},"b":1}',
    );
  });

  it('rejects values JSON cannot represent', () => {
    expect(() => canonicalJson({ a: Number.NaN })).toThrow();
    expect(() => canonicalJson({ a: () => 1 })).toThrow();
  });
});
