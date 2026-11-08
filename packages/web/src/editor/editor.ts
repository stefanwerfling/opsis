import {
  childrenOf,
  componentDepths,
  findComponent,
  newId,
  subtreeIds,
  type ComponentKind,
  type Draft,
  type DraftComponent,
  type DraftOperation,
  type Rect,
} from '@opsis/core/browser';
import { t } from '../i18n/i18n.js';
import type { DraftStore } from './store.js';

/** select/move, draw a new component, (re)draw the selected component's region, drag a relation. */
export type Tool = 'select' | 'draw' | 'region' | 'relate';

export interface EditorScreenshot {
  readonly id: string;
  readonly width: number;
  readonly height: number;
}

type Listener = () => void;

/**
 * Editor state shared by tree, canvas and inspector: selection, active tool and
 * screenshot, plus the commands that turn user intent into draft operations.
 */
export class Editor {
  private selected = new Set<string>();
  private toolValue: Tool = 'select';
  private screenshot: EditorScreenshot | null = null;
  private readonly listeners = new Set<Listener>();
  /** Collapsed tree nodes (view state only). */
  readonly collapsed = new Set<string>();
  hoverId: string | null = null;
  /** Message shown to the user when an edit is rejected locally. */
  onError: (error: unknown) => void = () => undefined;

  constructor(
    readonly store: DraftStore,
    readonly readOnly: boolean,
  ) {}

  get draft(): Draft {
    return this.store.draft;
  }

  get selection(): readonly string[] {
    return [...this.selected];
  }

  get single(): DraftComponent | undefined {
    if (this.selected.size !== 1) return undefined;
    const [id] = this.selected;
    return id === undefined ? undefined : findComponent(this.draft, id);
  }

  isSelected(componentId: string): boolean {
    return this.selected.has(componentId);
  }

  get tool(): Tool {
    return this.toolValue;
  }

  get activeScreenshot(): EditorScreenshot | null {
    return this.screenshot;
  }

  depths(): Map<string, number> {
    return componentDepths(this.draft);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Notifies all panels; called after any state change. */
  changed(): void {
    // Drop selected ids that no longer exist (deleted here or elsewhere).
    for (const id of this.selected) if (!findComponent(this.draft, id)) this.selected.delete(id);
    for (const listener of this.listeners) listener();
  }

  // ── View state ──────────────────────────────────────────────────────────────

  setScreenshot(screenshot: EditorScreenshot): void {
    this.screenshot = screenshot;
    this.changed();
  }

  setTool(tool: Tool): void {
    if (this.readOnly && tool !== 'select') return;
    if (tool === 'region' && this.single === undefined) return;
    this.toolValue = tool;
    this.changed();
  }

  select(ids: readonly string[], mode: 'replace' | 'toggle' = 'replace'): void {
    if (mode === 'replace') this.selected = new Set(ids);
    else for (const id of ids) if (!this.selected.delete(id)) this.selected.add(id);
    // Selecting something inside a collapsed branch opens the branch.
    for (const id of ids) {
      let parent = findComponent(this.draft, id)?.parentId ?? null;
      while (parent !== null) {
        this.collapsed.delete(parent);
        parent = findComponent(this.draft, parent)?.parentId ?? null;
      }
    }
    if (this.toolValue === 'region') this.toolValue = 'select';
    this.changed();
  }

  // ── Commands (each becomes one batch of draft operations) ───────────────────

  /** Runs operations; local validation errors are reported instead of thrown. */
  apply(...operations: DraftOperation[]): boolean {
    if (this.readOnly) return false;
    try {
      this.store.dispatch(...operations);
      return true;
    } catch (error) {
      this.onError(error);
      return false;
    }
  }

  private nextName(): string {
    const used = new Set(this.draft.components.map((component) => component.name));
    for (let index = this.draft.components.length + 1; ; index += 1) {
      const name = t('editor.defaultName', { n: index });
      if (!used.has(name)) return name;
    }
  }

  /** New component as child of the single selected component (or as root). */
  addComponent(region?: Rect, kind: ComponentKind = 'component'): string | null {
    const parentId = this.single?.componentId ?? null;
    const componentId = newId('component');
    const screenshot = this.screenshot;
    const ok = this.apply({
      op: 'addComponent',
      componentId,
      parentId,
      name: this.nextName(),
      kind,
      ...(region !== undefined && screenshot !== null
        ? { region: { screenshotId: screenshot.id, ...region } }
        : {}),
    });
    if (!ok) return null;
    this.toolValue = 'select';
    this.select([componentId]);
    return componentId;
  }

  /**
   * Relation drawn on the canvas. The kind starts as the neutral "other" (nothing is
   * assumed); it can be changed in the inspector, where the new relation is shown.
   */
  addRelation(fromComponentId: string, toComponentId: string): void {
    const ok = this.apply({
      op: 'addRelation',
      relationId: newId('relation'),
      fromComponentId,
      toComponentId,
      kind: 'other',
      description: '',
    });
    if (ok) this.select([fromComponentId]);
  }

  setRegion(componentId: string, rect: Rect | null): void {
    const screenshot = this.screenshot;
    if (screenshot === null) return;
    this.apply({ op: 'setRegion', componentId, screenshotId: screenshot.id, rect });
  }

  /** Top-level ids of the selection (children of selected parents are covered by them). */
  private selectionRoots(): string[] {
    const ids = this.selection;
    return ids.filter((id) => {
      let parent = findComponent(this.draft, id)?.parentId ?? null;
      while (parent !== null) {
        if (this.selected.has(parent)) return false;
        parent = findComponent(this.draft, parent)?.parentId ?? null;
      }
      return true;
    });
  }

  duplicateSelection(): void {
    const operations: DraftOperation[] = [];
    const copies: string[] = [];
    for (const id of this.selectionRoots()) {
      const idMap = Object.fromEntries(subtreeIds(this.draft, id).map((old) => [old, newId('component')]));
      operations.push({ op: 'duplicateComponent', componentId: id, idMap });
      const copy = idMap[id];
      if (copy !== undefined) copies.push(copy);
    }
    if (this.apply(...operations)) this.select(copies);
  }

  deleteSelection(): void {
    const operations = this.selectionRoots().map((componentId): DraftOperation => ({
      op: 'deleteComponent',
      componentId,
    }));
    if (this.apply(...operations)) this.select([]);
  }

  setHidden(ids: readonly string[], hidden: boolean): void {
    this.apply(...ids.map((componentId): DraftOperation => ({ op: 'updateComponent', componentId, hidden })));
  }

  move(componentId: string, parentId: string | null, index: number): void {
    this.apply({ op: 'moveComponent', componentId, parentId, index });
  }

  /** Moves the single selection one place up/down among its siblings. */
  shift(direction: -1 | 1): void {
    const component = this.single;
    if (!component) return;
    const index = component.order + direction;
    if (index < 0 || index >= childrenOf(this.draft, component.parentId).length) return;
    this.move(component.componentId, component.parentId, index);
  }

  /** Makes the single selection a child of its previous sibling. */
  indent(): void {
    const component = this.single;
    if (!component || component.order === 0) return;
    const previous = childrenOf(this.draft, component.parentId)[component.order - 1];
    if (!previous) return;
    this.collapsed.delete(previous.componentId);
    this.move(
      component.componentId,
      previous.componentId,
      childrenOf(this.draft, previous.componentId).length,
    );
  }

  /** Makes the single selection a sibling right after its parent. */
  outdent(): void {
    const component = this.single;
    if (!component || component.parentId === null) return;
    const parent = findComponent(this.draft, component.parentId);
    if (!parent) return;
    this.move(component.componentId, parent.parentId, parent.order + 1);
  }
}
