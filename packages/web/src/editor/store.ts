import {
  applyDraftOperations,
  type Draft,
  type DraftContext,
  type DraftOperation,
} from '@opsis/core/browser';
import { ApiError, type Api } from '../api.js';

export type SaveState = 'saved' | 'pending' | 'saving' | 'error';

export interface DraftStoreEvents {
  /** The visible draft changed (local edit or server update). */
  readonly onChange: () => void;
  readonly onSaveState: (state: SaveState) => void;
  /** Local edits had to be discarded (rejected by the server or invalid after a conflict). */
  readonly onDiscarded: (error: unknown) => void;
}

const SAVE_DELAY_MS = 400;

/**
 * Client side of the draft: the server-confirmed state plus local operations that are not
 * saved yet. The visible draft is `confirmed + inFlight + pending`, computed with the same
 * pure function the server uses – so the editor reacts immediately and the server stays
 * the authority. Saves are debounced and sent one batch at a time.
 */
export class DraftStore {
  private confirmed: Draft;
  private inFlight: DraftOperation[] = [];
  private pending: DraftOperation[] = [];
  private visible: Draft;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private destroyed = false;
  private state: SaveState = 'saved';

  constructor(
    private readonly api: Api,
    private readonly sessionId: string,
    initial: Draft,
    private context: DraftContext,
    private readonly events: DraftStoreEvents,
  ) {
    this.confirmed = initial;
    this.visible = initial;
  }

  get draft(): Draft {
    return this.visible;
  }

  get saveState(): SaveState {
    return this.state;
  }

  get hasUnsavedChanges(): boolean {
    return this.inFlight.length > 0 || this.pending.length > 0;
  }

  setContext(context: DraftContext): void {
    this.context = context;
  }

  /**
   * Applies operations locally and schedules saving. Invalid operations throw here (same
   * validation as on the server) and change nothing.
   */
  dispatch(...operations: DraftOperation[]): void {
    if (operations.length === 0) return;
    this.visible = applyDraftOperations(this.visible, operations, this.context);
    this.pending.push(...operations);
    this.setState('pending');
    this.events.onChange();
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), SAVE_DELAY_MS);
  }

  /** Saves immediately (e.g. before leaving the page). */
  async flush(): Promise<void> {
    clearTimeout(this.timer);
    if (this.destroyed || this.inFlight.length > 0 || this.pending.length === 0) return;
    this.inFlight = this.pending;
    this.pending = [];
    this.setState('saving');
    try {
      const saved = await this.api.changeDraft(this.sessionId, {
        baseRevision: this.confirmed.revision,
        operations: this.inFlight,
      });
      this.confirmed = saved;
      this.inFlight = [];
      this.rebase();
    } catch (error) {
      if (error instanceof ApiError && error.code === 'VERSION_CONFLICT') {
        // Someone else (e.g. a second tab) saved first: replay our edits on their state.
        this.pending = [...this.inFlight, ...this.pending];
        this.inFlight = [];
        await this.reload();
      } else {
        // The server rejected the batch: drop it, show the server state again.
        this.inFlight = [];
        this.events.onDiscarded(error);
        await this.reload();
        this.setState('error');
        return;
      }
    }
    if (this.pending.length > 0) {
      await this.flush();
    } else {
      this.setState('saved');
    }
  }

  /** A newer revision exists on the server (live event): fetch it unless we are mid-save. */
  remoteRevision(revision: number): void {
    if (revision <= this.confirmed.revision || this.inFlight.length > 0) return;
    void this.reload();
  }

  /** Loads the server state and replays unsaved local edits on top of it. */
  async reload(): Promise<void> {
    try {
      this.confirmed = await this.api.getDraft(this.sessionId);
    } catch (error) {
      this.events.onDiscarded(error);
      return;
    }
    this.rebase();
    if (this.pending.length > 0 && this.inFlight.length === 0) {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => void this.flush(), SAVE_DELAY_MS);
    }
  }

  destroy(): void {
    this.destroyed = true;
    clearTimeout(this.timer);
  }

  private rebase(): void {
    const local = [...this.inFlight, ...this.pending];
    try {
      this.visible = applyDraftOperations(this.confirmed, local, this.context);
    } catch (error) {
      // The local edits no longer fit (e.g. the component was deleted elsewhere).
      this.pending = [];
      this.visible = applyDraftOperations(this.confirmed, this.inFlight, this.context);
      this.events.onDiscarded(error);
    }
    this.events.onChange();
  }

  private setState(state: SaveState): void {
    if (state === this.state) return;
    this.state = state;
    this.events.onSaveState(state);
  }
}
