import type { DomainEvent, SessionStatus } from '@opsis/core';
import { ApiError } from './api.js';
import { h, replaceChildren, type Child } from './dom.js';
import { getLanguage, t } from './i18n/i18n.js';
import { onLiveEvent, onLiveStatus } from './live.js';

// ── Formatting ────────────────────────────────────────────────────────────────

export const formatDateTime = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(getLanguage(), { dateStyle: 'medium', timeStyle: 'short' }).format(date);
};

export const formatBytes = (bytes: number): string => {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit === 0 || value >= 10 ? 0 : 1;
  return `${new Intl.NumberFormat(getLanguage(), { maximumFractionDigits: digits }).format(value)} ${units[unit] ?? 'B'}`;
};

/** Human readable error, including field issues of validation errors. */
export const errorMessage = (error: unknown): string => {
  if (error instanceof ApiError) {
    if (error.code === 'NOT_FOUND') return t('common.notFound');
    const details = error.details;
    if (
      typeof details === 'object' &&
      details !== null &&
      'issues' in details &&
      Array.isArray(details.issues)
    ) {
      const issues = (details.issues as unknown[])
        .map((issue) => {
          if (typeof issue !== 'object' || issue === null) return '';
          const path = 'path' in issue && typeof issue.path === 'string' ? issue.path : '';
          const message = 'message' in issue && typeof issue.message === 'string' ? issue.message : '';
          return path === '' ? message : `${path}: ${message}`;
        })
        .filter((text) => text !== '');
      if (issues.length > 0) return t('common.error', { message: issues.join('; ') });
    }
    return t('common.error', { message: error.message });
  }
  return t('common.error', { message: error instanceof Error ? error.message : String(error) });
};

// ── Small components ──────────────────────────────────────────────────────────

export const statusBadge = (status: SessionStatus): HTMLElement =>
  h('span', { class: `badge status-${status}` }, t(`status.${status}`));

export const errorBox = (error: unknown): HTMLElement =>
  h('p', { class: 'error', attrs: { role: 'alert' } }, errorMessage(error));

export const field = (label: string, control: HTMLElement, hint?: string): HTMLElement =>
  h(
    'label',
    { class: 'field' },
    h('span', { class: 'field-label' }, label),
    control,
    hint && h('small', {}, hint),
  );

/** Runs an async form action with disabled submit button and inline error output. */
export const handleSubmit =
  (form: HTMLFormElement, action: () => Promise<void>) =>
  (event: SubmitEvent): void => {
    event.preventDefault();
    const button = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    const output = form.querySelector<HTMLElement>('.form-error');
    if (button) button.disabled = true;
    if (output) replaceChildren(output);
    action()
      .catch((error: unknown) => {
        if (output) replaceChildren(output, errorMessage(error));
      })
      .finally(() => {
        if (button) button.disabled = false;
      });
  };

export const formError = (): HTMLElement => h('p', { class: 'form-error error', attrs: { role: 'alert' } });

// ── Live sections ─────────────────────────────────────────────────────────────

export interface LiveSection {
  readonly element: HTMLElement;
  reload(): void;
  destroy(): void;
}

export interface LiveSectionOptions<T> {
  readonly load: () => Promise<T>;
  readonly render: (data: T) => Child | Child[];
  /** Which domain events make this section stale. */
  readonly relevant: (event: DomainEvent) => boolean;
  readonly onData?: (data: T) => void;
  readonly className?: string;
}

const RELOAD_DEBOUNCE_MS = 150;

/**
 * A DOM region that loads data, renders it and reloads on relevant live events or after
 * the live connection was re-established (events may have been missed meanwhile).
 * Responses that arrive out of order are discarded; unchanged data is not re-rendered,
 * so focus and scroll positions survive unrelated events.
 */
export const liveSection = <T>(options: LiveSectionOptions<T>): LiveSection => {
  const element = h(
    'div',
    { class: options.className ?? 'live-section' },
    h('p', { class: 'muted' }, t('common.loading')),
  );
  let sequence = 0;
  let lastJson: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let destroyed = false;

  const reload = (): void => {
    const current = ++sequence;
    options
      .load()
      .then((data) => {
        if (destroyed || current !== sequence) return;
        const json = JSON.stringify(data);
        if (json !== lastJson) {
          lastJson = json;
          replaceChildren(element, options.render(data));
        }
        options.onData?.(data);
      })
      .catch((error: unknown) => {
        if (destroyed || current !== sequence) return;
        lastJson = undefined;
        replaceChildren(element, errorBox(error));
      });
  };

  const scheduleReload = (): void => {
    clearTimeout(timer);
    timer = setTimeout(reload, RELOAD_DEBOUNCE_MS);
  };

  let wasConnected: boolean | undefined;
  const offEvent = onLiveEvent((event) => {
    if (options.relevant(event)) scheduleReload();
  });
  const offStatus = onLiveStatus((connected) => {
    if (connected && wasConnected === false) scheduleReload();
    wasConnected = connected;
  });

  reload();
  return {
    element,
    reload,
    destroy: () => {
      destroyed = true;
      clearTimeout(timer);
      offEvent();
      offStatus();
    },
  };
};

// ── View contract ─────────────────────────────────────────────────────────────

/** A view renders into `root` and returns a cleanup function that releases subscriptions. */
export type View = (root: HTMLElement, params: Readonly<Record<string, string>>) => () => void;

/** Collects cleanup callbacks of the sections and components a view creates. */
export class Disposer {
  private readonly callbacks: (() => void)[] = [];

  add<T extends { destroy(): void }>(item: T): T {
    this.callbacks.push(() => {
      item.destroy();
    });
    return item;
  }

  addCallback(callback: () => void): void {
    this.callbacks.push(callback);
  }

  dispose = (): void => {
    for (const callback of this.callbacks.splice(0).reverse()) callback();
  };
}

/** Copies `text` and confirms on the button for a moment. */
export const copyButton = (text: () => string, output: HTMLElement): HTMLButtonElement => {
  const button = h(
    'button',
    {
      attrs: { type: 'button' },
      onClick: () => {
        navigator.clipboard
          .writeText(text())
          .then(() => {
            button.textContent = t('version.copied');
            setTimeout(() => {
              button.textContent = t('version.copy');
            }, 1500);
          })
          .catch((error: unknown) => {
            replaceChildren(output, errorBox(error));
          });
      },
    },
    t('version.copy'),
  );
  return button;
};
