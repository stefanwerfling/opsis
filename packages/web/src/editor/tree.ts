import { childrenOf, depthColor, subtreeIds, type Draft, type DraftComponent } from '@opsis/core/browser';
import { h, replaceChildren } from '../dom.js';
import { t } from '../i18n/i18n.js';
import type { Editor } from './editor.js';
import { unconfirmedCount } from './proposals.js';

type DropZone = 'before' | 'inside' | 'after';

const DRAG_TYPE = 'application/x-opsis-component';

/**
 * Component tree: semantic hierarchy defined by the user (requirements §7), independent of
 * the region geometry. Drag & drop: upper quarter = before, lower quarter = after,
 * middle = make child. All actions are also reachable by buttons and keyboard.
 */
export class TreePanel {
  readonly element: HTMLElement;
  private readonly list: HTMLElement;
  private readonly toolbar: HTMLElement;
  private renaming: { id: string; value: string } | null = null;
  private confirmDelete = false;
  private dragId: string | null = null;
  /** What the rendered rows depend on besides the selection (fast path for selecting). */
  private structure: { draft: Draft; key: string } | null = null;
  private readonly unsubscribe: () => void;

  constructor(private readonly editor: Editor) {
    this.toolbar = h('div', { class: 'tree-toolbar' });
    this.list = h('ul', {
      class: 'tree',
      attrs: { role: 'tree', tabindex: 0, 'aria-label': t('editor.tree') },
      onKeydown: (event) => {
        this.keyDown(event);
      },
    });
    this.element = h(
      'section',
      { class: 'editor-panel tree-panel' },
      h('h2', {}, t('editor.tree')),
      this.toolbar,
      this.list,
    );
    this.unsubscribe = editor.subscribe(() => {
      this.render();
    });
    this.render();
  }

  destroy(): void {
    this.unsubscribe();
  }

  // ── Rendering ───────────────────────────────────────────────────────────────

  private render(): void {
    this.renderToolbar();
    const scroll = this.list.scrollTop;
    const draft = this.editor.draft;
    const key = [
      [...this.editor.collapsed].join(','),
      this.renaming?.id ?? '',
      this.editor.activeScreenshot?.id ?? '',
      String(this.editor.readOnly),
    ].join('|');
    if (this.structure?.draft === draft && this.structure.key === key) {
      // Only the selection changed: update the existing rows instead of rebuilding them.
      for (const row of this.list.querySelectorAll<HTMLElement>('[role="treeitem"]')) {
        const selected = this.editor.isSelected(row.dataset['id'] ?? '');
        row.classList.toggle('selected', selected);
        row.setAttribute('aria-selected', String(selected));
      }
      return;
    }
    this.structure = { draft, key };
    if (draft.components.length === 0) {
      replaceChildren(this.list, h('li', { class: 'muted tree-empty' }, t('editor.treeEmpty')));
      return;
    }
    const depths = this.editor.depths();
    const children = childrenMap(draft);
    const rows: HTMLElement[] = [];
    const visit = (parentId: string | null): void => {
      for (const component of children.get(parentId) ?? []) {
        rows.push(this.row(component, depths.get(component.componentId) ?? 0, children));
        if (!this.editor.collapsed.has(component.componentId)) visit(component.componentId);
      }
    };
    visit(null);
    replaceChildren(this.list, rows);
    this.list.scrollTop = scroll;
    const input = this.list.querySelector<HTMLInputElement>('input.tree-rename');
    if (input) {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }
  }

  private renderToolbar(): void {
    const editor = this.editor;
    const count = editor.selection.length;
    const single = editor.single;
    const disabled = editor.readOnly;
    const button = (label: string, title: string, enabled: boolean, action: () => void, className = '') =>
      h(
        'button',
        {
          class: className,
          attrs: { type: 'button', title, 'aria-label': title, disabled: disabled || !enabled },
          onClick: action,
        },
        label,
      );
    if (this.confirmDelete && count === 0) this.confirmDelete = false;
    replaceChildren(
      this.toolbar,
      button('+', single ? t('editor.addChild') : t('editor.addRoot'), true, () => {
        editor.addComponent();
      }),
      button('⧉', t('editor.duplicate'), count > 0, () => {
        editor.duplicateSelection();
      }),
      button('↑', t('editor.moveUp'), single !== undefined && single.order > 0, () => {
        editor.shift(-1);
      }),
      button('↓', t('editor.moveDown'), single !== undefined, () => {
        editor.shift(1);
      }),
      button('→', t('editor.indent'), single !== undefined && single.order > 0, () => {
        editor.indent();
      }),
      button('←', t('editor.outdent'), single?.parentId !== null && single !== undefined, () => {
        editor.outdent();
      }),
      this.confirmDelete
        ? [
            button(
              t('editor.confirmDelete', { count }),
              t('editor.confirmDelete', { count }),
              true,
              () => {
                this.confirmDelete = false;
                editor.deleteSelection();
              },
              'danger',
            ),
            button('✕', t('common.cancel'), true, () => {
              this.confirmDelete = false;
              this.render();
            }),
          ]
        : button('🗑', t('editor.delete'), count > 0, () => {
            this.confirmDelete = true;
            this.render();
          }),
    );
  }

  private row(
    component: DraftComponent,
    depth: number,
    children: ReadonlyMap<string | null, DraftComponent[]>,
  ): HTMLElement {
    const editor = this.editor;
    const id = component.componentId;
    const hasChildren = (children.get(id)?.length ?? 0) > 0;
    const collapsed = editor.collapsed.has(id);
    const selected = editor.isSelected(id);
    const screenshot = editor.activeScreenshot;
    const hasRegion =
      screenshot !== null && component.regions.some((region) => region.screenshotId === screenshot.id);

    const name =
      this.renaming?.id === id
        ? h('input', {
            class: 'tree-rename',
            attrs: { 'aria-label': t('editor.name'), maxlength: 200 },
            props: { value: this.renaming.value },
            onInput: (event) => {
              if (this.renaming) this.renaming.value = (event.currentTarget as HTMLInputElement).value;
            },
            onKeydown: (event) => {
              event.stopPropagation();
              if (event.key === 'Enter') this.commitRename();
              if (event.key === 'Escape') {
                this.renaming = null;
                this.render();
                this.list.focus();
              }
            },
            onBlur: () => {
              this.commitRename();
            },
          })
        : h(
            'span',
            {
              class: 'tree-name',
              onDblclick: () => {
                this.startRename(component);
              },
            },
            component.name,
          );

    const row = h(
      'li',
      {
        class: `tree-row${selected ? ' selected' : ''}${component.hidden ? ' is-hidden' : ''}`,
        attrs: {
          role: 'treeitem',
          'aria-selected': String(selected),
          'aria-level': depth + 1,
          ...(hasChildren ? { 'aria-expanded': String(!collapsed) } : {}),
          draggable: !editor.readOnly && this.renaming?.id !== id,
        },
        dataset: { id },
        onClick: (event) => {
          if (event.target instanceof HTMLInputElement || event.target instanceof HTMLButtonElement) return;
          editor.select([id], event.ctrlKey || event.metaKey || event.shiftKey ? 'toggle' : 'replace');
        },
        onDragstart: (event) => {
          this.dragId = id;
          event.dataTransfer?.setData(DRAG_TYPE, id);
          if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
        },
        onDragend: () => {
          this.dragId = null;
          this.clearDropMarkers();
        },
        onDragover: (event) => {
          const zone = this.dropZone(event, row, id);
          this.clearDropMarkers();
          if (zone === null) return;
          event.preventDefault();
          row.classList.add(`drop-${zone}`);
        },
        onDragleave: () => {
          row.classList.remove('drop-before', 'drop-inside', 'drop-after');
        },
        onDrop: (event) => {
          const zone = this.dropZone(event, row, id);
          this.clearDropMarkers();
          if (zone === null || this.dragId === null) return;
          event.preventDefault();
          this.drop(this.dragId, component, zone);
        },
      },
      h('span', { class: 'tree-indent' }),
      h(
        'button',
        {
          class: 'tree-caret',
          attrs: {
            type: 'button',
            'aria-label': collapsed ? t('editor.expand') : t('editor.collapse'),
            disabled: !hasChildren,
          },
          onClick: () => {
            if (collapsed) editor.collapsed.delete(id);
            else editor.collapsed.add(id);
            this.render();
          },
        },
        hasChildren ? (collapsed ? '▸' : '▾') : '',
      ),
      h('span', { class: 'tree-swatch', attrs: { title: t('editor.depth', { depth: depth + 1 }) } }),
      name,
      !hasRegion && h('span', { class: 'tree-noregion', attrs: { title: t('editor.noRegion') } }, '○'),
      unconfirmedCount(component) > 0 &&
        h(
          'span',
          {
            class: 'tree-proposal',
            attrs: { title: t('proposals.treeHint', { values: unconfirmedCount(component) }) },
          },
          '✦',
        ),
      h(
        'button',
        {
          class: 'tree-eye',
          attrs: {
            type: 'button',
            disabled: editor.readOnly,
            title: component.hidden ? t('editor.show') : t('editor.hide'),
            'aria-label': component.hidden ? t('editor.show') : t('editor.hide'),
            'aria-pressed': String(component.hidden),
          },
          onClick: () => {
            editor.setHidden([id], !component.hidden);
          },
        },
        component.hidden ? '◌' : '●',
      ),
    );
    // Indentation and colour via CSSOM (allowed by the strict CSP, unlike style attributes).
    row.style.setProperty('--depth', String(depth));
    row.style.setProperty('--swatch', depthColor(depth));
    return row;
  }

  private clearDropMarkers(): void {
    for (const marked of this.list.querySelectorAll('.drop-before, .drop-inside, .drop-after')) {
      marked.classList.remove('drop-before', 'drop-inside', 'drop-after');
    }
  }

  // ── Actions ─────────────────────────────────────────────────────────────────

  private dropZone(event: DragEvent, row: HTMLElement, targetId: string): DropZone | null {
    const dragId = this.dragId;
    if (dragId === null || this.editor.readOnly) return null;
    if (subtreeIds(this.editor.draft, dragId).includes(targetId)) return null; // no cycles
    const rect = row.getBoundingClientRect();
    const offset = (event.clientY - rect.top) / rect.height;
    return offset < 0.25 ? 'before' : offset > 0.75 ? 'after' : 'inside';
  }

  private drop(dragId: string, target: DraftComponent, zone: DropZone): void {
    const editor = this.editor;
    const dragged = editor.draft.components.find((component) => component.componentId === dragId);
    if (!dragged) return;
    if (zone === 'inside') {
      editor.collapsed.delete(target.componentId);
      editor.move(dragId, target.componentId, childrenOf(editor.draft, target.componentId).length);
      return;
    }
    let index = target.order + (zone === 'after' ? 1 : 0);
    // Moving down within the same parent: the dragged item leaves a gap before the target.
    if (dragged.parentId === target.parentId && dragged.order < index) index -= 1;
    editor.move(dragId, target.parentId, index);
  }

  private startRename(component: DraftComponent): void {
    if (this.editor.readOnly) return;
    this.renaming = { id: component.componentId, value: component.name };
    this.render();
  }

  private commitRename(): void {
    const renaming = this.renaming;
    if (!renaming) return;
    this.renaming = null;
    const component = this.editor.draft.components.find((candidate) => candidate.componentId === renaming.id);
    const name = renaming.value.trim();
    if (component && name !== '' && name !== component.name) {
      this.editor.apply({ op: 'updateComponent', componentId: renaming.id, name });
    } else {
      this.render();
    }
    this.list.focus();
  }

  /** Keyboard: ↑/↓ select, ←/→ collapse/expand, F2/Enter rename, Alt+↑/↓ reorder. */
  private keyDown(event: KeyboardEvent): void {
    const editor = this.editor;
    const rows = [...this.list.querySelectorAll<HTMLElement>('.tree-row')];
    const ids = rows.map((row) => row.dataset['id'] ?? '');
    const current = editor.single?.componentId;
    const index = current === undefined ? -1 : ids.indexOf(current);
    const handled = (): void => {
      event.preventDefault();
    };
    if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      editor.shift(event.key === 'ArrowUp' ? -1 : 1);
      handled();
      return;
    }
    switch (event.key) {
      case 'ArrowDown': {
        const next = ids[Math.min(ids.length - 1, index + 1)];
        if (next !== undefined) editor.select([next]);
        handled();
        break;
      }
      case 'ArrowUp': {
        const previous = ids[Math.max(0, index - 1)];
        if (previous !== undefined) editor.select([previous]);
        handled();
        break;
      }
      case 'ArrowLeft':
        if (current !== undefined) {
          if (!editor.collapsed.has(current) && childrenOf(editor.draft, current).length > 0) {
            editor.collapsed.add(current);
            this.render();
          } else if (editor.single?.parentId) {
            editor.select([editor.single.parentId]);
          }
        }
        handled();
        break;
      case 'ArrowRight':
        if (current !== undefined) {
          editor.collapsed.delete(current);
          this.render();
        }
        handled();
        break;
      case 'F2':
      case 'Enter':
        if (editor.single) this.startRename(editor.single);
        handled();
        break;
      default:
        break;
    }
  }
}

/** Children per parent (null = roots), ordered – one pass instead of a search per row. */
const childrenMap = (draft: Draft): Map<string | null, DraftComponent[]> => {
  const map = new Map<string | null, DraftComponent[]>();
  for (const component of draft.components) {
    const list = map.get(component.parentId);
    if (list) list.push(component);
    else map.set(component.parentId, [component]);
  }
  for (const list of map.values()) list.sort((a, b) => a.order - b.order);
  return map;
};
