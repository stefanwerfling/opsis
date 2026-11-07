import type { Actor } from '../domain/actor.js';
import { OpsisError } from '../domain/errors.js';
import { newId } from '../domain/ids.js';
import {
  CreateProjectInputSchema,
  UpdateProjectInputSchema,
  slugify,
  type CreateProjectInput,
  type Project,
  type UpdateProjectInput,
} from '../domain/project.js';
import { commit, parseInput, type AppContext } from './context.js';

export const createProject = (ctx: AppContext, actor: Actor, input: CreateProjectInput): Project => {
  const data = parseInput(CreateProjectInputSchema, input);
  return commit(ctx, actor, (uow) => {
    let slug = data.slug ?? slugify(data.name);
    if (ctx.repos.projects.findBySlug(slug)) {
      if (data.slug !== undefined) {
        throw new OpsisError('CONFLICT', `Project slug "${slug}" is already in use`, { slug });
      }
      const base = slug.slice(0, 60);
      let n = 2;
      while (ctx.repos.projects.findBySlug(`${base}-${n}`)) n += 1;
      slug = `${base}-${n}`;
    }
    const project: Project = {
      id: newId('project'),
      slug,
      name: data.name,
      description: data.description,
      promptLanguage: data.promptLanguage,
      metadata: data.metadata,
      createdAt: uow.now,
      updatedAt: uow.now,
      archivedAt: null,
    };
    ctx.repos.projects.insert(project);
    // An agent that creates a project is allowed to work with it (architecture 04 §4).
    if (actor.type === 'agent') ctx.repos.grants.grant(actor.id, project.id, uow.now);
    uow.audit({
      projectId: project.id,
      entityType: 'project',
      entityId: project.id,
      action: 'create',
      data: { slug },
    });
    uow.emit({ type: 'ProjectChanged', projectId: project.id });
    return project;
  });
};

export const getProject = (ctx: AppContext, actor: Actor, projectId: string): Project => {
  ctx.access.assertProjectAccess(actor, projectId);
  const project = ctx.repos.projects.findById(projectId);
  if (!project) throw new OpsisError('NOT_FOUND', `project "${projectId}" not found`);
  return project;
};

export const listProjects = (ctx: AppContext, actor: Actor): Project[] =>
  ctx.repos.projects.list(ctx.access.visibleProjectIds(actor));

export const updateProject = (
  ctx: AppContext,
  actor: Actor,
  projectId: string,
  input: UpdateProjectInput,
): Project => {
  const data = parseInput(UpdateProjectInputSchema, input);
  return commit(ctx, actor, (uow) => {
    const current = getProject(ctx, actor, projectId);
    const updated: Project = {
      ...current,
      name: data.name ?? current.name,
      description: data.description ?? current.description,
      promptLanguage: data.promptLanguage ?? current.promptLanguage,
      metadata: data.metadata ?? current.metadata,
      updatedAt: uow.now,
    };
    ctx.repos.projects.update(updated);
    uow.audit({
      projectId,
      entityType: 'project',
      entityId: projectId,
      action: 'update',
      data: { fields: Object.keys(data) },
    });
    uow.emit({ type: 'ProjectChanged', projectId });
    return updated;
  });
};
