import type {
  CreateProjectInput,
  Draft,
  DraftOperation,
  CreateUiViewInput,
  ChangeUiPathInput,
  Project,
  Screenshot,
  Session,
  SessionDetails,
  SessionStatus,
  SubmitScreenshotResult,
  UiView,
  UiViewDetails,
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
    screenshotImageUrl: (screenshotId: string) => base + pathTo('screenshots', screenshotId, 'image'),
  };
};

export type Api = ReturnType<typeof createApi>;

export const api: Api = createApi();
