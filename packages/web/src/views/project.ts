import type { DomainEvent } from '@opsis/core';
import { api } from '../api.js';
import { createImportForm } from '../components/import-form.js';
import { createUploadForm } from '../components/upload-form.js';
import { OPEN_STATUSES, sessionTable, uiViewTable } from '../components/lists.js';
import { formValue, h } from '../dom.js';
import { t } from '../i18n/i18n.js';
import { navigate, pathTo } from '../router.js';
import { Disposer, field, formError, handleSubmit, liveSection, type View } from '../ui.js';

const createUiViewForm = (projectId: string): HTMLFormElement => {
  const form = h(
    'form',
    { class: 'stack' },
    field(
      t('ui.path'),
      h('input', { attrs: { name: 'path', required: true, maxlength: 500 } }),
      t('ui.pathHint'),
    ),
    field(t('ui.uiId'), h('input', { attrs: { name: 'uiId', maxlength: 100 } }), t('ui.uiIdHint')),
    field(t('ui.name'), h('input', { attrs: { name: 'name', maxlength: 200 } }), t('common.optional')),
    field(t('ui.description'), h('textarea', { attrs: { name: 'description', rows: 2 } })),
    formError(),
    h('button', { attrs: { type: 'submit' } }, t('common.create')),
  );
  form.addEventListener(
    'submit',
    handleSubmit(form, async () => {
      const uiId = formValue(form, 'uiId');
      const name = formValue(form, 'name');
      const view = await api.createUiView(projectId, {
        path: formValue(form, 'path'),
        description: formValue(form, 'description'),
        ...(uiId === '' ? {} : { uiId }),
        ...(name === '' ? {} : { name }),
      });
      navigate(pathTo('projects', projectId, 'ui', view.uiId));
    }),
  );
  return form;
};

export const projectView: View = (root, params) => {
  const projectId = params['projectId'] ?? '';
  const disposer = new Disposer();
  const ofProject = (event: DomainEvent) => event.projectId === projectId;

  const header = disposer.add(
    liveSection({
      load: () => api.getProject(projectId),
      relevant: (event) => event.type === 'ProjectChanged' && ofProject(event),
      render: (project) => [
        h('h1', {}, project.name),
        h(
          'p',
          { class: 'muted' },
          project.slug,
          ' · ',
          t('projects.promptLanguage'),
          ': ',
          project.promptLanguage,
        ),
        project.description !== '' && h('p', {}, project.description),
      ],
    }),
  );

  const upload = createUploadForm(projectId);
  const uiViews = disposer.add(
    liveSection({
      load: () => api.listUiViews(projectId),
      relevant: (event) => event.type === 'UiViewChanged' && ofProject(event),
      render: uiViewTable,
      onData: (views) => {
        upload.setUiViews(views);
      },
    }),
  );

  let openOnly = true;
  const sessions = disposer.add(
    liveSection({
      load: async () => {
        const [list, views] = await Promise.all([
          api.listSessions(projectId, openOnly ? { statuses: OPEN_STATUSES } : {}),
          api.listUiViews(projectId),
        ]);
        return { list, views };
      },
      relevant: ofProject,
      render: ({ list, views }) => sessionTable(list, views),
    }),
  );
  const openOnlyToggle = h('input', {
    attrs: { type: 'checkbox' },
    props: { checked: openOnly },
    onChange: (event) => {
      openOnly = (event.currentTarget as HTMLInputElement).checked;
      sessions.reload();
    },
  });

  root.append(
    h('nav', { class: 'breadcrumb' }, h('a', { attrs: { href: '/' } }, t('projects.title'))),
    header.element,
    h(
      'div',
      { class: 'columns' },
      h(
        'div',
        { class: 'stack' },
        h(
          'section',
          {},
          h(
            'div',
            { class: 'section-head' },
            h('h2', {}, t('project.sessions')),
            h('label', { class: 'inline' }, openOnlyToggle, t('project.filterOpen')),
          ),
          sessions.element,
        ),
        h('section', {}, h('h2', {}, t('project.uiViews')), uiViews.element),
      ),
      h(
        'div',
        { class: 'stack' },
        h(
          'details',
          { class: 'panel', props: { open: true } },
          h('summary', {}, t('project.upload')),
          upload.element,
        ),
        h(
          'details',
          { class: 'panel' },
          h('summary', {}, t('project.newUiView')),
          createUiViewForm(projectId),
        ),
        h('details', { class: 'panel' }, h('summary', {}, t('project.import')), createImportForm(projectId)),
      ),
    ),
  );
  return disposer.dispose;
};
