import {
  COMPONENT_KINDS,
  RELATION_KINDS,
  SPEC_GROUP_NAMES,
  SPEC_GROUPS,
  SPEC_ORIGINS,
  assessCompleteness,
  findComponent,
  newId,
  regionOn,
  type CompletenessIssue,
  type Conflict,
  type DraftComponent,
  type Rect,
  type SpecGroup,
  type SpecOrigin,
  type SpecValue,
} from '@opsis/core/browser';
import { h, replaceChildren, type Child } from '../dom.js';
import { t, type MessageKey } from '../i18n/i18n.js';
import type { Editor } from './editor.js';
import { issueLabel } from './issues.js';

const TEXT_COMMIT_DELAY_MS = 600;

type Control = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

interface Binding {
  readonly control: Control;
  readonly read: () => string;
}

const specValueOf = (component: DraftComponent, group: SpecGroup, field: string): SpecValue | undefined =>
  (component.spec[group] as Record<string, SpecValue> | undefined)?.[field];

const linesOf = (text: string): string[] => text.split('\n');

/**
 * Right panel. Rebuilt when the selection changes; for other changes (own edits, live
 * updates) only control values are refreshed – never the control that has the focus, so
 * typing is not disturbed by incoming updates.
 */
export class InspectorPanel {
  readonly element: HTMLElement;
  private readonly body: HTMLElement;
  private key = '';
  private bindings: Binding[] = [];
  private dynamic: { element: HTMLElement; render: () => Child[] }[] = [];
  private readonly openGroups = new Set<SpecGroup>(['general']);
  private readonly flushers = new Set<() => void>();
  private readonly unsubscribe: () => void;

  constructor(private readonly editor: Editor) {
    this.body = h('div', { class: 'inspector-body' });
    this.element = h('section', { class: 'editor-panel inspector' }, this.body);
    this.unsubscribe = editor.subscribe(() => {
      this.update();
    });
    this.update();
  }

  destroy(): void {
    this.flushAll();
    this.unsubscribe();
  }

  /** Commits text that is still waiting for its debounce (selection change, leaving the page). */
  flushAll(): void {
    for (const flush of [...this.flushers]) flush();
  }

  private update(): void {
    const editor = this.editor;
    const single = editor.single;
    const key =
      single !== undefined
        ? `one:${single.componentId}`
        : editor.selection.length > 1
          ? `many:${editor.selection.join(',')}`
          : 'draft';
    if (key !== this.key) {
      this.flushAll();
      this.key = key;
      this.bindings = [];
      this.dynamic = [];
      replaceChildren(
        this.body,
        single !== undefined
          ? this.componentView(single.componentId)
          : editor.selection.length > 1
            ? this.multiView()
            : this.draftView(),
      );
      return;
    }
    const focused = document.activeElement;
    for (const binding of this.bindings) {
      if (binding.control === focused) continue;
      const value = binding.read();
      if (binding.control.value !== value) binding.control.value = value;
    }
    for (const section of this.dynamic) {
      if (focused !== null && section.element.contains(focused)) continue;
      replaceChildren(section.element, section.render());
    }
  }

  // ── Building blocks ─────────────────────────────────────────────────────────

  private bind<C extends Control>(control: C, read: () => string): C {
    control.value = read();
    control.disabled = this.editor.readOnly;
    this.bindings.push({ control, read });
    return control;
  }

  private section(render: () => Child[]): HTMLElement {
    const element = h('div', {}, render());
    this.dynamic.push({ element, render });
    return element;
  }

  /** Text control that commits after a pause and on blur. */
  private text(options: {
    readonly label: string;
    readonly read: () => string;
    readonly commit: (value: string) => void;
    readonly multiline?: boolean;
    readonly placeholder?: string;
    readonly hint?: string;
  }): HTMLElement {
    const control = this.bind(
      options.multiline === true
        ? h('textarea', { attrs: { rows: 2, placeholder: options.placeholder ?? '' } })
        : h('input', { attrs: { placeholder: options.placeholder ?? '' } }),
      options.read,
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    const flush = (): void => {
      clearTimeout(timer);
      this.flushers.delete(flush);
      if (control.value !== options.read()) options.commit(control.value);
    };
    control.addEventListener('input', () => {
      clearTimeout(timer);
      this.flushers.add(flush);
      timer = setTimeout(flush, TEXT_COMMIT_DELAY_MS);
    });
    control.addEventListener('blur', flush);
    return h(
      'label',
      { class: 'field' },
      h('span', { class: 'field-label' }, options.label),
      control,
      options.hint !== undefined && h('small', {}, options.hint),
    );
  }

  // ── Views ───────────────────────────────────────────────────────────────────

  private draftView(): Child[] {
    const editor = this.editor;
    const draft = () => editor.draft;
    return [
      h('h2', {}, t('editor.draftTitle')),
      h('p', { class: 'muted' }, t('editor.draftHint')),
      this.section(() => this.inheritedBlock()),
      this.text({
        label: t('editor.goal'),
        multiline: true,
        placeholder: t('editor.notSpecified'),
        read: () => draft().goal,
        commit: (goal) => editor.apply({ op: 'updateDraft', goal }),
      }),
      this.text({
        label: t('editor.changeSummary'),
        multiline: true,
        placeholder: t('editor.notSpecified'),
        read: () => draft().changeSummary,
        commit: (changeSummary) => editor.apply({ op: 'updateDraft', changeSummary }),
      }),
      this.text({
        label: t('editor.globalAcceptance'),
        multiline: true,
        hint: t('editor.onePerLine'),
        placeholder: t('editor.notSpecified'),
        read: () => draft().acceptance.join('\n'),
        commit: (text) => editor.apply({ op: 'updateDraft', acceptance: linesOf(text) }),
      }),
      this.text({
        label: t('editor.openQuestions'),
        multiline: true,
        hint: t('editor.onePerLine'),
        placeholder: t('editor.none'),
        read: () => draft().openQuestions.join('\n'),
        commit: (text) => editor.apply({ op: 'updateDraft', openQuestions: linesOf(text) }),
      }),
      h('h3', {}, t('editor.conflicts')),
      this.section(() => this.conflictsBlock(null)),
    ];
  }

  private multiView(): Child[] {
    const editor = this.editor;
    const ids = editor.selection;
    const button = (label: string, action: () => void) =>
      h('button', { attrs: { type: 'button', disabled: editor.readOnly }, onClick: action }, label);
    return [
      h('h2', {}, t('editor.multiSelected', { count: ids.length })),
      h(
        'div',
        { class: 'row' },
        button(t('editor.hide'), () => {
          editor.setHidden(ids, true);
        }),
        button(t('editor.show'), () => {
          editor.setHidden(ids, false);
        }),
        button(t('editor.duplicate'), () => {
          editor.duplicateSelection();
        }),
      ),
      h('p', { class: 'muted' }, t('editor.multiHint')),
    ];
  }

  private componentView(componentId: string): Child[] {
    const editor = this.editor;
    const component = (): DraftComponent | undefined => findComponent(editor.draft, componentId);

    const kindSelect = this.bind(
      h(
        'select',
        {
          onChange: (event) => {
            const kind = (event.currentTarget as HTMLSelectElement).value;
            const match = COMPONENT_KINDS.find((candidate) => candidate === kind);
            if (match) editor.apply({ op: 'updateComponent', componentId, kind: match });
          },
        },
        COMPONENT_KINDS.map((kind) => h('option', { attrs: { value: kind } }, t(`kind.${kind}`))),
      ),
      () => component()?.kind ?? 'component',
    );

    const groups = SPEC_GROUP_NAMES.map((group) => {
      const details = h(
        'details',
        {
          class: 'spec-group',
          props: { open: this.openGroups.has(group) },
          onToggle: () => {
            if (details.open) this.openGroups.add(group);
            else this.openGroups.delete(group);
          },
        },
        h(
          'summary',
          {},
          t(`group.${group}`),
          ' ',
          this.section(() => {
            const count = Object.keys(component()?.spec[group] ?? {}).length;
            return [h('span', { class: 'muted' }, `${String(count)}/${String(SPEC_GROUPS[group].length)}`)];
          }),
        ),
        group === 'general' && [
          this.text({
            label: t('editor.name'),
            read: () => component()?.name ?? '',
            commit: (name) => {
              if (name.trim() !== '') editor.apply({ op: 'updateComponent', componentId, name });
            },
          }),
          h('label', { class: 'field' }, h('span', { class: 'field-label' }, t('editor.kind')), kindSelect),
        ],
        SPEC_GROUPS[group].map((field) => this.specField(componentId, group, field)),
      );
      return details;
    });

    return [
      h(
        'h2',
        {},
        this.section(() => [component()?.name ?? '']),
      ),
      this.section(() => this.regionBlock(componentId)),
      this.section(() => this.hintsBlock(componentId)),
      ...groups,
      h('h3', {}, t('editor.relations')),
      this.section(() => this.relationsBlock(componentId)),
      h('h3', {}, t('editor.conflicts')),
      this.section(() => this.conflictsBlock(componentId)),
    ];
  }

  /** One requirement field: text + origin. Empty means "not specified" (no defaults). */
  private specField(componentId: string, group: SpecGroup, field: string): HTMLElement {
    const editor = this.editor;
    const current = () => {
      const component = findComponent(editor.draft, componentId);
      return component ? specValueOf(component, group, field) : undefined;
    };
    const origin = this.bind(
      h(
        'select',
        {
          class: 'origin',
          attrs: { 'aria-label': t('editor.origin') },
          onChange: (event) => {
            const value = current();
            const selected = (event.currentTarget as HTMLSelectElement).value as SpecOrigin;
            if (value)
              editor.apply({
                op: 'setSpecValue',
                componentId,
                group,
                field,
                value: { ...value, origin: selected },
              });
          },
        },
        SPEC_ORIGINS.map((value) => h('option', { attrs: { value } }, t(`origin.${value}`))),
      ),
      () => current()?.origin ?? 'user',
    );
    const label = t(`spec.${group}.${field}` as MessageKey);
    const element = this.text({
      label,
      multiline: true,
      placeholder: t('editor.notSpecified'),
      read: () => current()?.value ?? '',
      commit: (text) => {
        const previous = current();
        const value =
          text.trim() === '' ? null : { value: text, origin: previous?.origin ?? ('user' as const) };
        editor.apply({ op: 'setSpecValue', componentId, group, field, value });
      },
    });
    // The origin only means something for a specified value; unspecified shows just the badge.
    const status = this.section(() => {
      const unspecified = current() === undefined;
      origin.hidden = unspecified;
      return unspecified ? [h('span', { class: 'badge muted' }, t('editor.notSpecified'))] : [];
    });
    element.querySelector('.field-label')?.after(status, origin);
    return element;
  }

  /** Completeness issues of this component (the release dialog shows all of them). */
  private hintsBlock(componentId: string): Child[] {
    const draft = this.editor.draft;
    const report = assessCompleteness(draft, {
      assignment: 'confirmed',
      screenshotIds: this.editor.sessionScreenshotIds,
    });
    const issues = [...report.blocking, ...report.warnings].filter(
      (issue) => issue.componentId === componentId,
    );
    if (issues.length === 0) return [];
    const adopt = (issue: CompletenessIssue): Child =>
      issue.code === 'inherited_region' &&
      !this.editor.readOnly &&
      h(
        'button',
        {
          class: 'link',
          attrs: { type: 'button' },
          onClick: () => {
            // Release the focus first, so the section can be rebuilt.
            (document.activeElement as HTMLElement | null)?.blur();
            this.editor.adoptInheritedRegions([componentId]);
          },
        },
        t('editor.adoptRegion'),
      );
    return [
      h(
        'div',
        { class: 'hints' },
        h('strong', {}, t('editor.hints')),
        h(
          'ul',
          {},
          issues.map((issue) =>
            h(
              'li',
              { class: issue.severity === 'blocking' ? 'blocking' : '' },
              issueLabel(issue, draft, false),
              ' ',
              adopt(issue),
            ),
          ),
        ),
      ),
    ];
  }

  /** Revision: regions of the base version that still need checking on the new screenshot. */
  private inheritedBlock(): Child[] {
    const editor = this.editor;
    const pending = editor.draft.components.filter((component) => editor.inheritedRegion(component));
    if (pending.length === 0) return [];
    return [
      h(
        'div',
        { class: 'notice warning inherited' },
        h('p', {}, t('editor.inheritedRegions', { count: pending.length })),
        !editor.readOnly &&
          h(
            'button',
            {
              attrs: { type: 'button' },
              onClick: () => {
                (document.activeElement as HTMLElement | null)?.blur();
                editor.adoptInheritedRegions();
              },
            },
            t('editor.adoptAllRegions'),
          ),
      ),
    ];
  }

  /**
   * Contradictions recorded by the human. With `componentId` only those involving the
   * component (new ones involve it); without, all of them (draft view).
   */
  private conflictsBlock(componentId: string | null): Child[] {
    const editor = this.editor;
    const draft = editor.draft;
    const disabled = editor.readOnly;
    const nameOf = (id: string) => findComponent(draft, id)?.name ?? id;
    const conflicts = draft.conflicts.filter(
      (conflict) => componentId === null || conflict.componentIds.includes(componentId),
    );
    /** Edits from a form: release the focus first so the section can be rebuilt. */
    const applyFromForm = (form: HTMLFormElement, run: () => boolean): void => {
      (document.activeElement as HTMLElement | null)?.blur();
      if (run()) form.reset();
    };

    const item = (conflict: Conflict) => {
      const resolution = h('input', {
        attrs: {
          placeholder: t('editor.resolution'),
          'aria-label': t('editor.resolution'),
          maxlength: 10000,
          required: true,
          disabled,
        },
      });
      const resolveForm = h(
        'form',
        {
          class: 'row',
          onSubmit: (event) => {
            event.preventDefault();
            applyFromForm(resolveForm, () =>
              editor.apply({
                op: 'updateConflict',
                conflictId: conflict.id,
                status: 'resolved',
                resolution: resolution.value,
              }),
            );
          },
        },
        resolution,
        h('button', { attrs: { type: 'submit', disabled } }, t('editor.resolve')),
      );
      return h(
        'li',
        { class: `conflict conflict-${conflict.status}` },
        h(
          'div',
          { class: 'row' },
          h(
            'span',
            { class: `badge ${conflict.status === 'open' ? 'warning' : 'muted'}` },
            t(`conflict.${conflict.status}`),
          ),
          h('span', { class: 'conflict-text' }, conflict.description),
          h(
            'button',
            {
              class: 'link',
              attrs: {
                type: 'button',
                disabled,
                'aria-label': t('editor.removeConflict'),
                title: t('editor.removeConflict'),
              },
              onClick: () => {
                editor.apply({ op: 'deleteConflict', conflictId: conflict.id });
              },
            },
            '✕',
          ),
        ),
        conflict.componentIds.length > 0 &&
          h(
            'div',
            { class: 'conflict-components' },
            conflict.componentIds.map((id) =>
              h(
                'button',
                {
                  class: 'link',
                  attrs: { type: 'button' },
                  onClick: () => {
                    editor.select([id]);
                  },
                },
                nameOf(id),
              ),
            ),
          ),
        conflict.status === 'open'
          ? resolveForm
          : h(
              'div',
              { class: 'row' },
              h('small', {}, `${t('editor.resolution')} ${conflict.resolution}`),
              h(
                'button',
                {
                  class: 'link',
                  attrs: { type: 'button', disabled },
                  onClick: () => {
                    editor.apply({ op: 'updateConflict', conflictId: conflict.id, status: 'open' });
                  },
                },
                t('editor.reopenConflict'),
              ),
            ),
      );
    };

    const description = h('textarea', {
      attrs: {
        rows: 2,
        placeholder: t('editor.conflictDescription'),
        'aria-label': t('editor.conflictDescription'),
        maxlength: 10000,
        required: true,
        disabled,
      },
    });
    const others = draft.components.filter((component) => component.componentId !== componentId);
    const also =
      componentId !== null && others.length > 0
        ? h(
            'select',
            { attrs: { 'aria-label': t('editor.conflictAlso'), disabled } },
            h('option', { attrs: { value: '' } }, t('editor.conflictOnlyThis')),
            others.map((component) =>
              h('option', { attrs: { value: component.componentId } }, component.name),
            ),
          )
        : null;
    const addForm = h(
      'form',
      {
        class: 'conflict-form',
        onSubmit: (event) => {
          event.preventDefault();
          const componentIds =
            componentId === null ? [] : [componentId, ...(also?.value ? [also.value] : [])];
          applyFromForm(addForm, () =>
            editor.apply({
              op: 'addConflict',
              conflictId: newId('conflict'),
              componentIds,
              description: description.value,
            }),
          );
        },
      },
      description,
      also !== null &&
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, t('editor.conflictAlso')), also),
      h('button', { attrs: { type: 'submit', disabled } }, t('editor.addConflict')),
    );

    return [
      conflicts.length === 0
        ? h('p', { class: 'muted' }, t('editor.noConflicts'))
        : h('ul', { class: 'conflicts' }, conflicts.map(item)),
      addForm,
    ];
  }

  private regionBlock(componentId: string): Child[] {
    const editor = this.editor;
    const component = findComponent(editor.draft, componentId);
    const screenshot = editor.activeScreenshot;
    if (!component || screenshot === null) return [];
    const region = regionOn(component, screenshot.id);
    const others = component.regions.length - (region ? 1 : 0);
    const disabled = editor.readOnly;

    if (!region) {
      return [
        h(
          'div',
          { class: 'notice' },
          h('p', {}, t('editor.noRegion')),
          h(
            'button',
            {
              attrs: { type: 'button', disabled },
              onClick: () => {
                editor.setTool('region');
              },
            },
            editor.tool === 'region' ? t('editor.drawingRegion') : t('editor.drawRegion'),
          ),
          others > 0 && h('small', { class: 'muted' }, t('editor.regionsElsewhere', { count: others })),
        ),
      ];
    }
    const number = (key: keyof Rect) =>
      h('input', {
        attrs: { type: 'number', step: 1, min: 0, 'aria-label': t(`editor.rect.${key}`), disabled },
        props: { value: String(region[key]) },
        onChange: (event) => {
          const value = Number((event.currentTarget as HTMLInputElement).value);
          if (Number.isFinite(value)) editor.setRegion(componentId, { ...region, [key]: value });
        },
      });
    return [
      h(
        'div',
        { class: 'region-block' },
        h('span', { class: 'field-label' }, t('editor.region')),
        h(
          'div',
          { class: 'rect-inputs' },
          (['x', 'y', 'width', 'height'] as const).map((key) =>
            h('label', {}, h('small', {}, t(`editor.rect.${key}`)), number(key)),
          ),
        ),
        h(
          'div',
          { class: 'row' },
          h(
            'button',
            {
              attrs: { type: 'button', disabled },
              onClick: () => {
                editor.setTool('region');
              },
            },
            t('editor.redrawRegion'),
          ),
          h(
            'button',
            {
              class: 'secondary',
              attrs: { type: 'button', disabled },
              onClick: () => {
                editor.setRegion(componentId, null);
              },
            },
            t('editor.removeRegion'),
          ),
        ),
        others > 0 && h('small', { class: 'muted' }, t('editor.regionsElsewhere', { count: others })),
      ),
    ];
  }

  private relationsBlock(componentId: string): Child[] {
    const editor = this.editor;
    const draft = editor.draft;
    const nameOf = (id: string) => findComponent(draft, id)?.name ?? id;
    const related = draft.relations.filter(
      (relation) => relation.fromComponentId === componentId || relation.toComponentId === componentId,
    );
    const others = draft.components.filter((component) => component.componentId !== componentId);
    const disabled = editor.readOnly;

    const kindSelect = h(
      'select',
      { attrs: { 'aria-label': t('editor.relationKind'), disabled } },
      RELATION_KINDS.map((kind) => h('option', { attrs: { value: kind } }, t(`relation.${kind}`))),
    );
    const targetSelect = h(
      'select',
      { attrs: { 'aria-label': t('editor.relationTarget'), disabled } },
      others.map((component) => h('option', { attrs: { value: component.componentId } }, component.name)),
    );
    const description = h('input', {
      attrs: { placeholder: t('editor.relationDescription'), maxlength: 2000, disabled },
    });

    return [
      related.length === 0
        ? h('p', { class: 'muted' }, t('editor.noRelations'))
        : h(
            'ul',
            { class: 'relations' },
            related.map((relation) =>
              h(
                'li',
                {},
                h('span', {}, nameOf(relation.fromComponentId)),
                ' → ',
                h(
                  'select',
                  {
                    class: 'relation-kind',
                    attrs: { 'aria-label': t('editor.relationKind'), disabled },
                    onChange: (event) => {
                      const value = (event.currentTarget as HTMLSelectElement).value;
                      const kind = RELATION_KINDS.find((candidate) => candidate === value);
                      if (kind) editor.apply({ op: 'updateRelation', relationId: relation.id, kind });
                    },
                  },
                  RELATION_KINDS.map((kind) =>
                    h(
                      'option',
                      { attrs: { value: kind, selected: kind === relation.kind } },
                      t(`relation.${kind}`),
                    ),
                  ),
                ),
                ' → ',
                h('span', {}, nameOf(relation.toComponentId)),
                relation.description !== '' && h('small', { class: 'muted' }, ` · ${relation.description}`),
                h(
                  'button',
                  {
                    class: 'link',
                    attrs: { type: 'button', disabled, 'aria-label': t('editor.removeRelation') },
                    onClick: () => {
                      editor.apply({ op: 'deleteRelation', relationId: relation.id });
                    },
                  },
                  '✕',
                ),
              ),
            ),
          ),
      others.length > 0 &&
        h(
          'form',
          {
            class: 'relation-form',
            onSubmit: (event) => {
              event.preventDefault();
              const kind = RELATION_KINDS.find((candidate) => candidate === kindSelect.value);
              if (!kind || targetSelect.value === '') return;
              editor.apply({
                op: 'addRelation',
                relationId: newId('relation'),
                fromComponentId: componentId,
                toComponentId: targetSelect.value,
                kind,
                description: description.value,
              });
            },
          },
          kindSelect,
          targetSelect,
          description,
          h('button', { attrs: { type: 'submit', disabled } }, t('editor.addRelation')),
        ),
    ];
  }
}
