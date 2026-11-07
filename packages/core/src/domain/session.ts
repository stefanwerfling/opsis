import type { Actor } from './actor.js';
import type { Timestamp } from './common.js';
import { OpsisError } from './errors.js';

export const SESSION_STATUSES = [
  'created',
  'uploading',
  'awaiting_review',
  'in_progress',
  'ready',
  'delivered',
  'cancelled',
  'failed',
] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

export const SESSION_INTENTS = ['create', 'revise'] as const;
export type SessionIntent = (typeof SESSION_INTENTS)[number];

/**
 * `needs_confirmation`: OPSIS could not assign the screenshot to a UI view unambiguously
 * (architecture 04 §3). Release is blocked until a human confirms the assignment.
 */
export const SESSION_ASSIGNMENTS = ['confirmed', 'needs_confirmation'] as const;
export type SessionAssignment = (typeof SESSION_ASSIGNMENTS)[number];

export interface Session {
  readonly id: string;
  readonly projectId: string;
  readonly uiViewId: string;
  readonly agentId: string | null;
  readonly agentSessionRef: string | null;
  readonly intent: SessionIntent;
  readonly title: string;
  readonly status: SessionStatus;
  readonly assignment: SessionAssignment;
  /** Path change suggested by the submitter that a human still has to confirm. */
  readonly proposedPath: string | null;
  /** Why the assignment needs confirmation (shown to the human). */
  readonly assignmentNote: string | null;
  readonly baseVersionId: string | null;
  readonly resultVersionId: string | null;
  readonly statusReason: string | null;
  readonly rowVersion: number;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
}

/** The single source of truth for allowed status transitions (architecture 04 §1). */
export const SESSION_TRANSITIONS: Readonly<Record<SessionStatus, readonly SessionStatus[]>> = {
  created: ['uploading', 'failed', 'cancelled'],
  uploading: ['awaiting_review', 'failed', 'cancelled'],
  awaiting_review: ['in_progress', 'cancelled'],
  in_progress: ['ready', 'cancelled'],
  ready: ['delivered', 'in_progress', 'cancelled'],
  delivered: [],
  cancelled: [],
  failed: [],
};

export const TERMINAL_STATUSES: readonly SessionStatus[] = ['delivered', 'cancelled', 'failed'];
export const EDITABLE_STATUSES: readonly SessionStatus[] = ['awaiting_review', 'in_progress'];

export const isTerminal = (status: SessionStatus): boolean => TERMINAL_STATUSES.includes(status);
export const isEditable = (status: SessionStatus): boolean => EDITABLE_STATUSES.includes(status);

export const canTransition = (from: SessionStatus, to: SessionStatus): boolean =>
  SESSION_TRANSITIONS[from].includes(to);

/**
 * Actor rules on top of the transition table. Most importantly, only a human may
 * release a specification or start/reopen review (principle 10).
 */
const isActorAllowed = (session: Pick<Session, 'agentId'>, to: SessionStatus, actor: Actor): boolean => {
  switch (to) {
    case 'in_progress':
    case 'ready':
      return actor.type === 'human';
    case 'cancelled':
      return actor.type === 'human' || (actor.type === 'agent' && actor.id === session.agentId);
    case 'delivered':
      return actor.type === 'agent' || actor.type === 'system';
    case 'uploading':
    case 'awaiting_review':
    case 'failed':
      // Upload pipeline steps: performed on behalf of whoever submitted the screenshot.
      return true;
    case 'created':
      return false;
  }
};

export const assertTransition = (
  session: Pick<Session, 'id' | 'status' | 'agentId'>,
  to: SessionStatus,
  actor: Actor,
): void => {
  if (!canTransition(session.status, to)) {
    throw new OpsisError('INVALID_TRANSITION', `Session cannot change from "${session.status}" to "${to}"`, {
      sessionId: session.id,
      from: session.status,
      to,
      allowed: SESSION_TRANSITIONS[session.status],
    });
  }
  if (!isActorAllowed(session, to, actor)) {
    throw new OpsisError('FORBIDDEN_ACTOR', `A ${actor.type} may not change a session to "${to}"`, {
      sessionId: session.id,
      to,
      actorType: actor.type,
    });
  }
};
