import type { Clock } from '@opsis/core';

export const systemClock: Clock = { now: () => new Date().toISOString() };
