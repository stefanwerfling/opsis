import type { z } from 'zod';
import type { Actor } from '../domain/actor.js';
import { OpsisError } from '../domain/errors.js';
import type { DomainEvent } from '../domain/events.js';
import { newId } from '../domain/ids.js';
import type { AccessPolicy } from './access-policy.js';
import type {
  BlobStore,
  Clock,
  EventPublisher,
  Hasher,
  ImageInspector,
  Repositories,
  Transactor,
} from './ports.js';

/** Everything a use case needs. Assembled once in the composition root. */
export interface AppContext {
  readonly repos: Repositories;
  readonly tx: Transactor;
  readonly clock: Clock;
  readonly events: EventPublisher;
  readonly access: AccessPolicy;
  readonly images: ImageInspector;
  readonly blobs: BlobStore;
  readonly hash: Hasher;
}

/** Validates untrusted input; any adapter (REST, MCP) gets the same VALIDATION error shape. */
export const parseInput = <S extends z.ZodType>(schema: S, input: unknown): z.output<S> => {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new OpsisError('VALIDATION', 'Invalid input', {
      issues: result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    });
  }
  return result.data;
};

export interface UnitOfWork {
  readonly now: string;
  emit(event: DomainEvent): void;
  audit(entry: {
    projectId: string | null;
    entityType: string;
    entityId: string;
    action: string;
    data?: Record<string, unknown>;
  }): void;
}

/**
 * Runs `work` in a transaction. Audit entries are written inside the transaction;
 * domain events are published only after a successful commit.
 */
export const commit = <T>(ctx: AppContext, actor: Actor, work: (uow: UnitOfWork) => T): T => {
  const events: DomainEvent[] = [];
  const now = ctx.clock.now();
  const result = ctx.tx.run(() =>
    work({
      now,
      emit: (event) => events.push(event),
      audit: (entry) => {
        ctx.repos.audit.append({
          id: newId('audit'),
          at: now,
          actor,
          projectId: entry.projectId,
          entityType: entry.entityType,
          entityId: entry.entityId,
          action: entry.action,
          data: entry.data ?? {},
        });
      },
    }),
  );
  for (const event of events) ctx.events.publish(event);
  return result;
};
