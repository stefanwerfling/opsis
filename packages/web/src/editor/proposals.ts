import {
  SPEC_GROUP_NAMES,
  type Draft,
  type DraftComponent,
  type DraftOperation,
  type SpecGroup,
} from '@opsis/core/browser';

/**
 * Agent proposals carry the origin `auto_detected`. Confirming one keeps the text and makes
 * the human its author (`user`); the completeness check then no longer warns about it.
 */
const unconfirmedValues = (component: DraftComponent) =>
  SPEC_GROUP_NAMES.flatMap((group: SpecGroup) =>
    Object.entries(component.spec[group] ?? {}).flatMap(([field, value]) =>
      value.origin === 'auto_detected' ? [{ group, field, value }] : [],
    ),
  );

export const unconfirmedCount = (component: DraftComponent): number => unconfirmedValues(component).length;

/** Operations that confirm all proposals of the given components (default: all components). */
export const confirmOperations = (draft: Draft, componentIds?: readonly string[]): DraftOperation[] => {
  const wanted = componentIds === undefined ? undefined : new Set(componentIds);
  return draft.components
    .filter((component) => wanted === undefined || wanted.has(component.componentId))
    .flatMap((component) =>
      unconfirmedValues(component).map(({ group, field, value }): DraftOperation => ({
        op: 'setSpecValue',
        componentId: component.componentId,
        group,
        field,
        value: { ...value, origin: 'user' },
      })),
    );
};
