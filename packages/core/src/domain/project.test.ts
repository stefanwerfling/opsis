import { describe, expect, it } from 'vitest';
import { hasIdPrefix, newId, ulid } from './ids.js';
import { CreateProjectInputSchema, slugify } from './project.js';

describe('slugify', () => {
  it.each([
    ['My Application', 'my-application'],
    ['Größe & Übersicht', 'groesse-uebersicht'],
    ['  --Café--  ', 'cafe'],
    ['!!!', 'project'],
  ])('%j → %j', (name, slug) => {
    expect(slugify(name)).toBe(slug);
  });
});

describe('CreateProjectInputSchema', () => {
  it('applies defaults', () => {
    expect(CreateProjectInputSchema.parse({ name: ' Shop ' })).toEqual({
      name: 'Shop',
      description: '',
      promptLanguage: 'en',
      metadata: {},
    });
  });

  it('rejects unknown fields and oversized metadata', () => {
    expect(CreateProjectInputSchema.safeParse({ name: 'x', foo: 1 }).success).toBe(false);
    expect(
      CreateProjectInputSchema.safeParse({ name: 'x', metadata: { big: 'x'.repeat(70_000) } }).success,
    ).toBe(false);
  });
});

describe('ids', () => {
  it('creates prefixed, time-sortable ULIDs', () => {
    const a = newId('project', 1_700_000_000_000);
    const b = newId('project', 1_700_000_000_001);
    expect(hasIdPrefix(a, 'project')).toBe(true);
    expect(hasIdPrefix(a, 'session')).toBe(false);
    expect(a < b).toBe(true);
    expect(ulid()).toHaveLength(26);
  });

  it('keeps creation order within the same millisecond', () => {
    const ids = Array.from({ length: 1000 }, () => newId('session', 1_700_000_000_000));
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
