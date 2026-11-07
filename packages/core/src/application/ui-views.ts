import { actorRef, type Actor } from '../domain/actor.js';
import { OpsisError } from '../domain/errors.js';
import { newId } from '../domain/ids.js';
import {
  ChangeUiPathInputSchema,
  CreateUiViewInputSchema,
  defaultNameFromPath,
  deriveUiIdFromPath,
  uniqueUiId,
  type ChangeUiPathInput,
  type CreateUiViewInput,
  type UiPathChange,
  type UiView,
} from '../domain/ui-view.js';
import { commit, parseInput, type AppContext, type UnitOfWork } from './context.js';
import { getProject } from './projects.js';

/** Inserts a UI view inside an existing unit of work. Shared by createUiView and submitScreenshot. */
export const insertUiView = (
  ctx: AppContext,
  actor: Actor,
  uow: UnitOfWork,
  input: {
    projectId: string;
    uiId?: string | undefined;
    uiIdHint?: string | undefined;
    path: string;
    name?: string | undefined;
    description?: string;
  },
): UiView => {
  const { projectId, path } = input;
  const existingForPath = ctx.repos.uiViews.findByPath(projectId, path);
  if (existingForPath) {
    throw new OpsisError('CONFLICT', `UI path "${path}" already belongs to UI "${existingForPath.uiId}"`, {
      path,
      uiId: existingForPath.uiId,
    });
  }
  let uiId: string;
  if (input.uiId !== undefined) {
    if (ctx.repos.uiViews.findByUiId(projectId, input.uiId)) {
      throw new OpsisError('CONFLICT', `UI-ID "${input.uiId}" already exists in this project`, {
        uiId: input.uiId,
      });
    }
    uiId = input.uiId;
  } else {
    const base = input.uiIdHint ?? deriveUiIdFromPath(path);
    uiId = uniqueUiId(base, (candidate) => ctx.repos.uiViews.findByUiId(projectId, candidate) !== undefined);
  }
  const view: UiView = {
    id: newId('uiView'),
    projectId,
    uiId,
    path,
    name: input.name ?? defaultNameFromPath(path),
    description: input.description ?? '',
    headVersionId: null,
    createdAt: uow.now,
    updatedAt: uow.now,
  };
  ctx.repos.uiViews.insert(view);
  ctx.repos.uiViews.insertPathChange({
    id: newId('uiPathChange'),
    uiViewId: view.id,
    oldPath: null,
    newPath: path,
    changedBy: actorRef(actor),
    reason: 'created',
    changedAt: uow.now,
  });
  uow.audit({ projectId, entityType: 'ui_view', entityId: view.id, action: 'create', data: { uiId, path } });
  uow.emit({ type: 'UiViewChanged', projectId, uiViewId: view.id });
  return view;
};

export const createUiView = (
  ctx: AppContext,
  actor: Actor,
  projectId: string,
  input: CreateUiViewInput,
): UiView => {
  const data = parseInput(CreateUiViewInputSchema, input);
  return commit(ctx, actor, (uow) => {
    getProject(ctx, actor, projectId);
    return insertUiView(ctx, actor, uow, { projectId, ...data });
  });
};

export const listUiViews = (ctx: AppContext, actor: Actor, projectId: string): UiView[] => {
  getProject(ctx, actor, projectId);
  return ctx.repos.uiViews.listByProject(projectId);
};

export const findUiView = (ctx: AppContext, actor: Actor, projectId: string, uiId: string): UiView => {
  ctx.access.assertProjectAccess(actor, projectId);
  const view = ctx.repos.uiViews.findByUiId(projectId, uiId);
  if (!view) throw new OpsisError('NOT_FOUND', `UI "${uiId}" not found in project "${projectId}"`);
  return view;
};

export interface UiViewDetails {
  readonly view: UiView;
  readonly pathHistory: UiPathChange[];
}

export const getUiView = (ctx: AppContext, actor: Actor, projectId: string, uiId: string): UiViewDetails => {
  const view = findUiView(ctx, actor, projectId, uiId);
  return { view, pathHistory: ctx.repos.uiViews.listPathChanges(view.id) };
};

/** Changes the logical path; the UI-ID stays the same (principle 5). */
export const applyPathChange = (
  ctx: AppContext,
  actor: Actor,
  uow: UnitOfWork,
  view: UiView,
  newPath: string,
  reason: string,
): UiView => {
  if (newPath === view.path) return view;
  const owner = ctx.repos.uiViews.findByPath(view.projectId, newPath);
  if (owner) {
    throw new OpsisError('CONFLICT', `UI path "${newPath}" already belongs to UI "${owner.uiId}"`, {
      path: newPath,
      uiId: owner.uiId,
    });
  }
  const updated: UiView = { ...view, path: newPath, updatedAt: uow.now };
  ctx.repos.uiViews.update(updated);
  ctx.repos.uiViews.insertPathChange({
    id: newId('uiPathChange'),
    uiViewId: view.id,
    oldPath: view.path,
    newPath,
    changedBy: actorRef(actor),
    reason,
    changedAt: uow.now,
  });
  uow.audit({
    projectId: view.projectId,
    entityType: 'ui_view',
    entityId: view.id,
    action: 'change_path',
    data: { from: view.path, to: newPath, reason },
  });
  uow.emit({ type: 'UiViewChanged', projectId: view.projectId, uiViewId: view.id });
  return updated;
};

export const changeUiPath = (
  ctx: AppContext,
  actor: Actor,
  projectId: string,
  uiId: string,
  input: ChangeUiPathInput,
): UiView => {
  const data = parseInput(ChangeUiPathInputSchema, input);
  return commit(ctx, actor, (uow) =>
    applyPathChange(ctx, actor, uow, findUiView(ctx, actor, projectId, uiId), data.newPath, data.reason),
  );
};
