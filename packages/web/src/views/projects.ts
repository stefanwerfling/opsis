import type { Project } from '@opsis/core';
import { PROMPT_LANGUAGES } from '@opsis/core/browser';
import { api } from '../api.js';
import { formValue, h } from '../dom.js';
import { t } from '../i18n/i18n.js';
import { navigate, pathTo } from '../router.js';
import { Disposer, field, formError, formatDateTime, handleSubmit, liveSection, type View } from '../ui.js';

const projectCard = (project: Project): HTMLElement =>
  h(
    'li',
    { class: 'card' },
    h('a', { attrs: { href: pathTo('projects', project.id) } }, h('strong', {}, project.name)),
    h(
      'div',
      { class: 'muted' },
      project.slug,
      ' · ',
      t('projects.promptLanguage'),
      ': ',
      project.promptLanguage,
    ),
    project.description !== '' && h('p', {}, project.description),
    h('small', { class: 'muted' }, t('projects.created', { date: formatDateTime(project.createdAt) })),
  );

const createProjectForm = (): HTMLFormElement => {
  const form = h(
    'form',
    { class: 'stack' },
    field(t('projects.name'), h('input', { attrs: { name: 'name', required: true, maxlength: 200 } })),
    field(
      t('projects.slug'),
      h('input', { attrs: { name: 'slug', maxlength: 64, pattern: '[a-z0-9]+(-[a-z0-9]+)*' } }),
      t('projects.slugHint'),
    ),
    field(t('projects.description'), h('textarea', { attrs: { name: 'description', rows: 3 } })),
    field(
      t('projects.promptLanguage'),
      h(
        'select',
        { attrs: { name: 'promptLanguage' } },
        PROMPT_LANGUAGES.map((language) => h('option', { attrs: { value: language } }, language)),
      ),
      t('projects.promptLanguageHint'),
    ),
    formError(),
    h('button', { attrs: { type: 'submit' } }, t('common.create')),
  );
  form.addEventListener(
    'submit',
    handleSubmit(form, async () => {
      const slug = formValue(form, 'slug');
      const language = formValue(form, 'promptLanguage');
      const project = await api.createProject({
        name: formValue(form, 'name'),
        description: formValue(form, 'description'),
        promptLanguage: language === 'de' ? 'de' : 'en',
        ...(slug === '' ? {} : { slug }),
      });
      navigate(pathTo('projects', project.id));
    }),
  );
  return form;
};

export const projectsView: View = (root) => {
  const disposer = new Disposer();
  const list = disposer.add(
    liveSection({
      load: () => api.listProjects(),
      relevant: (event) => event.type === 'ProjectChanged',
      render: (projects) =>
        projects.length === 0
          ? h('p', { class: 'muted' }, t('projects.empty'))
          : h('ul', { class: 'cards' }, projects.map(projectCard)),
    }),
  );
  root.append(
    h('h1', {}, t('projects.title')),
    h(
      'div',
      { class: 'columns' },
      h('section', {}, list.element),
      h('section', { class: 'panel' }, h('h2', {}, t('projects.new')), createProjectForm()),
    ),
  );
  return disposer.dispose;
};
