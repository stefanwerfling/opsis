import { describe, expect, it } from 'vitest';
import { LOCAL_HUMAN, SYSTEM, type Actor } from './actor.js';
import { OpsisError } from './errors.js';
import {
  assertTransition,
  canTransition,
  SESSION_STATUSES,
  SESSION_TRANSITIONS,
  type SessionStatus,
} from './session.js';

const agent: Actor = { type: 'agent', id: 'agt_owner', name: 'owner' };
const otherAgent: Actor = { type: 'agent', id: 'agt_other', name: 'other' };
const session = (status: SessionStatus) => ({ id: 'ses_x', status, agentId: agent.id });

const codeOf = (fn: () => void): string | undefined => {
  try {
    fn();
    return undefined;
  } catch (error) {
    return error instanceof OpsisError ? error.code : 'UNEXPECTED';
  }
};

describe('session status machine', () => {
  it('defines transitions for every status and terminal states have none', () => {
    for (const status of SESSION_STATUSES) expect(SESSION_TRANSITIONS[status]).toBeDefined();
    expect(SESSION_TRANSITIONS.delivered).toEqual([]);
    expect(SESSION_TRANSITIONS.cancelled).toEqual([]);
    expect(SESSION_TRANSITIONS.failed).toEqual([]);
  });

  it('follows the documented happy path', () => {
    const path: SessionStatus[] = [
      'created',
      'uploading',
      'awaiting_review',
      'in_progress',
      'ready',
      'delivered',
    ];
    for (let i = 0; i < path.length - 1; i += 1) {
      expect(canTransition(path[i] as SessionStatus, path[i + 1] as SessionStatus)).toBe(true);
    }
  });

  it('rejects skipping the human review', () => {
    expect(
      codeOf(() => {
        assertTransition(session('awaiting_review'), 'ready', LOCAL_HUMAN);
      }),
    ).toBe('INVALID_TRANSITION');
    expect(
      codeOf(() => {
        assertTransition(session('delivered'), 'in_progress', LOCAL_HUMAN);
      }),
    ).toBe('INVALID_TRANSITION');
  });

  it('only lets a human release, start or reopen review (principle 10)', () => {
    expect(
      codeOf(() => {
        assertTransition(session('in_progress'), 'ready', agent);
      }),
    ).toBe('FORBIDDEN_ACTOR');
    expect(
      codeOf(() => {
        assertTransition(session('in_progress'), 'ready', SYSTEM);
      }),
    ).toBe('FORBIDDEN_ACTOR');
    expect(
      codeOf(() => {
        assertTransition(session('awaiting_review'), 'in_progress', agent);
      }),
    ).toBe('FORBIDDEN_ACTOR');
    expect(
      codeOf(() => {
        assertTransition(session('ready'), 'in_progress', agent);
      }),
    ).toBe('FORBIDDEN_ACTOR');
    expect(
      codeOf(() => {
        assertTransition(session('in_progress'), 'ready', LOCAL_HUMAN);
      }),
    ).toBeUndefined();
    expect(
      codeOf(() => {
        assertTransition(session('ready'), 'in_progress', LOCAL_HUMAN);
      }),
    ).toBeUndefined();
  });

  it('lets only the owning agent or a human cancel', () => {
    expect(
      codeOf(() => {
        assertTransition(session('awaiting_review'), 'cancelled', otherAgent);
      }),
    ).toBe('FORBIDDEN_ACTOR');
    expect(
      codeOf(() => {
        assertTransition(session('awaiting_review'), 'cancelled', agent);
      }),
    ).toBeUndefined();
    expect(
      codeOf(() => {
        assertTransition(session('in_progress'), 'cancelled', LOCAL_HUMAN);
      }),
    ).toBeUndefined();
  });

  it('marks delivery by an agent but not by a human', () => {
    expect(
      codeOf(() => {
        assertTransition(session('ready'), 'delivered', agent);
      }),
    ).toBeUndefined();
    expect(
      codeOf(() => {
        assertTransition(session('ready'), 'delivered', LOCAL_HUMAN);
      }),
    ).toBe('FORBIDDEN_ACTOR');
  });
});
