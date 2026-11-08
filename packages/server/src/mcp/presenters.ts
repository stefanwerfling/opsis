/**
 * Agent-facing representations (architecture 06): snake_case, ids named after their
 * entity, the UI-ID instead of internal UI view ids, and links into the editor.
 */
import {
  isTerminal,
  type AppContext,
  type Project,
  type Screenshot,
  type Session,
  type SessionStatus,
  type UiVersion,
  type UiView,
} from '@opsis/core';

export interface PresenterContext {
  readonly ctx: AppContext;
  /** Public base URL of the web UI, e.g. `http://127.0.0.1:4777`. */
  readonly baseUrl: string;
}

const versionNo = (ctx: AppContext, versionId: string | null): number | null =>
  versionId === null ? null : (ctx.repos.versions.findUiVersion(versionId)?.versionNo ?? null);

const uiIdOf = (ctx: AppContext, uiViewId: string): string =>
  ctx.repos.uiViews.findById(uiViewId)?.uiId ?? uiViewId;

export const editorUrl = (p: PresenterContext, sessionId: string): string =>
  `${p.baseUrl}/sessions/${encodeURIComponent(sessionId)}`;

export const presentProject = (project: Project) => ({
  project_id: project.id,
  slug: project.slug,
  name: project.name,
  description: project.description,
  prompt_language: project.promptLanguage,
  metadata: project.metadata,
  created_at: project.createdAt,
  updated_at: project.updatedAt,
});

export const presentUiView = (ctx: AppContext, view: UiView) => ({
  ui_id: view.uiId,
  path: view.path,
  name: view.name,
  description: view.description,
  head_version_no: versionNo(ctx, view.headVersionId),
  updated_at: view.updatedAt,
});

/** What the agent should do next for a session in this status. */
export const nextAction = (status: SessionStatus): string => {
  switch (status) {
    case 'created':
    case 'uploading':
      return 'Upload the screenshot (opsis_submit_screenshot).';
    case 'awaiting_review':
      return (
        'Waiting for the human. If you were asked to describe the UI, propose components first ' +
        '(opsis_propose_components); then call opsis_wait_for_specification until done.'
      );
    case 'in_progress':
      return 'A human is specifying the UI. Call opsis_wait_for_specification until done.';
    case 'ready':
      return 'Fetch the implementation prompt (opsis_get_implementation_prompt) and implement it.';
    case 'delivered':
      return 'The prompt was delivered. Implement it; fetch it again with opsis_get_implementation_prompt if needed.';
    case 'cancelled':
    case 'failed':
      return 'Nothing to do: the session has ended.';
  }
};

export const presentSession = (p: PresenterContext, session: Session) => ({
  session_id: session.id,
  project_id: session.projectId,
  ui_id: uiIdOf(p.ctx, session.uiViewId),
  title: session.title,
  intent: session.intent,
  status: session.status,
  terminal: isTerminal(session.status),
  assignment: session.assignment,
  agent_session_ref: session.agentSessionRef,
  base_version_no: versionNo(p.ctx, session.baseVersionId),
  result_version_id: session.resultVersionId,
  result_version_no: versionNo(p.ctx, session.resultVersionId),
  editor_url: editorUrl(p, session.id),
  created_at: session.createdAt,
  updated_at: session.updatedAt,
});

export const presentScreenshot = (ctx: AppContext, screenshot: Screenshot) => ({
  screenshot_id: screenshot.id,
  project_id: screenshot.projectId,
  ui_id: uiIdOf(ctx, screenshot.uiViewId),
  session_id: screenshot.sessionId,
  sequence_no: screenshot.sequenceNo,
  mime_type: screenshot.mimeType,
  width: screenshot.width,
  height: screenshot.height,
  viewport_width: screenshot.viewportWidth,
  viewport_height: screenshot.viewportHeight,
  device_type: screenshot.deviceCategory,
  variant_label: screenshot.variantLabel,
  description: screenshot.description,
  source: screenshot.source,
  created_at: screenshot.createdAt,
});

export const presentVersion = (version: UiVersion) => ({
  version_id: version.id,
  version_no: version.versionNo,
  path: version.pathAtVersion,
  screenshot_id: version.screenshotId,
  screenshot_ids: version.screenshotIds,
  spec_revision_id: version.specRevisionId,
  prompt_version_id: version.promptVersionId,
  session_id: version.sessionId,
  predecessor_version_id: version.predecessorVersionId,
  change_description: version.changeDescription,
  created_at: version.createdAt,
});
