/**
 * Human-readable specification (Markdown export, requirements §12). Organized per
 * component with all inspector groups, followed by relations, contradictions, global
 * acceptance criteria, completeness and open questions.
 */
import { SPEC_GROUP_NAMES } from '../vocabulary.js';
import { LABELS } from './labels.js';
import {
  componentLabel,
  componentTree,
  document,
  fieldLabel,
  fieldsOf,
  GENERATOR_VERSION,
  issueText,
  item,
  quoted,
  listOrNone,
  referenceLines,
  regionText,
  relationLines,
  screenshotLines,
  specLine,
  trimBlank,
  valueAt,
} from './render.js';
import type { ReleaseReferences, SpecSnapshot } from './snapshot.js';

export const renderSpecificationMarkdown = (snapshot: SpecSnapshot, refs: ReleaseReferences): string => {
  const labels = LABELS[snapshot.project.promptLanguage];
  const t = labels.text;
  const nameOf = (id: string | null): string =>
    id === null
      ? t.root
      : (snapshot.components.find((component) => component.componentId === id)?.name ?? id);

  const overview = [`## ${t.overview}`, '', `**${t.goal}:**`, '', quoted(labels, snapshot.goal)];
  if (snapshot.changeSummary.trim() !== '') {
    overview.push('', `**${t.changeSummary}:**`, '', quoted(labels, snapshot.changeSummary));
  }
  overview.push('', `**${t.projectContext}:**`, '', quoted(labels, snapshot.project.description));
  if (snapshot.uiView.description.trim() !== '') {
    overview.push('', `**${t.uiDescription}:**`, '', quoted(labels, snapshot.uiView.description));
  }

  const components: string[] = [`## ${t.components}`, ''];
  if (snapshot.components.length === 0) components.push(t.noComponents);
  for (const component of snapshot.components) {
    components.push(
      `### ${componentLabel(component)}`,
      '',
      `- **${t.kind}:** ${labels.kinds[component.kind]}`,
      `- **${t.parent}:** ${nameOf(component.parentId)}`,
      `- **${t.regionLabel}:** ${regionText(labels, component, snapshot)}`,
      '',
    );
    for (const group of SPEC_GROUP_NAMES) {
      const fields = fieldsOf(group);
      components.push(`#### ${labels.groups[group]}`, '');
      const missing: string[] = [];
      for (const ref of fields) {
        const value = valueAt(component, ref);
        if (value) components.push(...specLine(labels, ref, value));
        else missing.push(fieldLabel(labels, ref));
      }
      if (missing.length > 0) components.push(`- _${t.unspecifiedFields}:_ ${missing.join(', ')}`);
      components.push('');
    }
  }

  const acknowledged = new Set(snapshot.acknowledgedWarnings);
  const report = snapshot.completeness;
  const completeness = [
    `## ${t.completeness}`,
    '',
    t.completenessCounts({
      components: report.counts.components,
      specified: report.counts.specifiedFields,
      total: report.counts.totalFields,
    }),
    '',
    ...(report.blocking.length === 0
      ? [t.blockingNone]
      : report.blocking.map((issue) => item(issueText(labels, snapshot, issue)))),
    '',
    `### ${t.acknowledgedWarnings}`,
    '',
    ...listOrNone(
      labels,
      report.warnings
        .filter((warning) => acknowledged.has(warning.id))
        .map((warning) => issueText(labels, snapshot, warning)),
    ),
  ];

  return document([
    [`# ${t.specTitle({ name: snapshot.uiView.name, uiId: snapshot.uiView.uiId })}`],
    [`## ${t.references}`, '', ...referenceLines(labels, snapshot, refs, GENERATOR_VERSION)],
    overview,
    [`## ${t.screenshots}`, '', ...screenshotLines(labels, snapshot)],
    [`## ${t.componentTree}`, '', ...componentTree(labels, snapshot)],
    trimBlank(components),
    [`## ${t.relations}`, '', ...relationLines(labels, snapshot)],
    [
      `## ${t.conflicts}`,
      '',
      ...listOrNone(
        labels,
        snapshot.conflicts.map((conflict) => {
          const involved = conflict.componentIds.map((id) => nameOf(id)).join(', ');
          const head = `${conflict.description}${involved === '' ? '' : ` (${involved})`}`;
          return conflict.status === 'resolved' ? `${head}\n${t.resolution}: ${conflict.resolution}` : head;
        }),
      ),
    ],
    [`## ${t.globalAcceptanceHeading}`, '', ...listOrNone(labels, snapshot.acceptance)],
    completeness,
    [`## ${t.openQuestions}`, '', ...listOrNone(labels, snapshot.openQuestions)],
  ]);
};
