/**
 * Bounded long poll for the human's release (architecture 06 §3 "Wartemechanismus").
 * Never blocks indefinitely: it ends on a final status, the timeout or an abort. All state
 * lives in the database, so an agent can resume waiting at any time, even from another
 * conversation.
 */
import type { Actor } from '../domain/actor.js';
import { OpsisError } from '../domain/errors.js';
import type { SessionStatus } from '../domain/session.js';
import type { AppContext } from './context.js';
import { findSession } from './sessions.js';

export const WAIT_LIMITS = { minSeconds: 1, maxSeconds: 600, defaultSeconds: 120 } as const;

/** Statuses at which waiting ends: released, or the session has ended. */
export const WAIT_DONE_STATUSES: readonly SessionStatus[] = ['ready', 'delivered', 'cancelled', 'failed'];
const isDone = (status: SessionStatus): boolean => WAIT_DONE_STATUSES.includes(status);

export interface WaitProgress {
  readonly status: SessionStatus;
  readonly waitedSeconds: number;
  /** Components in the draft so far – shows the agent that the human is working. */
  readonly componentCount: number;
}

export interface WaitOptions {
  readonly timeoutMs: number;
  /** Aborted when the caller goes away; waiting ends and everything is cleaned up. */
  readonly signal?: AbortSignal;
  /** Safety net against lost events (default 5 s). */
  readonly pollMs?: number;
  /** Interval of `onProgress` (default 15 s). */
  readonly progressMs?: number;
  readonly onProgress?: (progress: WaitProgress) => void | Promise<void>;
}

export interface WaitResult {
  readonly done: boolean;
  readonly status: SessionStatus;
  readonly waitedSeconds: number;
  /** The caller went away before the end. */
  readonly aborted: boolean;
}

export const waitForSpecification = (
  ctx: AppContext,
  actor: Actor,
  sessionId: string,
  options: WaitOptions,
): Promise<WaitResult> => {
  const limitMs = WAIT_LIMITS.maxSeconds * 1000;
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 0 || options.timeoutMs > limitMs) {
    throw new OpsisError(
      'VALIDATION',
      `timeout must be between 0 and ${String(WAIT_LIMITS.maxSeconds)} seconds`,
    );
  }
  const started = Date.now();
  const waited = (): number => Math.round((Date.now() - started) / 100) / 10;

  // 1. Access check and first read: already finished → answer immediately.
  const session = findSession(ctx, actor, sessionId);
  if (isDone(session.status) || options.signal?.aborted === true) {
    return Promise.resolve({
      done: isDone(session.status),
      status: session.status,
      waitedSeconds: 0,
      aborted: !isDone(session.status),
    });
  }

  return new Promise<WaitResult>((resolve) => {
    let status = session.status;
    let finished = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const intervals: ReturnType<typeof setInterval>[] = [];

    const finish = (done: boolean, aborted = false): void => {
      if (finished) return;
      finished = true;
      unsubscribe();
      for (const timer of timers) clearTimeout(timer);
      for (const interval of intervals) clearInterval(interval);
      options.signal?.removeEventListener('abort', onAbort);
      resolve({ done, status, waitedSeconds: waited(), aborted });
    };
    const observe = (next: SessionStatus): void => {
      status = next;
      if (isDone(next)) finish(true);
    };
    /** Returns whether waiting has ended. */
    const reread = (): boolean => {
      const current = ctx.repos.sessions.findById(sessionId);
      if (current) observe(current.status);
      return finished;
    };
    const onAbort = (): void => {
      finish(false, true);
    };

    // 2. Subscribe BEFORE the second read, so no change between the two is lost.
    const unsubscribe = ctx.events.subscribe((event) => {
      if (event.type === 'SessionStatusChanged' && event.sessionId === sessionId) observe(event.to);
    });
    if (reread()) return;

    // 3. Wait for an event, the timeout or an abort; poll the database as a safety net.
    options.signal?.addEventListener('abort', onAbort, { once: true });
    timers.push(
      setTimeout(() => {
        finish(false);
      }, options.timeoutMs),
    );
    intervals.push(
      setInterval(() => {
        reread();
      }, options.pollMs ?? 5000),
    );
    const { onProgress } = options;
    if (onProgress) {
      intervals.push(
        setInterval(() => {
          const componentCount = ctx.repos.drafts.find(sessionId)?.components.length ?? 0;
          const progress = { status, waitedSeconds: waited(), componentCount };
          void Promise.resolve()
            .then(() => onProgress(progress))
            .catch(() => {
              // A failed progress notification (client gone) must not end the wait; the abort does.
            });
        }, options.progressMs ?? 15_000),
      );
    }
  });
};
