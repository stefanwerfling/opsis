/**
 * Prefixed ULIDs: lexicographically sortable by creation time and self-describing
 * (`prj_01J…`). Uses Web Crypto, which is available in Node.js and browsers.
 */
export const ID_PREFIXES = {
  project: 'prj',
  uiView: 'uiv',
  uiPathChange: 'upc',
  screenshot: 'scr',
  session: 'ses',
  sessionEvent: 'sev',
  component: 'cmp',
  relation: 'rel',
  conflict: 'cfl',
  uiVersion: 'uvr',
  specRevision: 'spr',
  componentRevision: 'cmr',
  promptVersion: 'prm',
  agent: 'agt',
  uploadSlot: 'upl',
  audit: 'aud',
} as const;

export type IdKind = keyof typeof ID_PREFIXES;

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

const encodeTime = (time: number): string => {
  let out = '';
  let rest = time;
  for (let i = 0; i < 10; i += 1) {
    out = CROCKFORD.charAt(rest % 32) + out;
    rest = Math.floor(rest / 32);
  }
  return out;
};

const randomDigits = (): number[] => {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte % 32);
};

let lastTime = -1;
let lastRandom: number[] = [];

/** Increments a base-32 digit array; returns false on overflow. */
const increment = (digits: number[]): boolean => {
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    const digit = digits[i] ?? 0;
    if (digit < 31) {
      digits[i] = digit + 1;
      return true;
    }
    digits[i] = 0;
  }
  return false;
};

/**
 * Monotonic ULID: IDs created within the same millisecond keep their creation order,
 * so sorting by ID equals sorting by creation even under high throughput.
 */
export const ulid = (time: number = Date.now()): string => {
  if (time === lastTime && increment(lastRandom)) {
    // same millisecond: lastRandom was incremented in place
  } else {
    lastTime = time;
    lastRandom = randomDigits();
  }
  return encodeTime(time) + lastRandom.map((digit) => CROCKFORD.charAt(digit)).join('');
};

export const newId = (kind: IdKind, time?: number): string => `${ID_PREFIXES[kind]}_${ulid(time)}`;

export const ID_PATTERN = /^[a-z]{3}_[0-9A-HJKMNP-TV-Z]{26}$/;

export const hasIdPrefix = (id: string, kind: IdKind): boolean =>
  ID_PATTERN.test(id) && id.startsWith(`${ID_PREFIXES[kind]}_`);
