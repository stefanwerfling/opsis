import type { Session, SessionStatus, UiView } from '@opsis/core';
import { h } from '../dom.js';
import { t } from '../i18n/i18n.js';
import { pathTo } from '../router.js';
import { formatDateTime, statusBadge } from '../ui.js';

export const OPEN_STATUSES: readonly SessionStatus[] = [
  'created',
  'uploading',
  'awaiting_review',
  'in_progress',
  'ready',
];

export const uiViewLink = (view: UiView): HTMLAnchorElement =>
  h('a', { attrs: { href: pathTo('projects', view.projectId, 'ui', view.uiId) } }, view.uiId);

export const uiViewTable = (views: readonly UiView[]): HTMLElement =>
  views.length === 0
    ? h('p', { class: 'muted' }, t('project.uiViewsEmpty'))
    : h(
        'table',
        {},
        h(
          'thead',
          {},
          h('tr', {}, h('th', {}, t('ui.uiId')), h('th', {}, t('ui.path')), h('th', {}, t('ui.name'))),
        ),
        h(
          'tbody',
          {},
          views.map((view) =>
            h(
              'tr',
              {},
              h('td', {}, uiViewLink(view)),
              h('td', {}, h('code', {}, view.path)),
              h('td', {}, view.name),
            ),
          ),
        ),
      );

export const sessionTable = (sessions: readonly Session[], views: readonly UiView[]): HTMLElement => {
  if (sessions.length === 0) return h('p', { class: 'muted' }, t('project.sessionsEmpty'));
  const byId = new Map(views.map((view) => [view.id, view]));
  return h(
    'table',
    {},
    h(
      'thead',
      {},
      h(
        'tr',
        {},
        h('th', {}, t('session.title')),
        h('th', {}, t('session.status')),
        h('th', {}, t('ui.uiId')),
        h('th', {}, t('session.created')),
      ),
    ),
    h(
      'tbody',
      {},
      sessions.map((session) => {
        const view = byId.get(session.uiViewId);
        return h(
          'tr',
          {},
          h(
            'td',
            {},
            h('a', { attrs: { href: pathTo('sessions', session.id) } }, session.title || session.id),
          ),
          h(
            'td',
            {},
            statusBadge(session.status),
            session.assignment === 'needs_confirmation' &&
              h('span', { class: 'badge warning' }, t('assignment.needs_confirmation')),
          ),
          h('td', {}, view ? uiViewLink(view) : t('common.none')),
          h('td', {}, formatDateTime(session.createdAt)),
        );
      }),
    ),
  );
};
