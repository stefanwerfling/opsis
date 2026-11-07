/** Who performs an operation. Every write is attributed to an actor (audit, status events). */
export type Actor =
  | { readonly type: 'human'; readonly id: string }
  | { readonly type: 'agent'; readonly id: string; readonly name: string }
  | { readonly type: 'system'; readonly id: string };

/** OPSIS v1 is single-user (decision E1): the local human user. */
export const LOCAL_HUMAN: Actor = { type: 'human', id: 'local' };
export const SYSTEM: Actor = { type: 'system', id: 'opsis' };

export const actorRef = (actor: Actor): string => `${actor.type}:${actor.id}`;
