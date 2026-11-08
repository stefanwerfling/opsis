/**
 * Writing the immutable component history of a specification revision (architecture 05
 * §2, steps 4 and 6). Shared by the release and the ZIP import.
 */
import { newId } from '../domain/ids.js';
import { canonicalJson } from '../domain/specification/canonical-json.js';
import { componentContent, type SpecSnapshot } from '../domain/specification/snapshot.js';
import type { AppContext } from './context.js';

/** Component revisions, deduplicated by (component id, content hash). Returns id per component. */
export const storeComponentRevisions = (
  ctx: AppContext,
  snapshot: SpecSnapshot,
  now: string,
): Map<string, string> => {
  const ids = new Map<string, string>();
  for (const component of snapshot.components) {
    const content = canonicalJson(componentContent(component));
    const contentSha256 = ctx.hash.sha256(content);
    let revision = ctx.repos.versions.findComponentRevision(component.componentId, contentSha256);
    if (!revision) {
      revision = {
        id: newId('componentRevision'),
        componentId: component.componentId,
        contentSha256,
        content,
        createdAt: now,
      };
      ctx.repos.versions.insertComponentRevision(revision);
    }
    ids.set(component.componentId, revision.id);
  }
  return ids;
};

/** The tree of a spec revision: which component revision sits where. */
export const storeComponentTree = (
  ctx: AppContext,
  specRevisionId: string,
  snapshot: SpecSnapshot,
  revisionIds: ReadonlyMap<string, string>,
): void => {
  for (const component of snapshot.components) {
    ctx.repos.versions.insertSpecRevisionComponent({
      specRevisionId,
      componentRevisionId: revisionIds.get(component.componentId) ?? '',
      componentId: component.componentId,
      parentComponentId: component.parentId,
      order: component.order,
    });
  }
};
