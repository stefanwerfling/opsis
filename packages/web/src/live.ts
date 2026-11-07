import type { DomainEvent } from '@opsis/core';

/** Every domain event type the server streams; the compiler checks this against `DomainEvent`. */
const EVENT_TYPES = [
  'ProjectChanged',
  'UiViewChanged',
  'ScreenshotSubmitted',
  'SessionChanged',
  'SessionStatusChanged',
] as const satisfies readonly DomainEvent['type'][];

type MissingEventType = Exclude<DomainEvent['type'], (typeof EVENT_TYPES)[number]>;
type AssertNever<T extends never> = T;
/** Fails to compile when a new domain event type is added but not subscribed here. */
export type AllEventTypesSubscribed = AssertNever<MissingEventType>;

type Listener = (event: DomainEvent) => void;
type StatusListener = (connected: boolean) => void;

const listeners = new Set<Listener>();
const statusListeners = new Set<StatusListener>();
let connected = false;

const setConnected = (value: boolean): void => {
  if (value === connected) return;
  connected = value;
  for (const listener of statusListeners) listener(value);
};

const parseEvent = (data: unknown): DomainEvent | null => {
  if (typeof data !== 'string') return null;
  try {
    const value: unknown = JSON.parse(data);
    if (typeof value === 'object' && value !== null && 'type' in value && 'projectId' in value) {
      return value as DomainEvent;
    }
  } catch {
    // ignore malformed frames
  }
  return null;
};

/** Opens the SSE stream. EventSource reconnects on its own after network errors. */
export const connectLiveEvents = (url = '/api/v1/events'): (() => void) => {
  const source = new EventSource(url);
  source.addEventListener('open', () => {
    setConnected(true);
  });
  source.addEventListener('error', () => {
    setConnected(false);
  });
  for (const type of EVENT_TYPES) {
    source.addEventListener(type, (message) => {
      const event = parseEvent(message.data);
      if (event === null) return;
      for (const listener of listeners) listener(event);
    });
  }
  return () => {
    source.close();
    setConnected(false);
  };
};

export const onLiveEvent = (listener: Listener): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const onLiveStatus = (listener: StatusListener): (() => void) => {
  statusListeners.add(listener);
  listener(connected);
  return () => statusListeners.delete(listener);
};
