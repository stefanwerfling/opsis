/**
 * "Changes compared to V(n)" for the prompt of a revision (architecture 05 §3): new,
 * changed (field by field, before → after), removed and unchanged components, plus
 * relations and the global parts. User texts stay verbatim.
 *
 * A value whose text stayed the same but which the human confirmed (auto_detected → user /
 * screenshot_derived) is listed in one line per component instead of before/after: it is a
 * real change (it becomes a requirement), but repeating the text twice only adds noise.
 */
import type { SpecValue } from '../draft.js';
import type { ComponentDiff, FieldChange, ListDiff, VersionDiff } from '../diff.js';
import type { Labels } from './labels.js';
import { componentLabel, fieldLabel, item, relationLine, verbatim, type FieldRef } from './render.js';
import type { SpecSnapshot, VersionRef } from './snapshot.js';

/** `- _label_ _(origin)_: value` – the origin before the value, so it never reads as user text. */
const valueLine = (labels: Labels, label: string, value: SpecValue | null): string =>
  value === null
    ? `    - _${label}:_ _${labels.notSpecified}_`
    : `    - _${label}_ _(${labels.origins[value.origin]})_:${verbatim(value.value, '      ')}`;

/** Same text, only confirmed by the human. */
const isConfirmation = (change: FieldChange): boolean =>
  change.before !== null &&
  change.after !== null &&
  change.before.origin === 'auto_detected' &&
  change.after.origin !== 'auto_detected' &&
  change.before.value === change.after.value;

const fieldTitle = (labels: Labels, field: string): string => {
  const ref = field.split('.') as unknown as FieldRef;
  return `${labels.groups[ref[0]]} › ${fieldLabel(labels, ref)}`;
};

const componentChanges = (
  labels: Labels,
  predecessor: VersionRef,
  previous: SpecSnapshot,
  snapshot: SpecSnapshot,
  diff: ComponentDiff,
): string[] => {
  const t = labels.text;
  const parentName = (snap: SpecSnapshot, id: string | null): string =>
    id === null ? t.root : (snap.components.find((component) => component.componentId === id)?.name ?? id);
  const lines = [`- **${diff.name}** (\`${diff.componentId}\`)`];
  if (diff.rename) lines.push(`  - ${t.renamed({ ...diff.rename })}`);
  if (diff.kind) {
    lines.push(
      `  - ${t.kindChanged({ before: labels.kinds[diff.kind.before], after: labels.kinds[diff.kind.after] })}`,
    );
  }
  if (diff.parent) {
    lines.push(
      `  - ${t.parentChanged({
        before: parentName(previous, diff.parent.before),
        after: parentName(snapshot, diff.parent.after),
      })}`,
    );
  }
  if (diff.reordered === true) lines.push(`  - ${t.reordered}`);
  for (const change of diff.geometry) {
    const what = [change.moved && t.moved, change.resized && t.resized].filter(Boolean).join(', ');
    lines.push(
      `  - ${t.regionChanged({
        device: labels.devices[change.deviceCategory],
        what,
        bx: change.before.x,
        by: change.before.y,
        bw: change.before.width,
        bh: change.before.height,
        ax: change.after.x,
        ay: change.after.y,
        aw: change.after.width,
        ah: change.after.height,
      })}`,
    );
  }
  const confirmed = diff.fields.filter(isConfirmation);
  if (confirmed.length > 0) {
    lines.push(
      `  - ${t.confirmedFields({
        versionNo: predecessor.versionNo,
        fields: confirmed.map((change) => fieldTitle(labels, change.field)).join(', '),
      })}`,
    );
  }
  for (const change of diff.fields) {
    if (isConfirmation(change)) continue;
    lines.push(
      `  - **${fieldTitle(labels, change.field)}**`,
      valueLine(labels, t.before, change.before),
      valueLine(labels, t.after, change.after),
    );
  }
  return lines;
};

const listChanges = (title: string, entries: readonly string[]): string[] =>
  entries.length === 0 ? [] : ['', `**${title}:**`, '', ...entries.map((entry) => item(entry))];

const globalChanges = (labels: Labels, diff: VersionDiff): string[] => {
  const t = labels.text;
  const lines: string[] = [];
  if (diff.goal) {
    lines.push(
      '',
      `**${t.goalChanged}:**`,
      '',
      `- _${t.before}:_${diff.goal.before.trim() === '' ? ` _${labels.notSpecified}_` : verbatim(diff.goal.before, '  ')}`,
      `- _${t.after}:_${diff.goal.after.trim() === '' ? ` _${labels.notSpecified}_` : verbatim(diff.goal.after, '  ')}`,
    );
  }
  const lists: [string, ListDiff['added']][] = [
    [t.acceptanceAdded, diff.acceptance.added],
    [t.acceptanceRemoved, diff.acceptance.removed],
    [t.questionsAdded, diff.openQuestions.added],
    [t.questionsRemoved, diff.openQuestions.removed],
  ];
  for (const [title, entries] of lists) lines.push(...listChanges(title, entries));
  return lines;
};

export const changesSection = (
  labels: Labels,
  previous: SpecSnapshot,
  snapshot: SpecSnapshot,
  predecessor: VersionRef,
  diff: VersionDiff,
  /** Whether the predecessor's prompt ever reached an agent (only then is it assumed implemented). */
  predecessorDelivered = true,
): string[] => {
  const t = labels.text;
  const byStatus = (status: ComponentDiff['status']) =>
    diff.components.filter((component) => component.status === status);
  const added = byStatus('added');
  const changed = byStatus('changed');
  const removed = byStatus('removed');
  const unchanged = byStatus('unchanged');
  const relations = diff.relations;
  const globals = globalChanges(labels, diff);

  const intro = predecessorDelivered ? t.changesIntro : t.changesIntroUndelivered;
  const lines = [`## ${t.changesTitle({ ...predecessor })}`, '', intro({ ...predecessor })];
  const nothing =
    added.length + changed.length + removed.length === 0 &&
    relations.added.length + relations.removed.length + relations.changed.length === 0 &&
    globals.length === 0;
  if (nothing) return [...lines, '', `_${t.noDifferences({ ...predecessor })}_`];

  const section = (title: string, body: string[]): void => {
    if (body.length > 0) lines.push('', `### ${title}`, '', ...body);
  };
  section(
    t.addedComponents,
    added.map((component) => `- ${componentLabel(component)} – ${t.seeBelow}`),
  );
  section(
    t.changedComponents,
    changed.flatMap((component) => componentChanges(labels, predecessor, previous, snapshot, component)),
  );
  section(
    t.removedComponents,
    removed.map((component) => `- ${componentLabel(component)}`),
  );
  const both = [snapshot, previous];
  section(
    t.relationsAdded,
    relations.added.map((relation) => relationLine(labels, both, relation)),
  );
  section(
    t.relationsRemoved,
    relations.removed.map((relation) => relationLine(labels, both, relation)),
  );
  section(
    t.relationsChanged,
    relations.changed.flatMap(({ before, after }) => [
      `- _${t.before}:_ ${relationLine(labels, both, before).slice(2)}`,
      `- _${t.after}:_ ${relationLine(labels, both, after).slice(2)}`,
    ]),
  );
  if (globals.length > 0) lines.push(...globals);
  section(
    t.unchangedComponents,
    unchanged.map((component) => `- ${componentLabel(component)}`),
  );
  return lines;
};
