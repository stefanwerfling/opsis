import { de } from './de.js';
import { en, type MessageKey, type Messages } from './en.js';

export const UI_LANGUAGES = ['en', 'de'] as const;
export type UiLanguage = (typeof UI_LANGUAGES)[number];

const CATALOGUES: Readonly<Record<UiLanguage, Messages>> = { en, de };
const STORAGE_KEY = 'opsis.uiLanguage';

export type MessageParams = Readonly<Record<string, string | number>>;

/** Replaces `{name}` placeholders; unknown placeholders stay visible to make mistakes obvious. */
export const interpolate = (template: string, params: MessageParams = {}): string =>
  template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });

export const translate = (language: UiLanguage, key: MessageKey, params?: MessageParams): string =>
  interpolate(CATALOGUES[language][key], params);

export const isUiLanguage = (value: unknown): value is UiLanguage =>
  typeof value === 'string' && (UI_LANGUAGES as readonly string[]).includes(value);

/** Stored choice → browser languages → English. */
export const detectLanguage = (stored: string | null, browserLanguages: readonly string[]): UiLanguage => {
  if (isUiLanguage(stored)) return stored;
  for (const tag of browserLanguages) {
    const base = tag.toLowerCase().split('-')[0];
    if (isUiLanguage(base)) return base;
  }
  return 'en';
};

const readStored = (): string | null => {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
};

let current: UiLanguage = 'en';
const listeners = new Set<() => void>();

export const initLanguage = (): void => {
  current = detectLanguage(readStored(), navigator.languages);
  document.documentElement.lang = current;
};

export const getLanguage = (): UiLanguage => current;

export const setLanguage = (language: UiLanguage): void => {
  if (language === current) return;
  current = language;
  document.documentElement.lang = language;
  try {
    localStorage.setItem(STORAGE_KEY, language);
  } catch {
    // Storage may be unavailable (private mode); the choice then lasts for this page only.
  }
  for (const listener of listeners) listener();
};

export const onLanguageChange = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const t = (key: MessageKey, params?: MessageParams): string => translate(current, key, params);

export type { MessageKey };
