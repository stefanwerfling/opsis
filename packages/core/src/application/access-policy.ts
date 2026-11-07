import type { Actor } from '../domain/actor.js';
import { OpsisError } from '../domain/errors.js';
import type { AgentGrantRepository } from './ports.js';

/**
 * Project-level access control (architecture 04 §4). Lives in the application layer so it
 * applies equally to REST, MCP tools, MCP resources and future adapters.
 *
 * Foreign IDs yield NOT_FOUND instead of FORBIDDEN so that IDs of other projects cannot
 * be probed.
 */
export class AccessPolicy {
  readonly #grants: AgentGrantRepository;

  constructor(grants: AgentGrantRepository) {
    this.#grants = grants;
  }

  canAccessProject(actor: Actor, projectId: string): boolean {
    switch (actor.type) {
      case 'human':
      case 'system':
        return true; // single-user deployment (decision E1)
      case 'agent':
        return this.#grants.hasGrant(actor.id, projectId);
    }
  }

  assertProjectAccess(actor: Actor, projectId: string, entity = 'project', id = projectId): void {
    if (!this.canAccessProject(actor, projectId)) {
      throw new OpsisError('NOT_FOUND', `${entity} "${id}" not found`);
    }
  }

  /** `undefined` = unrestricted; otherwise the project IDs the actor may see. */
  visibleProjectIds(actor: Actor): string[] | undefined {
    return actor.type === 'agent' ? this.#grants.listProjectIds(actor.id) : undefined;
  }
}
