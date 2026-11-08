import type {
  ComponentHistoryEntry,
  CreateProjectInput,
  Draft,
  DraftOperation,
  ExportKind,
  CreateUiViewInput,
  ChangeUiPathInput,
  Project,
  ReleaseInput,
  ReleaseResult,
  ReleasedVersion,
  Screenshot,
  Session,
  SessionDetails,
  SessionStatus,
  SubmitScreenshotResult,
  UiVersion,
  UiView,
  UiViewDetails,
  VersionComparison,
} from '@opsis/core';
import { pathTo } from './router.js';

/** Error returned by the REST API (`{ error: { code, message, details? } }`). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/** Converts a non-OK response into an ApiError without trusting the body shape. */
export const toApiError = async (response: Response): Promise<ApiError> => {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // not JSON (proxy error page, empty body)
  }
  const error = isRecord(body) && isRecord(body['error']) ? body['error'] : {};
  const code = typeof error['code'] === 'string' ? error['code'] : 'HTTP_' + String(response.status);
  const message = typeof error['message'] === 'string' ? error['message'] : response.statusText;
  return new ApiError(response.status, code, message, error['details']);
};

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export const createApi = (fetchImpl: Fetch = (input, init) => fetch(input, init)) => {
  const request = async <T>(method: string, url: string, body?: unknown): Promise<T> => {
    const init: RequestInit = { method, headers: { accept: 'application/json' } };
    if (body instanceof FormData) {
      init.body = body;
    } else if (body !== undefined) {
      init.body = JSON.stringify(body);
      init.headers = { accept: 'application/json', 'content-type': 'application/json' };
    }
    const response = await fetchImpl(url, init);
    if (!response.ok) throw await toApiError(response);
    return (await response.json()) as T;
  };
  const requestText = async (url: string): Promise<string> => {
    const response = await fetchImpl(url, { method: 'GET', headers: { accept: 'text/markdown' } });
    if (!response.ok) throw await toApiError(response);
    return response.text();
  };

  const base = '/api/v1';
  const query = (params: Record<string, string | undefined>): string => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) if (value !== undefined) search.set(key, value);
    const text = search.toString();
    return text === '' ? '' : '?' + text;
  };

  return {
    listProjects: async () => (await request<{ projects: Project[] }>('GET', `${base}/projects`)).projects,
    getProject: (projectId: string) => request<Project>('GET', base + pathTo('projects', projectId)),
    createProject: (input: CreateProjectInput) => request<Project>('POST', `${base}/projects`, input),

    listUiViews: async (projectId: string) =>
      (await request<{ uiViews: UiView[] }>('GET', base + pathTo('projects', projectId, 'ui-views'))).uiViews,
    getUiView: (projectId: string, uiId: string) =>
      request<UiViewDetails>('GET', base + pathTo('projects', projectId, 'ui-views', uiId)),
    createUiView: (projectId: string, input: CreateUiViewInput) =>
      request<UiView>('POST', base + pathTo('projects', projectId, 'ui-views'), input),
    changeUiPath: (projectId: string, uiId: string, input: ChangeUiPathInput) =>
      request<UiView>('PATCH', base + pathTo('projects', projectId, 'ui-views', uiId, 'path'), input),

    listSessions: async (
      projectId: string,
      filter: { uiId?: string; statuses?: readonly SessionStatus[] } = {},
    ) =>
      (
        await request<{ sessions: Session[] }>(
          'GET',
          base +
            pathTo('projects', projectId, 'sessions') +
            query({ uiId: filter.uiId, status: filter.statuses?.join(',') }),
        )
      ).sessions,
    getSession: (sessionId: string) => request<SessionDetails>('GET', base + pathTo('sessions', sessionId)),
    startReview: (sessionId: string) =>
      request<Session>('POST', base + pathTo('sessions', sessionId, 'start-review'), {}),
    cancelSession: (sessionId: string, reason: string) =>
      request<Session>('POST', base + pathTo('sessions', sessionId, 'cancel'), { reason }),
    confirmAssignment: (sessionId: string, acceptProposedPath: boolean) =>
      request<Session>('POST', base + pathTo('sessions', sessionId, 'confirm-assignment'), {
        acceptProposedPath,
      }),

    release: (sessionId: string, input: ReleaseInput) =>
      request<Pick<ReleaseResult, 'session' | 'uiVersion'>>(
        'POST',
        base + pathTo('sessions', sessionId, 'release'),
        input,
      ),
    reopenSession: (sessionId: string, reason: string) =>
      request<Session>('POST', base + pathTo('sessions', sessionId, 'reopen'), { reason }),
    rebaseSession: (sessionId: string, rowVersion: number) =>
      request<Session>('POST', base + pathTo('sessions', sessionId, 'rebase'), { rowVersion }),
    compareVersions: (versionIdA: string, versionIdB: string) =>
      request<VersionComparison>('GET', base + pathTo('versions', versionIdA, 'compare', versionIdB)),
    componentHistory: async (projectId: string, uiId: string, componentId: string) =>
      (
        await request<{ history: ComponentHistoryEntry[] }>(
          'GET',
          base + pathTo('projects', projectId, 'ui-views', uiId, 'components', componentId, 'history'),
        )
      ).history,

    listVersions: async (projectId: string, uiId: string) =>
      (
        await request<{ versions: UiVersion[] }>(
          'GET',
          base + pathTo('projects', projectId, 'ui-views', uiId, 'versions'),
        )
      ).versions,
    getVersion: (versionId: string) =>
      request<
        Omit<ReleasedVersion, 'specRevision' | 'promptVersion'> & {
          specRevision: Omit<ReleasedVersion['specRevision'], 'snapshot'>;
          promptVersion: Omit<ReleasedVersion['promptVersion'], 'markdown'>;
        }
      >('GET', base + pathTo('versions', versionId)),
    /** Detected pixel differences (PNG mask); the figures come from the response headers. */
    pixelDiff: async (versionIdA: string, versionIdB: string) => {
      const response = await fetchImpl(base + pathTo('versions', versionIdA, 'pixel-diff', versionIdB), {
        method: 'GET',
      });
      if (!response.ok) throw await toApiError(response);
      const header = (name: string): string => response.headers.get(name) ?? '';
      const [width = 0, height = 0] = header('x-opsis-compared-size').split('x').map(Number);
      const [aspectRatioA = 0, aspectRatioB = 0] = header('x-opsis-aspect-ratios').split(',').map(Number);
      return {
        blob: await response.blob(),
        differentPixels: Number(header('x-opsis-different-pixels')),
        width,
        height,
        resized: header('x-opsis-resized') === 'true',
        aspectRatioA,
        aspectRatioB,
      };
    },
    getPrompt: (versionId: string) => requestText(base + pathTo('versions', versionId, 'prompt')),
    getSpecificationMarkdown: (versionId: string) =>
      requestText(base + pathTo('versions', versionId, 'specification') + '?format=markdown'),
    getSpecificationJson: (versionId: string) =>
      request<unknown>('GET', base + pathTo('versions', versionId, 'specification') + '?format=json'),
    /** Download URL of an export (architecture 05 §7); served as an attachment. */
    exportUrl: (versionId: string, kind: ExportKind, screenshotId?: string) =>
      base + pathTo('versions', versionId, 'export', kind) + query({ screenshotId }),

    getDraft: (sessionId: string) => request<Draft>('GET', base + pathTo('sessions', sessionId, 'draft')),
    changeDraft: (
      sessionId: string,
      input: { baseRevision: number; operations: readonly DraftOperation[] },
    ) => request<Draft>('POST', base + pathTo('sessions', sessionId, 'draft', 'operations'), input),

    listScreenshots: async (projectId: string, filter: { uiId?: string; sessionId?: string } = {}) =>
      (
        await request<{ screenshots: Screenshot[] }>(
          'GET',
          base + pathTo('projects', projectId, 'screenshots') + query(filter),
        )
      ).screenshots,
    uploadScreenshot: (projectId: string, form: FormData) =>
      request<SubmitScreenshotResult>('POST', base + pathTo('projects', projectId, 'screenshots'), form),
    getScreenshot: (screenshotId: string) =>
      request<Screenshot>('GET', base + pathTo('screenshots', screenshotId)),
    screenshotImageUrl: (screenshotId: string) => base + pathTo('screenshots', screenshotId, 'image'),
  };
};

export type Api = ReturnType<typeof createApi>;
export type VersionDetails = Awaited<ReturnType<Api['getVersion']>>;

export const api: Api = createApi();
