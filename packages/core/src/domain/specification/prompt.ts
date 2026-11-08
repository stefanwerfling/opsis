/**
 * Implementation prompt (requirements §10 "Prompt-Generierung"): self-contained Markdown
 * for a coding agent, in the project's prompt language. Sections follow the required
 * list: project context, goal, UI-ID/path, reference version, reference screenshot,
 * component tree, descriptions, layout rules, functional requirements, interaction
 * states, responsive behaviour, acceptance criteria, open questions and limitations.
 *
 * Revisions: with the snapshot of the predecessor version the prompt starts with the
 * differences to it (new / changed field by field / removed / unchanged, `compareVersions`).
 * The full specification follows, so the prompt stays self-contained. A predecessor that
 * never reached an agent is not assumed to be implemented (`PromptOptions`).
 */
import { compareVersions } from '../diff.js';
import { changesSection } from './changes.js';
import { LABELS } from './labels.js';
import {
  componentLabel,
  componentTree,
  document,
  fieldSection,
  fieldsOf,
  GENERATOR_VERSION,
  issueText,
  item,
  quoted,
  listOrNone,
  referenceLines,
  relationLines,
  screenshotLines,
  type FieldRef,
} from './render.js';
import type { ReleaseReferences, SpecSnapshot } from './snapshot.js';

export interface PromptOptions {
  /**
   * Whether the predecessor version was ever delivered to an agent. Only then does the change
   * section assume it is implemented; otherwise the differences are orientation only.
   * Default: true.
   */
  readonly predecessorDelivered?: boolean;
}

export const generatePrompt = (
  snapshot: SpecSnapshot,
  refs: ReleaseReferences,
  /** Snapshot of `refs.predecessor`; enables the change section of a revision. */
  previous?: SpecSnapshot,
  options: PromptOptions = {},
): string => {
  const labels = LABELS[snapshot.project.promptLanguage];
  const t = labels.text;

  const context = [
    `## ${t.projectContext}`,
    '',
    `**${snapshot.project.name}**`,
    '',
    quoted(labels, snapshot.project.description),
  ];
  if (snapshot.uiView.description.trim() !== '') {
    context.push('', `**${t.uiDescription}:**`, '', quoted(labels, snapshot.uiView.description));
  }

  const goal = [`## ${t.goal}`, '', quoted(labels, snapshot.goal)];
  if (snapshot.changeSummary.trim() !== '') {
    goal.push('', `**${t.changeSummary}:**`, '', quoted(labels, snapshot.changeSummary));
  }

  const responsiveFields: FieldRef[] = [
    ['visual', 'responsive'],
    ['acceptance', 'responsiveRequirements'],
  ];
  const responsive = [`## ${t.responsive}`, '', ...fieldSection(labels, snapshot, responsiveFields, '###')];
  if (snapshot.screenshots.length > 1) {
    responsive.push('', `### ${t.responsiveVariants}`, '');
    for (const component of snapshot.components) {
      responsive.push(
        `- ${componentLabel(component)}: ${snapshot.screenshots
          .map((screenshot) => {
            const region = component.regions.find((candidate) => candidate.screenshotId === screenshot.id);
            return region
              ? t.region({
                  screenshot: screenshot.id,
                  x: region.x,
                  y: region.y,
                  width: region.width,
                  height: region.height,
                })
              : t.noRegionOn({ screenshot: screenshot.id });
          })
          .join('; ')}`,
      );
    }
  }

  const acknowledged = new Set(snapshot.acknowledgedWarnings);
  const resolved = snapshot.conflicts.filter((conflict) => conflict.status === 'resolved');
  const openPoints = [
    `## ${t.openPoints}`,
    '',
    `### ${t.openQuestions}`,
    '',
    ...listOrNone(labels, snapshot.openQuestions),
    '',
    `### ${t.acknowledgedWarnings}`,
    '',
    ...listOrNone(
      labels,
      snapshot.completeness.warnings
        .filter((warning) => acknowledged.has(warning.id))
        .map((warning) => issueText(labels, snapshot, warning)),
    ),
  ];
  if (resolved.length > 0) {
    openPoints.push(
      '',
      `### ${t.resolvedConflicts}`,
      '',
      ...resolved.map((conflict) => {
        const involved = conflict.componentIds
          .map((id) => snapshot.components.find((component) => component.componentId === id)?.name ?? id)
          .join(', ');
        return item(
          `${conflict.description}${involved === '' ? '' : ` (${involved})`}\n${t.resolution}: ${conflict.resolution}`,
        );
      }),
    );
  }
  openPoints.push(
    '',
    t.unspecifiedSummary({
      specified: snapshot.completeness.counts.specifiedFields,
      total: snapshot.completeness.counts.totalFields,
    }),
  );

  return document([
    [`# ${t.promptTitle({ name: snapshot.uiView.name, uiId: snapshot.uiView.uiId })}`],
    t
      .promptIntro({ generator: GENERATOR_VERSION, revisionNo: refs.revisionNo, versionNo: refs.versionNo })
      .split('\n')
      .map((line) => `> ${line}`),
    [`## ${t.references}`, '', ...referenceLines(labels, snapshot, refs, GENERATOR_VERSION)],
    context,
    goal,
    ...(previous !== undefined && refs.predecessor !== null
      ? [
          changesSection(
            labels,
            previous,
            snapshot,
            refs.predecessor,
            compareVersions(previous, snapshot),
            options.predecessorDelivered ?? true,
          ),
        ]
      : []),
    [`## ${t.screenshots}`, '', ...screenshotLines(labels, snapshot)],
    [`## ${t.componentTree}`, '', ...componentTree(labels, snapshot)],
    [`## ${t.componentDescriptions}`, '', ...fieldSection(labels, snapshot, fieldsOf('general'), '###')],
    [`## ${t.visual}`, '', ...fieldSection(labels, snapshot, fieldsOf('visual', ['responsive']), '###')],
    [`## ${t.layout}`, '', ...fieldSection(labels, snapshot, fieldsOf('layout'), '###')],
    [`## ${t.functional}`, '', ...fieldSection(labels, snapshot, fieldsOf('functional'), '###')],
    [`## ${t.interaction}`, '', ...fieldSection(labels, snapshot, fieldsOf('interaction'), '###')],
    responsive,
    [`## ${t.relations}`, '', ...relationLines(labels, snapshot)],
    [
      `## ${t.acceptance}`,
      '',
      `### ${t.globalAcceptance}`,
      '',
      ...listOrNone(labels, snapshot.acceptance),
      '',
      `### ${t.componentAcceptance}`,
      '',
      ...fieldSection(labels, snapshot, fieldsOf('acceptance', ['responsiveRequirements']), '####'),
    ],
    openPoints,
  ]);
};
