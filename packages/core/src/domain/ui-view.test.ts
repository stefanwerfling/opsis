import { describe, expect, it } from 'vitest';
import { OpsisError } from './errors.js';
import {
  defaultNameFromPath,
  deriveUiIdFromPath,
  normalizeUiPath,
  UiIdSchema,
  uniqueUiId,
} from './ui-view.js';

describe('normalizeUiPath', () => {
  it.each([
    ['/dashboard', '/dashboard'],
    ['/', '/'],
    ['/settings/profile/', '/settings/profile'],
    ['//admin///users', '/admin/users'],
    ['/admin/users/:id', '/admin/users/:id'],
    ['  /login  ', '/login'],
    ['/files/*', '/files/*'],
    ['/über-uns', '/über-uns'],
  ])('normalizes %j to %j', (input, expected) => {
    expect(normalizeUiPath(input)).toBe(expected);
  });

  it.each(['dashboard', '/a/../b', '/a/./b', '/a?x=1', '/a#top', '/a b', '/a\\b', '/a/:1x', ''])(
    'rejects %j',
    (input) => {
      expect(() => normalizeUiPath(input)).toThrow(OpsisError);
    },
  );
});

describe('deriveUiIdFromPath', () => {
  it.each([
    ['/dashboard', 'ui-dashboard'],
    ['/admin/users/:id', 'ui-admin-users-id'],
    ['/settings/security', 'ui-settings-security'],
    ['/', 'ui-root'],
    ['/über-uns', 'ui-ueber-uns'],
    ['/Café_Menü', 'ui-cafe-menue'],
  ])('%s → %s', (path, expected) => {
    const uiId = deriveUiIdFromPath(path);
    expect(uiId).toBe(expected);
    expect(UiIdSchema.safeParse(uiId).success).toBe(true);
  });

  it('keeps derived ids within the allowed length', () => {
    const uiId = deriveUiIdFromPath(`/${'segment/'.repeat(40)}end`);
    expect(UiIdSchema.safeParse(uiId).success).toBe(true);
  });
});

describe('uniqueUiId', () => {
  it('appends a counter on collision', () => {
    const taken = new Set(['ui-dashboard', 'ui-dashboard-2']);
    expect(uniqueUiId('ui-dashboard', (c) => taken.has(c))).toBe('ui-dashboard-3');
    expect(uniqueUiId('ui-login', (c) => taken.has(c))).toBe('ui-login');
  });
});

describe('UiIdSchema', () => {
  it.each(['ui-dashboard-main', 'ui-a1'])('accepts %s', (id) => {
    expect(UiIdSchema.safeParse(id).success).toBe(true);
  });
  it.each(['dashboard', 'ui-', 'ui-Dash', 'ui--x', 'ui-x-'])('rejects %s', (id) => {
    expect(UiIdSchema.safeParse(id).success).toBe(false);
  });
});

describe('defaultNameFromPath', () => {
  it('builds a readable name', () => {
    expect(defaultNameFromPath('/settings/user-profile')).toBe('Settings / User profile');
    expect(defaultNameFromPath('/')).toBe('Root');
  });
});
