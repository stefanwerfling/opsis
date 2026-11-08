import { assessCompleteness, type CompletenessIssue, type CompletenessReport } from '@opsis/core/browser';
import type { Session } from '@opsis/core';
import { ApiError, type Api } from '../api.js';
import { h, replaceChildren, type Child } from '../dom.js';
import { t } from '../i18n/i18n.js';
import { errorBox } from '../ui.js';
import type { Editor } from './editor.js';
import { issueLabel } from './issues.js';

export interface ReleaseContext {
  readonly api: Api;
  readonly editor: Editor;
  /** Commits pending inspector input and saves the draft; resolves false if edits are unsaved. */
  readonly saveAll: () => Promise<boolean>;
}

/**
 * Release dialog (architecture 05 §2 from the human's side): the completeness report is
 * computed live from the draft with the same function the server uses. Blocking points
 * link to the component; every warning has to be acknowledged explicitly.
 */
export class ReleaseDialog {
  private readonly dialog: HTMLDialogElement;
  private readonly body = h('div', { class: 'release-body' });
  private readonly acknowledged = new Set<string>();
  private readonly changeDescription = h('textarea', {
    attrs: { rows: 3, maxlength: 10000, 'aria-label': t('release.changeDescription') },
  });
  private readonly output = h('div');
  /** Set after the server reported a newer head version (parallel release). */
  private headMoved: { versionNo: number } | null = null;
  private conflictAcknowledged = false;
  private busy = false;
  private session: Session | null = null;
  private readonly unsubscribe: () => void;

  constructor(private readonly context: ReleaseContext) {
    this.dialog = h(
      'dialog',
      { class: 'release-dialog', attrs: { 'aria-labelledby': 'release-title' } },
      h('h2', { attrs: { id: 'release-title' } }, t('release.title')),
      h('p', { class: 'muted' }, t('release.intro')),
      this.body,
      this.output,
    );
    this.dialog.addEventListener('close', () => {
      replaceChildren(this.output);
    });
    this.unsubscribe = context.editor.subscribe(() => {
      if (this.dialog.open) this.render();
    });
    document.body.append(this.dialog);
  }

  open(session: Session, headVersion: { versionNo: number; id: string } | null): void {
    this.session = session;
    // Already known from the session details: another session released meanwhile.
    this.headMoved =
      headVersion !== null && headVersion.id !== session.baseVersionId
        ? { versionNo: headVersion.versionNo }
        : null;
    this.render();
    this.dialog.showModal();
  }

  destroy(): void {
    this.unsubscribe();
    this.dialog.remove();
  }

  private report(): CompletenessReport {
    return assessCompleteness(this.context.editor.draft, {
      assignment: this.session?.assignment ?? 'needs_confirmation',
    });
  }

  private render(): void {
    const report = this.report();
    const draft = this.context.editor.draft;
    const open = report.warnings.filter((warning) => !this.acknowledged.has(warning.id));
    const canRelease =
      !this.busy &&
      report.blocking.length === 0 &&
      open.length === 0 &&
      (this.headMoved === null || this.conflictAcknowledged);

    const blockingItem = (issue: CompletenessIssue): Child => {
      const componentId =
        issue.componentId ?? draft.conflicts.find((c) => c.id === issue.conflictId)?.componentIds[0];
      return h(
        'li',
        {},
        componentId === undefined
          ? issueLabel(issue, draft)
          : h(
              'button',
              {
                class: 'link',
                attrs: { type: 'button' },
                onClick: () => {
                  this.dialog.close();
                  this.context.editor.select([componentId]);
                },
              },
              issueLabel(issue, draft),
            ),
      );
    };

    const warningItem = (issue: CompletenessIssue): Child => {
      const checkbox = h('input', {
        attrs: { type: 'checkbox' },
        props: { checked: this.acknowledged.has(issue.id) },
        onChange: () => {
          if (checkbox.checked) this.acknowledged.add(issue.id);
          else this.acknowledged.delete(issue.id);
          this.render();
        },
      });
      return h('li', {}, h('label', { class: 'check' }, checkbox, issueLabel(issue, draft)));
    };

    const submit = h(
      'button',
      {
        class: 'primary',
        attrs: { type: 'button', disabled: !canRelease },
        onClick: () => void this.submit(),
      },
      t('release.submit'),
    );

    replaceChildren(
      this.body,
      h('h3', {}, t('release.blocking')),
      report.blocking.length === 0
        ? h('p', { class: 'ok' }, t('release.noBlocking'))
        : h('ul', { class: 'issues blocking' }, report.blocking.map(blockingItem)),
      h(
        'div',
        { class: 'row release-warnings-head' },
        h('h3', {}, t('release.warnings')),
        report.warnings.length > 0 &&
          h(
            'button',
            {
              class: 'link',
              attrs: { type: 'button' },
              onClick: () => {
                for (const warning of report.warnings) this.acknowledged.add(warning.id);
                this.render();
              },
            },
            t('release.acknowledgeAll'),
          ),
      ),
      report.warnings.length === 0
        ? h('p', { class: 'ok' }, t('release.noWarnings'))
        : h('ul', { class: 'issues warnings' }, report.warnings.map(warningItem)),
      h(
        'p',
        { class: 'muted' },
        t('release.counts', {
          components: report.counts.components,
          specified: report.counts.specifiedFields,
          total: report.counts.totalFields,
        }),
      ),
      h(
        'label',
        { class: 'field' },
        h('span', { class: 'field-label' }, t('release.changeDescription')),
        this.changeDescription,
      ),
      this.headMoved !== null &&
        h(
          'div',
          { class: 'notice warning' },
          h('p', {}, t('release.headMoved', { version: this.headMoved.versionNo })),
          h(
            'label',
            { class: 'check' },
            h('input', {
              attrs: { type: 'checkbox' },
              props: { checked: this.conflictAcknowledged },
              onChange: (event) => {
                this.conflictAcknowledged = (event.currentTarget as HTMLInputElement).checked;
                this.render();
              },
            }),
            t('release.conflictAcknowledged', { version: this.headMoved.versionNo }),
          ),
        ),
      h(
        'div',
        { class: 'row dialog-actions' },
        submit,
        h(
          'button',
          {
            attrs: { type: 'button' },
            onClick: () => {
              this.dialog.close();
            },
          },
          t('release.close'),
        ),
      ),
    );
  }

  private async submit(): Promise<void> {
    const session = this.session;
    if (session === null || this.busy) return;
    this.busy = true;
    replaceChildren(this.output);
    this.render();
    try {
      if (!(await this.context.saveAll())) {
        replaceChildren(this.output, errorBox(new Error(t('release.unsaved'))));
        return;
      }
      // The row version changes with every status change: use the current one.
      const current = await this.context.api.getSession(session.id);
      await this.context.api.release(session.id, {
        rowVersion: current.session.rowVersion,
        acknowledgedWarnings: [...this.acknowledged],
        changeDescription: this.changeDescription.value,
        conflictAcknowledged: this.conflictAcknowledged,
      });
      this.dialog.close();
    } catch (error) {
      if (error instanceof ApiError && error.code === 'VERSION_CONFLICT' && isHeadConflict(error.details)) {
        this.headMoved = { versionNo: error.details.headVersion.versionNo };
      }
      replaceChildren(this.output, errorBox(error));
    } finally {
      this.busy = false;
      if (this.dialog.open) this.render();
    }
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/** VERSION_CONFLICT details of a parallel release: `{ headVersion: { versionNo } }`. */
const isHeadConflict = (details: unknown): details is { headVersion: { versionNo: number } } =>
  isRecord(details) &&
  isRecord(details['headVersion']) &&
  typeof details['headVersion']['versionNo'] === 'number';
