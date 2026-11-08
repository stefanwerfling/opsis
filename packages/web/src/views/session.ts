import type { Draft, Screenshot, SessionDetails } from '@opsis/core';
import { api } from '../api.js';
import { uiViewLink } from '../components/lists.js';
import { ScreenshotViewer } from '../components/viewer.js';
import { formValue, h, replaceChildren, type Child } from '../dom.js';
import { EditorCanvas } from '../editor/canvas.js';
import { Editor, type Tool } from '../editor/editor.js';
import { InspectorPanel } from '../editor/inspector.js';
import { ReleaseDialog } from '../editor/release.js';
import { DraftStore, type SaveState } from '../editor/store.js';
import { TreePanel } from '../editor/tree.js';
import { t } from '../i18n/i18n.js';
import { onLiveEvent } from '../live.js';
import { pathTo } from '../router.js';
import {
  Disposer,
  errorBox,
  errorMessage,
  formError,
  formatDateTime,
  handleSubmit,
  liveSection,
  statusBadge,
  type View,
} from '../ui.js';
import { screenshotLabel } from './ui-view.js';

const TERMINAL = new Set(['delivered', 'cancelled', 'failed']);
const EDITABLE = new Set(['awaiting_review', 'in_progress']);
const MESSAGE_TIMEOUT_MS = 8000;

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

/** Session header: status, actions, assignment confirmation, details and history. */
const sessionHeader = (
  details: SessionDetails,
  reload: () => void,
  saveIndicator: HTMLElement,
  onRelease: () => void,
): Child[] => {
  const { session, uiView, statusHistory, concurrentSessionIds } = details;
  const actionOutput = h('div');
  const actions: HTMLElement[] = [];

  if (session.status === 'in_progress') {
    actions.push(
      h('button', { class: 'primary', attrs: { type: 'button' }, onClick: onRelease }, t('release.open')),
    );
  }
  if (details.resultVersion !== null) {
    actions.push(
      h(
        'a',
        { class: 'button', attrs: { href: pathTo('versions', details.resultVersion.id) } },
        t('session.released', { version: details.resultVersion.versionNo }),
        ' · ',
        t('session.viewVersion'),
      ),
    );
  }
  if (session.status === 'ready') {
    const reopenForm = h(
      'form',
      { class: 'row' },
      h('input', {
        attrs: {
          name: 'reason',
          maxlength: 2000,
          placeholder: t('session.reopenReason'),
          'aria-label': t('session.reopenReason'),
        },
      }),
      h('button', { attrs: { type: 'submit' } }, t('session.reopen')),
      formError(),
    );
    reopenForm.addEventListener(
      'submit',
      handleSubmit(reopenForm, async () => {
        await api.reopenSession(session.id, formValue(reopenForm, 'reason'));
        reload();
      }),
    );
    actions.push(
      h('details', { class: 'inline-details' }, h('summary', {}, t('session.reopen')), reopenForm),
    );
  }

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
    actions.push(
      h('details', { class: 'inline-details' }, h('summary', {}, t('session.cancel')), cancelForm),
    );
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
    h(
      'div',
      { class: 'session-head' },
      h('h1', {}, session.title || t('session.title'), ' ', statusBadge(session.status)),
      saveIndicator,
      h('div', { class: 'row' }, actions),
    ),
    actionOutput,
    concurrentSessionIds.length > 0 &&
      h('p', { class: 'notice' }, t('session.concurrent', { count: concurrentSessionIds.length })),
    assignmentBox,
    h(
      'details',
      { class: 'session-details' },
      h('summary', {}, t('session.details')),
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
    ),
  ];
};

const SAVE_LABELS: Record<SaveState, Parameters<typeof t>[0]> = {
  saved: 'editor.saved',
  pending: 'editor.pending',
  saving: 'editor.saving',
  error: 'editor.saveError',
};

/** The three-panel component editor of one session. */
class EditorWorkspace {
  readonly element: HTMLElement;
  private readonly editor: Editor;
  private readonly store: DraftStore;
  private readonly viewer = new ScreenshotViewer();
  private readonly tree: TreePanel;
  private readonly inspector: InspectorPanel;
  private readonly release: ReleaseDialog;
  private readonly tabs = h('div', { class: 'strip', attrs: { role: 'tablist' } });
  private readonly toolButtons = new Map<Tool, HTMLButtonElement>();
  private readonly unsubscribe: () => void;
  private shownIds = '';

  constructor(
    sessionId: string,
    draft: Draft,
    screenshots: readonly Screenshot[],
    readOnly: boolean,
    private readonly saveIndicator: HTMLElement,
    private readonly messages: HTMLElement,
  ) {
    this.store = new DraftStore(
      api,
      sessionId,
      draft,
      { screenshots },
      {
        onChange: () => {
          this.editor.changed();
        },
        onSaveState: (state) => {
          this.showSaveState(state);
        },
        onDiscarded: (error) => {
          this.message(error);
        },
      },
    );
    this.editor = new Editor(this.store, readOnly);
    this.editor.onError = (error) => {
      this.message(error);
    };
    new EditorCanvas(this.editor, this.viewer);
    this.tree = new TreePanel(this.editor);
    this.inspector = new InspectorPanel(this.editor);
    this.release = new ReleaseDialog({
      api,
      editor: this.editor,
      saveAll: async () => {
        this.inspector.flushAll();
        await this.store.flush();
        return !this.store.hasUnsavedChanges;
      },
    });

    const tool = (value: Tool, label: string, title: string) => {
      const button = h(
        'button',
        {
          class: 'tool',
          attrs: { type: 'button', title, 'aria-label': title, disabled: readOnly && value !== 'select' },
          onClick: () => {
            this.editor.setTool(value);
            this.viewer.focus();
          },
        },
        label,
      );
      this.toolButtons.set(value, button);
      return button;
    };
    this.viewer.toolbar.prepend(
      tool('select', '⬚', t('editor.toolSelect')),
      tool('draw', '▭+', t('editor.toolDraw')),
      tool('relate', '→', t('editor.toolRelate')),
      h('span', { class: 'toolbar-sep' }),
    );
    this.viewer.toolbar.append(h('small', { class: 'muted viewer-help' }, t('editor.canvasHelp')));

    this.element = h(
      'div',
      { class: 'editor-layout' },
      this.tree.element,
      h('section', { class: 'editor-canvas' }, this.tabs, this.viewer.element),
      this.inspector.element,
    );
    this.unsubscribe = this.editor.subscribe(() => {
      this.syncView();
    });
    this.setScreenshots(screenshots);
    this.showSaveState('saved');
    if (readOnly) this.message(t('editor.readOnly'), 'info');
  }

  /** Called with fresh session details; adds new screenshots without resetting the view. */
  setScreenshots(screenshots: readonly Screenshot[]): void {
    this.store.setContext({ screenshots });
    const ids = screenshots.map((screenshot) => screenshot.id).join(',');
    if (ids === this.shownIds) return;
    this.shownIds = ids;
    replaceChildren(
      this.tabs,
      screenshots.map((screenshot) =>
        h(
          'button',
          {
            attrs: { type: 'button', role: 'tab' },
            dataset: { id: screenshot.id },
            onClick: () => {
              this.showScreenshot(screenshot);
            },
          },
          screenshotLabel(screenshot),
          screenshot.variantLabel !== null && ` · ${screenshot.variantLabel}`,
        ),
      ),
    );
    const active = this.editor.activeScreenshot;
    const next = screenshots.find((screenshot) => screenshot.id === active?.id) ?? screenshots[0];
    if (next) this.showScreenshot(next);
  }

  openRelease(details: SessionDetails): void {
    this.release.open(details.session, details.headVersion);
  }

  remoteRevision(revision: number): void {
    this.store.remoteRevision(revision);
  }

  private showScreenshot(screenshot: Screenshot): void {
    this.editor.setScreenshot({ id: screenshot.id, width: screenshot.width, height: screenshot.height });
    void this.viewer.show({
      id: screenshot.id,
      url: api.screenshotImageUrl(screenshot.id),
      width: screenshot.width,
      height: screenshot.height,
    });
  }

  private syncView(): void {
    const active = this.editor.activeScreenshot?.id;
    for (const tab of this.tabs.querySelectorAll<HTMLButtonElement>('button')) {
      tab.setAttribute('aria-selected', String(tab.dataset['id'] === active));
    }
    for (const [tool, button] of this.toolButtons) {
      button.setAttribute(
        'aria-pressed',
        String(this.editor.tool === tool || (tool === 'draw' && this.editor.tool === 'region')),
      );
    }
    this.viewer.requestDraw();
  }

  private showSaveState(state: SaveState): void {
    this.saveIndicator.className = `save-state save-${state}`;
    this.saveIndicator.textContent = this.editor.readOnly ? t('editor.readOnlyShort') : t(SAVE_LABELS[state]);
  }

  private message(error: unknown, kind: 'error' | 'info' = 'error'): void {
    const text = typeof error === 'string' ? error : errorMessage(error);
    const item = h(
      'p',
      { class: kind === 'error' ? 'notice error' : 'notice', attrs: { role: 'alert' } },
      text,
    );
    this.messages.append(item);
    setTimeout(() => {
      item.remove();
    }, MESSAGE_TIMEOUT_MS);
  }

  /** Saves pending edits before the editor goes away (navigation, status change). */
  async close(): Promise<void> {
    this.inspector.flushAll();
    this.unsubscribe();
    this.tree.destroy();
    this.inspector.destroy();
    this.release.destroy();
    this.viewer.destroy();
    await this.store.flush();
    this.store.destroy();
  }

  flush(): void {
    this.inspector.flushAll();
    void this.store.flush();
  }
}

export const sessionView: View = (root, params) => {
  const sessionId = params['sessionId'] ?? '';
  const disposer = new Disposer();
  const breadcrumb = h('nav', { class: 'breadcrumb' }, h('a', { attrs: { href: '/' } }, t('projects.title')));
  const saveIndicator = h('span', { class: 'save-state', attrs: { role: 'status', 'aria-live': 'polite' } });
  const messages = h('div', { class: 'messages' });
  const workspaceSlot = h(
    'div',
    { class: 'workspace-slot' },
    h('p', { class: 'muted' }, t('common.loading')),
  );
  root.classList.add('wide');

  let workspace: EditorWorkspace | null = null;
  let editable: boolean | null = null;
  let mounting = false;

  /** (Re)creates the editor when the session becomes editable or read-only. */
  const mountEditor = async (details: SessionDetails): Promise<void> => {
    const nextEditable = EDITABLE.has(details.session.status);
    if (workspace !== null && nextEditable === editable) {
      workspace.setScreenshots(details.screenshots);
      return;
    }
    if (mounting) return;
    mounting = true;
    try {
      const previous = workspace;
      workspace = null;
      await previous?.close();
      const draft = await api.getDraft(sessionId);
      editable = nextEditable;
      workspace = new EditorWorkspace(
        sessionId,
        draft,
        details.screenshots,
        !nextEditable,
        saveIndicator,
        messages,
      );
      replaceChildren(workspaceSlot, workspace.element);
    } catch (error) {
      replaceChildren(workspaceSlot, errorBox(error));
    } finally {
      mounting = false;
    }
  };

  const header = disposer.add(
    liveSection<SessionDetails>({
      load: () => api.getSession(sessionId),
      relevant: (event) =>
        event.type !== 'DraftChanged' && 'sessionId' in event && event.sessionId === sessionId,
      render: (details) =>
        sessionHeader(
          details,
          () => {
            header.reload();
          },
          saveIndicator,
          () => {
            workspace?.openRelease(details);
          },
        ),
      onData: (details) => {
        replaceChildren(
          breadcrumb,
          h('a', { attrs: { href: '/' } }, t('projects.title')),
          ' / ',
          h('a', { attrs: { href: pathTo('projects', details.session.projectId) } }, t('project.sessions')),
        );
        void mountEditor(details);
      },
    }),
  );

  disposer.addCallback(
    onLiveEvent((event) => {
      if (event.type === 'DraftChanged' && event.sessionId === sessionId)
        workspace?.remoteRevision(event.revision);
    }),
  );
  const onHide = (): void => {
    if (document.visibilityState === 'hidden') workspace?.flush();
  };
  document.addEventListener('visibilitychange', onHide);
  disposer.addCallback(() => {
    document.removeEventListener('visibilitychange', onHide);
    root.classList.remove('wide');
    void workspace?.close();
  });

  root.append(breadcrumb, header.element, messages, workspaceSlot);
  return disposer.dispose;
};
