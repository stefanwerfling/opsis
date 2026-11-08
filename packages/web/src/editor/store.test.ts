import {
  applyDraftOperations,
  emptyDraft,
  newId,
  type Draft,
  type DraftOperation,
} from '@opsis/core/browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type Api } from '../api.js';
import { DraftStore, type SaveState } from './store.js';

const SESSION = 'ses_1';
const ids = new Map<string, string>();
/** Stable real component id per test label (ids must have the ULID format). */
const id = (label: string): string => {
  let value = ids.get(label);
  if (value === undefined) {
    value = newId('component');
    ids.set(label, value);
  }
  return value;
};
const context = { screenshots: [] };

const add = (label: string, name = label): DraftOperation => ({
  op: 'addComponent',
  componentId: id(label),
  parentId: null,
  name,
  kind: 'component',
});

/** In-memory stand-in for the server: same pure function, optimistic locking by revision. */
class FakeServer {
  draft: Draft = emptyDraft(SESSION, '2026-01-01T00:00:00.000Z');
  calls: DraftOperation[][] = [];
  reject: ApiError | null = null;

  /** Simulates an edit saved by someone else (e.g. a second tab). */
  external(...operations: DraftOperation[]): void {
    this.draft = {
      ...applyDraftOperations(this.draft, operations, context),
      revision: this.draft.revision + 1,
    };
  }

  readonly api = {
    getDraft: () => Promise.resolve(this.draft),
    changeDraft: (
      _sessionId: string,
      input: { baseRevision: number; operations: readonly DraftOperation[] },
    ): Promise<Draft> => {
      this.calls.push([...input.operations]);
      if (this.reject) return Promise.reject(this.reject);
      if (input.baseRevision !== this.draft.revision)
        return Promise.reject(new ApiError(409, 'VERSION_CONFLICT', 'stale'));
      this.external(...input.operations);
      return Promise.resolve(this.draft);
    },
  } as unknown as Api;
}

const names = (draft: Draft): string[] => draft.components.map((component) => component.name);

describe('DraftStore', () => {
  let server: FakeServer;
  let states: SaveState[];
  let discarded: unknown[];
  let changes: number;

  const createStore = (): DraftStore =>
    new DraftStore(server.api, SESSION, server.draft, context, {
      onChange: () => (changes += 1),
      onSaveState: (state) => states.push(state),
      onDiscarded: (error) => discarded.push(error),
    });

  beforeEach(() => {
    vi.useFakeTimers();
    server = new FakeServer();
    states = [];
    discarded = [];
    changes = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('applies edits immediately and saves them debounced in one batch', async () => {
    const store = createStore();
    store.dispatch(add('cmp_a'));
    store.dispatch(add('cmp_b'));
    expect(names(store.draft)).toEqual(['cmp_a', 'cmp_b']);
    expect(store.hasUnsavedChanges).toBe(true);
    expect(server.calls).toHaveLength(0);

    await vi.runAllTimersAsync();
    expect(server.calls).toHaveLength(1);
    expect(server.calls[0]).toHaveLength(2);
    expect(server.draft.revision).toBe(1);
    expect(store.hasUnsavedChanges).toBe(false);
    expect(states).toEqual(['pending', 'saving', 'saved']);
    expect(changes).toBeGreaterThanOrEqual(2);
  });

  it('throws on invalid operations and changes nothing', () => {
    const store = createStore();
    expect(() => {
      store.dispatch({ op: 'deleteComponent', componentId: 'cmp_missing' });
    }).toThrow();
    expect(store.hasUnsavedChanges).toBe(false);
    expect(store.saveState).toBe('saved');
  });

  it('replays local edits on top of a newer server state after VERSION_CONFLICT', async () => {
    const store = createStore();
    server.external(add('cmp_remote', 'remote'));
    store.dispatch(add('cmp_local', 'local'));

    await vi.runAllTimersAsync();
    expect(server.calls).toHaveLength(2);
    expect(names(server.draft)).toEqual(['remote', 'local']);
    expect(names(store.draft)).toEqual(['remote', 'local']);
    expect(store.saveState).toBe('saved');
    expect(discarded).toEqual([]);
  });

  it('drops local edits that no longer fit after a conflict', async () => {
    const store = createStore();
    store.dispatch(add('cmp_a'));
    await vi.runAllTimersAsync();

    // Locally rename cmp_a while another tab deletes it.
    store.dispatch({ op: 'updateComponent', componentId: id('cmp_a'), name: 'renamed' });
    server.external({ op: 'deleteComponent', componentId: id('cmp_a') });

    await vi.runAllTimersAsync();
    expect(discarded).toHaveLength(1);
    expect(store.draft.components).toEqual([]);
    expect(store.hasUnsavedChanges).toBe(false);
  });

  it('discards a batch the server rejects and shows the server state again', async () => {
    const store = createStore();
    server.reject = new ApiError(409, 'CONFLICT', 'session is closed');
    store.dispatch(add('cmp_a'));

    await vi.runAllTimersAsync();
    expect(discarded).toEqual([server.reject]);
    expect(store.draft.components).toEqual([]);
    expect(store.hasUnsavedChanges).toBe(false);
    expect(store.saveState).toBe('error');
  });

  it('keeps edits made while a save is in flight and sends them afterwards', async () => {
    const store = createStore();
    store.dispatch(add('cmp_a'));
    const saving = store.flush();
    store.dispatch(add('cmp_b'));
    await saving;
    await vi.runAllTimersAsync();

    expect(server.calls.map((batch) => batch.length)).toEqual([1, 1]);
    expect(names(server.draft)).toEqual(['cmp_a', 'cmp_b']);
    expect(store.saveState).toBe('saved');
  });

  it('reloads on a newer remote revision and ignores its own', async () => {
    const store = createStore();
    store.dispatch(add('cmp_a'));
    await vi.runAllTimersAsync();
    store.remoteRevision(1);
    await vi.runAllTimersAsync();
    expect(changes).toBeGreaterThan(0);

    server.external(add('cmp_b'));
    store.remoteRevision(2);
    await vi.runAllTimersAsync();
    expect(names(store.draft)).toEqual(['cmp_a', 'cmp_b']);
    expect(store.draft.revision).toBe(2);
  });
});
