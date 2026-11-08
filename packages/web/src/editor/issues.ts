import { findComponent, type CompletenessIssue, type Draft } from '@opsis/core/browser';
import { t, type MessageKey } from '../i18n/i18n.js';

/** "Header · Colours: Auto-detected value not confirmed" – component, field and problem. */
export const issueLabel = (issue: CompletenessIssue, draft: Draft, withComponent = true): string => {
  const parts: string[] = [];
  if (withComponent && issue.componentId !== undefined) {
    parts.push(findComponent(draft, issue.componentId)?.name ?? issue.componentId);
  }
  if (issue.field !== undefined) parts.push(t(`spec.${issue.field}` as MessageKey));
  const conflict = draft.conflicts.find((candidate) => candidate.id === issue.conflictId);
  if (conflict) parts.push(conflict.description);
  const text = t(`issue.${issue.code}`);
  return parts.length === 0 ? text : `${parts.join(' · ')}: ${text}`;
};
