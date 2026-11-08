/**
 * Markdown building blocks shared by the specification and prompt generators. Everything
 * is deterministic: same snapshot + references → byte-identical output.
 */
import type { CompletenessIssue } from '../completeness.js';
import type { SpecValue } from '../draft.js';
import { SPEC_GROUPS, type SpecGroup } from '../vocabulary.js';
import type { Labels } from './labels.js';
import type { ReleaseReferences, SnapshotComponent, SpecSnapshot } from './snapshot.js';

/** Bumped whenever the generated wording or structure changes (stored with every prompt). */
export const GENERATOR_VERSION = 'opsis-prompt/1.0.0';

export type FieldRef = readonly [SpecGroup, string];

export const fieldsOf = (group: SpecGroup, except: readonly string[] = []): FieldRef[] =>
  SPEC_GROUPS[group].filter((field) => !except.includes(field)).map((field) => [group, field] as const);

export const fieldLabel = (labels: Labels, [group, field]: FieldRef): string =>
  (labels.fields[group] as Readonly<Record<string, string>>)[field] ?? field;

export const valueAt = (component: SnapshotComponent, [group, field]: FieldRef): SpecValue | undefined =>
  (component.spec[group] as Readonly<Record<string, SpecValue>> | undefined)?.[field];

/**
 * User text, verbatim. Multi-line text becomes an indented quote block below the list
 * item, so lists or headings inside the user's text cannot merge with the generated
 * structure around it.
 */
const verbatim = (text: string, indent: string): string => {
  const lines = text.replace(/\r\n?/g, '\n').trimEnd().split('\n');
  return lines.length === 1
    ? ` ${lines[0] ?? ''}`
    : `\n${lines.map((line) => (line === '' ? `${indent}>` : `${indent}> ${line}`)).join('\n')}`;
};

/** A free user text block as a top-level quote; empty text is reported as not specified. */
export const quoted = (labels: Labels, text: string): string => {
  const lines = text.replace(/\r\n?/g, '\n').trimEnd().split('\n');
  return text.trim() === ''
    ? `_${labels.notSpecified}_`
    : lines.map((line) => (line === '' ? '>' : `> ${line}`)).join('\n');
};

/** `- text` list item whose text is user content: first line inline, the rest indented below. */
export const item = (text: string, indent = ''): string => {
  const [first = '', ...rest] = text.replace(/\r\n?/g, '\n').trimEnd().split('\n');
  return [`${indent}- ${first}`, ...rest.map((line) => `${indent}  ${line}`)].join('\n');
};

export const componentLabel = (component: Pick<SnapshotComponent, 'name' | 'componentId'>): string =>
  `${component.name} (\`${component.componentId}\`)`;

export const specLine = (labels: Labels, ref: FieldRef, value: SpecValue): string[] => {
  const lines = [
    `- **${fieldLabel(labels, ref)}** _(${labels.origins[value.origin]})_:${verbatim(value.value, '  ')}`,
  ];
  if (value.note !== undefined) lines.push(`  - _${labels.text.note}:_${verbatim(value.note, '    ')}`);
  return lines;
};

/** Regions in the order of the snapshot's screenshots (primary reference first). */
export const regionText = (labels: Labels, component: SnapshotComponent, snapshot: SpecSnapshot): string => {
  const order = snapshot.screenshots.map((screenshot) => screenshot.id);
  const regions = [...component.regions].sort(
    (a, b) => order.indexOf(a.screenshotId) - order.indexOf(b.screenshotId),
  );
  return regions.length === 0
    ? labels.text.noRegionOn({ screenshot: snapshot.primaryScreenshotId })
    : regions
        .map((region) =>
          labels.text.region({
            screenshot: region.screenshotId,
            x: region.x,
            y: region.y,
            width: region.width,
            height: region.height,
          }),
        )
        .join('; ');
};

/** Nested list of the semantic component tree. */
export const componentTree = (labels: Labels, snapshot: SpecSnapshot): string[] => {
  if (snapshot.components.length === 0) return [labels.text.noComponents];
  const depth = new Map<string, number>();
  return snapshot.components.map((component) => {
    const level = component.parentId === null ? 0 : (depth.get(component.parentId) ?? 0) + 1;
    depth.set(component.componentId, level);
    return `${'  '.repeat(level)}- **${component.name}** (\`${component.componentId}\`) – ${labels.kinds[component.kind]} · ${regionText(labels, component, snapshot)}`;
  });
};

/**
 * One section of component fields. Components with values get their own sub-heading and
 * list the unspecified fields of this section explicitly; components without any value
 * are summarized in one "not specified for" line, so nothing silently disappears.
 */
export const fieldSection = (
  labels: Labels,
  snapshot: SpecSnapshot,
  fields: readonly FieldRef[],
  headingLevel: string,
): string[] => {
  if (snapshot.components.length === 0) return [labels.text.noComponents];
  const lines: string[] = [];
  const empty: string[] = [];
  for (const component of snapshot.components) {
    const specified = fields.filter((ref) => valueAt(component, ref) !== undefined);
    if (specified.length === 0) {
      empty.push(component.name);
      continue;
    }
    lines.push(`${headingLevel} ${componentLabel(component)}`, '');
    for (const ref of specified) {
      const value = valueAt(component, ref);
      if (value) lines.push(...specLine(labels, ref, value));
    }
    const missing = fields.filter((ref) => valueAt(component, ref) === undefined);
    if (missing.length > 0) {
      lines.push(
        `- _${labels.text.unspecifiedFields}:_ ${missing.map((ref) => fieldLabel(labels, ref)).join(', ')}`,
      );
    }
    lines.push('');
  }
  if (empty.length > 0) lines.push(`_${labels.text.unspecifiedFor}:_ ${empty.join(', ')}`, '');
  return trimBlank(lines);
};

export const issueText = (labels: Labels, snapshot: SpecSnapshot, issue: CompletenessIssue): string => {
  const parts: string[] = [];
  const component = snapshot.components.find((candidate) => candidate.componentId === issue.componentId);
  if (component) parts.push(componentLabel(component));
  if (issue.field !== undefined) {
    const [group, field] = issue.field.split('.') as [SpecGroup, string];
    parts.push(fieldLabel(labels, [group, field]));
  }
  if (issue.screenshotId !== undefined) parts.push(`\`${issue.screenshotId}\``);
  const conflict = snapshot.conflicts.find((candidate) => candidate.id === issue.conflictId);
  if (conflict) parts.push(conflict.description);
  const prefix = parts.length > 0 ? `${parts.join(' · ')}: ` : '';
  return `${prefix}${labels.issues[issue.code]}`;
};

export const referenceLines = (
  labels: Labels,
  snapshot: SpecSnapshot,
  refs: ReleaseReferences,
  generatorVersion: string,
): string[] => {
  const t = labels.text;
  const version = [
    `V${String(refs.versionNo)} (\`${refs.uiVersionId}\`)`,
    refs.predecessor === null ? t.firstVersion : t.predecessor({ ...refs.predecessor }),
  ];
  if (snapshot.baseVersion !== null && snapshot.baseVersion.id !== refs.predecessor?.id) {
    version.push(t.baseVersion({ ...snapshot.baseVersion }));
  }
  const lines = [
    `- **${t.project}:** ${snapshot.project.name} (\`${snapshot.project.id}\`)`,
    `- **${t.uiId}:** \`${snapshot.uiView.uiId}\``,
    `- **${t.uiPath}:** \`${snapshot.uiView.path}\``,
    `- **${t.uiVersion}:** ${version.join(' – ')}`,
    `- **${t.specRevision}:** ${String(refs.revisionNo)} (\`${refs.specRevisionId}\`)`,
    `- **${t.generator}:** \`${generatorVersion}\``,
    `- **${t.releasedLabel}:** ${t.released({ at: refs.releasedAt, by: refs.releasedBy })}`,
    `- **${t.session}:** \`${snapshot.session.id}\`${snapshot.session.title === '' ? '' : ` – ${snapshot.session.title}`}`,
  ];
  if (snapshot.session.agentSessionRef !== null) {
    lines.push(`- **${t.agentSession}:** ${snapshot.session.agentSessionRef}`);
  }
  if (refs.changeDescription.trim() !== '') {
    lines.push(`- **${t.changeDescription}:**${verbatim(refs.changeDescription, '  ')}`);
  }
  return lines;
};

export const screenshotLines = (labels: Labels, snapshot: SpecSnapshot): string[] => {
  const t = labels.text;
  const lines = snapshot.screenshots.map((screenshot) => {
    const facts = [
      t.pixels({ width: screenshot.width, height: screenshot.height }),
      labels.devices[screenshot.deviceCategory],
    ];
    if (screenshot.viewportWidth !== null && screenshot.viewportHeight !== null) {
      facts.push(t.viewport({ width: screenshot.viewportWidth, height: screenshot.viewportHeight }));
    }
    if (screenshot.variantLabel !== null) facts.push(`${t.variant} „${screenshot.variantLabel}“`);
    facts.push(screenshot.mimeType, `sha256 \`${screenshot.sha256}\``);
    const primary = screenshot.id === snapshot.primaryScreenshotId ? ` (${t.primary})` : '';
    const head = `- \`${screenshot.id}\`${primary} – ${facts.join(', ')}`;
    return screenshot.description.trim() === ''
      ? head
      : `${head}\n${screenshot.description
          .trimEnd()
          .split('\n')
          .map((line) => (line === '' ? '  >' : `  > ${line}`))
          .join('\n')}`;
  });
  return [...lines, '', t.coordinatesNote];
};

export const relationLines = (labels: Labels, snapshot: SpecSnapshot): string[] => {
  if (snapshot.relations.length === 0) return [`_${labels.none}_`];
  const name = (id: string): string =>
    snapshot.components.find((component) => component.componentId === id)?.name ?? id;
  return snapshot.relations.map((relation) => {
    const head = `**${name(relation.fromComponentId)}** ${labels.relations[relation.kind]} **${name(relation.toComponentId)}**`;
    return relation.description === '' ? `- ${head}` : item(`${head} – ${relation.description}`);
  });
};

export const listOrNone = (labels: Labels, items: readonly string[]): string[] =>
  items.length === 0 ? [`_${labels.none}_`] : items.map((text) => item(text));

export const trimBlank = (lines: string[]): string[] => {
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
};

/** Joins sections with one blank line between them and a final newline (user text untouched). */
export const document = (sections: readonly (readonly string[])[]): string =>
  `${sections
    .map((section) => section.join('\n'))
    .join('\n\n')
    .trimEnd()}\n`;
