import { describe, expect, it } from 'vitest';
import { ApiError, createApi, toApiError, type Fetch } from './api.js';
import { de } from './i18n/de.js';
import { en } from './i18n/en.js';
import { detectLanguage, interpolate, translate } from './i18n/i18n.js';
import { matchRoute, pathTo } from './router.js';

describe('router', () => {
  it('matches patterns and decodes parameters', () => {
    expect(matchRoute('/', '/')).toEqual({});
    expect(matchRoute('/projects/:projectId', '/projects/prj_1')).toEqual({ projectId: 'prj_1' });
    expect(matchRoute('/projects/:projectId/ui/:uiId', '/projects/p/ui/ui-%C3%BCber')).toEqual({
      projectId: 'p',
      uiId: 'ui-über',
    });
    expect(matchRoute('/projects/:projectId', '/projects/p/')).toEqual({ projectId: 'p' });
  });

  it('rejects other shapes and malformed encodings', () => {
    expect(matchRoute('/projects/:projectId', '/projects')).toBeNull();
    expect(matchRoute('/projects/:projectId', '/sessions/x')).toBeNull();
    expect(matchRoute('/sessions/:id', '/sessions/%E0%A4%A')).toBeNull();
  });

  it('encodes every dynamic segment', () => {
    expect(pathTo('projects', 'a/b', 'ui', '../x')).toBe('/projects/a%2Fb/ui/..%2Fx');
  });
});

describe('i18n', () => {
  const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

  it('German catalogue has exactly the English keys, non-empty, with the same placeholders', () => {
    expect(Object.keys(de).sort()).toEqual(Object.keys(en).sort());
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect(de[key].trim(), key).not.toBe('');
      expect(placeholders(de[key]), key).toEqual(placeholders(en[key]));
    }
  });

  it('interpolates and keeps unknown placeholders visible', () => {
    expect(interpolate('{a} and {b}', { a: 1 })).toBe('1 and {b}');
    expect(translate('de', 'session.concurrent', { count: 2 })).toBe(
      'Für diese UI-Ansicht gibt es 2 weitere offene Sessions.',
    );
  });

  it('detects the language: stored choice, then browser, then English', () => {
    expect(detectLanguage('de', ['en-US'])).toBe('de');
    expect(detectLanguage(null, ['fr-FR', 'de-AT'])).toBe('de');
    expect(detectLanguage('xx', ['fr'])).toBe('en');
  });
});

describe('api client', () => {
  const recorder = (response: Response) => {
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const fetchImpl: Fetch = (url, init) => {
      calls.push({ url, init });
      return Promise.resolve(response.clone());
    };
    return { calls, api: createApi(fetchImpl) };
  };

  it('encodes path segments and query parameters', async () => {
    const { calls, api } = recorder(Response.json({ sessions: [] }));
    await api.listSessions('prj/1', { uiId: 'ui-a b', statuses: ['ready', 'in_progress'] });
    expect(calls[0]?.url).toBe('/api/v1/projects/prj%2F1/sessions?uiId=ui-a+b&status=ready%2Cin_progress');
  });

  it('sends JSON bodies with a content type', async () => {
    const { calls, api } = recorder(Response.json({ id: 'prj_1' }, { status: 201 }));
    await api.createProject({ name: 'Shop' });
    expect(calls[0]?.init?.method).toBe('POST');
    expect(calls[0]?.init?.body).toBe('{"name":"Shop"}');
    expect(calls[0]?.init?.headers).toMatchObject({ 'content-type': 'application/json' });
  });

  it('turns error bodies into ApiError', async () => {
    const { api } = recorder(
      Response.json(
        { error: { code: 'VALIDATION', message: 'Invalid input', details: { issues: [] } } },
        { status: 400 },
      ),
    );
    const error = await api.getProject('x').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 400, code: 'VALIDATION', message: 'Invalid input' });
  });

  it('copes with non-JSON error responses', async () => {
    const error = await toApiError(
      new Response('<html>bad gateway</html>', { status: 502, statusText: 'Bad Gateway' }),
    );
    expect(error).toMatchObject({ status: 502, code: 'HTTP_502', message: 'Bad Gateway' });
  });
});
