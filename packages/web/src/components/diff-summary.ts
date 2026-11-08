import type { ComponentChangeStatus, VersionDiff } from '@opsis/core/browser';
import { h, type Child } from '../dom.js';
import { t } from '../i18n/i18n.js';

const SHOWN: readonly Exclude<ComponentChangeStatus, 'unchanged'>[] = ['added', 'changed', 'removed'];

/** Compact list of component changes (names per status) plus a note on other changes. */
export const diffSummary = (diff: VersionDiff): Child => {
  const rows = SHOWN.flatMap((status) => {
    const names = diff.components
      .filter((component) => component.status === status)
      .map((component) => component.name);
    return names.length === 0
      ? []
      : [
          h(
            'li',
            {},
            h('span', { class: `badge diff-${status}` }, t(`diff.${status}`)),
            ' ',
            names.join(', '),
          ),
        ];
  });
  const other =
    diff.relations.added.length + diff.relations.removed.length + diff.relations.changed.length > 0 ||
    diff.goal !== undefined ||
    diff.acceptance.added.length + diff.acceptance.removed.length > 0 ||
    diff.openQuestions.added.length + diff.openQuestions.removed.length > 0;
  return h(
    'div',
    { class: 'diff-summary' },
    rows.length === 0 ? h('p', { class: 'muted' }, t('diff.none')) : h('ul', {}, rows),
    other && h('p', { class: 'muted' }, t('diff.relationsAndGlobals')),
  );
};
