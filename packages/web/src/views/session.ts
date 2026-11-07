import type { Screenshot, SessionDetails } from '@opsis/core';
import { api } from '../api.js';
import { uiViewLink } from '../components/lists.js';
import { ScreenshotViewer } from '../components/viewer.js';
import { formValue, h, replaceChildren, type Child } from '../dom.js';
import { t } from '../i18n/i18n.js';
import { pathTo } from '../router.js';
import {
  Disposer,
  errorBox,
  formError,
  formatDateTime,
  handleSubmit,
  liveSection,
  statusBadge,
  type View,
} from '../ui.js';
import { screenshotLabel } from './ui-view.js';

const TERMINAL = new Set(['delivered', 'cancelled', 'failed']);

/** Runs a session action from a button; errors are shown next to the actions. */
const actionButton = (
  label: string,
  output: HTMLElement,
  action: () => Promise<unknown>,
  onDone: () => void,
) => {
  const button = h(
    'button',
    {
      attrs: { type: 'button' },
      onClick: () => {
        button.disabled = true;
        replaceChildren(output);
        action()
          .then(onDone)
          .catch((error: unknown) => {
            replaceChildren(output, errorBox(error));
          })
          .finally(() => {
            button.disabled = false;
          });
      },
    },
    label,
  );
  return button;
};

const infoBlock = (details: SessionDetails, reload: () => void): Child[] => {
  const { session, uiView, statusHistory, concurrentSessionIds } = details;
  const actionOutput = h('div');
  const actions: HTMLElement[] = [];

  if (session.status === 'awaiting_review') {
    actions.push(
      actionButton(t('session.startReview'), actionOutput, () => api.startReview(session.id), reload),
    );
  }
  if (!TERMINAL.has(session.status)) {
    const cancelForm = h(
      'form',
      { class: 'row' },
      h('input', {
        attrs: {
          name: 'reason',
          maxlength: 2000,
          placeholder: t('session.cancelReason'),
          'aria-label': t('session.cancelReason'),
        },
      }),
      h('button', { class: 'danger', attrs: { type: 'submit' } }, t('session.cancel')),
      formError(),
    );
    cancelForm.addEventListener(
      'submit',
      handleSubmit(cancelForm, async () => {
        await api.cancelSession(session.id, formValue(cancelForm, 'reason'));
        reload();
      }),
    );
    actions.push(h('details', {}, h('summary', {}, t('session.cancel')), cancelForm));
  }

  const assignmentBox =
    session.assignment === 'needs_confirmation' &&
    h(
      'div',
      { class: 'notice warning' },
      h('strong', {}, t('session.needsConfirmation')),
      session.assignmentNote !== null && h('p', {}, session.assignmentNote),
      session.proposedPath !== null && h('p', {}, t('session.proposedPath', { path: session.proposedPath })),
      h(
        'div',
        { class: 'row' },
        session.proposedPath === null
          ? actionButton(
              t('session.confirmAssignment'),
              actionOutput,
              () => api.confirmAssignment(session.id, false),
              reload,
            )
          : [
              actionButton(
                t('session.acceptPath'),
                actionOutput,
                () => api.confirmAssignment(session.id, true),
                reload,
              ),
              actionButton(
                t('session.keepPath'),
                actionOutput,
                () => api.confirmAssignment(session.id, false),
                reload,
              ),
            ],
      ),
    );

  return [
    h('h1', {}, session.title || t('session.title'), ' ', statusBadge(session.status)),
    concurrentSessionIds.length > 0 &&
      h('p', { class: 'notice' }, t('session.concurrent', { count: concurrentSessionIds.length })),
    assignmentBox,
    h(
      'dl',
      { class: 'facts' },
      h('dt', {}, t('ui.uiId')),
      h('dd', {}, uiViewLink(uiView), ' ', h('code', {}, uiView.path)),
      h('dt', {}, t('session.intent')),
      h('dd', {}, t(`intent.${session.intent}`)),
      h('dt', {}, t('session.assignment')),
      h('dd', {}, t(`assignment.${session.assignment}`)),
      h('dt', {}, t('session.agent')),
      h(
        'dd',
        {},
        session.agentId ?? t('session.submittedByHuman'),
        session.agentSessionRef !== null && ` (${session.agentSessionRef})`,
      ),
      h('dt', {}, t('session.created')),
      h('dd', {}, formatDateTime(session.createdAt)),
    ),
    h('div', { class: 'row' }, actions),
    actionOutput,
    h('h2', {}, t('session.history')),
    h(
      'ol',
      { class: 'history' },
      statusHistory.map((event) =>
        h(
          'li',
          {},
          formatDateTime(event.at),
          ' · ',
          event.fromStatus === null ? '' : [t(`status.${event.fromStatus}`), ' → '],
          h('strong', {}, t(`status.${event.toStatus}`)),
          ' · ',
          h('span', { class: 'muted' }, event.actor),
          event.note !== null && event.note !== '' && ` · ${event.note}`,
        ),
      ),
    ),
  ];
};

export const sessionView: View = (root, params) => {
  const sessionId = params['sessionId'] ?? '';
  const disposer = new Disposer();
  const viewer = disposer.add(new ScreenshotViewer());
  const strip = h('div', { class: 'strip', attrs: { role: 'tablist' } });
  const breadcrumb = h('nav', { class: 'breadcrumb' }, h('a', { attrs: { href: '/' } }, t('projects.title')));

  let shownIds = '';
  let selectedId: string | null = null;

  const select = (screenshot: Screenshot): void => {
    selectedId = screenshot.id;
    for (const tab of strip.querySelectorAll<HTMLButtonElement>('button')) {
      tab.setAttribute('aria-selected', String(tab.dataset['id'] === screenshot.id));
    }
    void viewer.show({
      url: api.screenshotImageUrl(screenshot.id),
      width: screenshot.width,
      height: screenshot.height,
    });
  };

  /** Rebuilds the screenshot tabs only when the set of screenshots changed (keeps zoom/pan). */
  const updateScreenshots = (screenshots: readonly Screenshot[]): void => {
    const ids = screenshots.map((screenshot) => screenshot.id).join(',');
    if (ids === shownIds) return;
    shownIds = ids;
    replaceChildren(
      strip,
      screenshots.map((screenshot) =>
        h(
          'button',
          {
            attrs: { type: 'button', role: 'tab' },
            dataset: { id: screenshot.id },
            onClick: () => {
              select(screenshot);
            },
          },
          screenshotLabel(screenshot),
          screenshot.variantLabel !== null && ` · ${screenshot.variantLabel}`,
        ),
      ),
    );
    const next = screenshots.find((screenshot) => screenshot.id === selectedId) ?? screenshots.at(-1);
    if (next !== undefined) select(next);
  };

  const info = disposer.add(
    liveSection<SessionDetails>({
      load: () => api.getSession(sessionId),
      relevant: (event) =>
        ('sessionId' in event && event.sessionId === sessionId) || event.type === 'UiViewChanged',
      render: (details) =>
        infoBlock(details, () => {
          info.reload();
        }),
      onData: (details) => {
        replaceChildren(
          breadcrumb,
          h('a', { attrs: { href: '/' } }, t('projects.title')),
          ' / ',
          h('a', { attrs: { href: pathTo('projects', details.session.projectId) } }, t('project.sessions')),
        );
        updateScreenshots(details.screenshots);
      },
    }),
  );

  root.append(
    breadcrumb,
    h(
      'div',
      { class: 'session-layout' },
      h('aside', { class: 'stack' }, info.element),
      h(
        'section',
        { class: 'stack session-main' },
        strip,
        viewer.element,
        h('p', { class: 'muted' }, t('session.editorPending')),
      ),
    ),
  );
  return disposer.dispose;
};
