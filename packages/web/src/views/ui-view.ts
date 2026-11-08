import type { DomainEvent, Screenshot, UiVersion, UiViewDetails } from '@opsis/core';
import { api } from '../api.js';
import { sessionTable } from '../components/lists.js';
import { formValue, h } from '../dom.js';
import { t } from '../i18n/i18n.js';
import { pathTo } from '../router.js';
import { Disposer, field, formError, formatDateTime, handleSubmit, liveSection, type View } from '../ui.js';

export const screenshotLabel = (screenshot: Screenshot): string =>
  t('screenshot.label', {
    no: screenshot.sequenceNo,
    width: screenshot.width,
    height: screenshot.height,
    device: t(`device.${screenshot.deviceCategory}`),
  });

const screenshotGrid = (screenshots: readonly Screenshot[]): HTMLElement =>
  screenshots.length === 0
    ? h('p', { class: 'muted' }, t('ui.screenshotsEmpty'))
    : h(
        'ul',
        { class: 'thumbs' },
        screenshots.map((screenshot) => {
          const image = h('img', {
            attrs: {
              src: api.screenshotImageUrl(screenshot.id),
              alt: screenshotLabel(screenshot),
              loading: 'lazy',
              decoding: 'async',
              width: screenshot.width,
              height: screenshot.height,
            },
          });
          const caption = h(
            'figcaption',
            {},
            screenshotLabel(screenshot),
            screenshot.variantLabel !== null && ` · ${screenshot.variantLabel}`,
            h('br'),
            h(
              'small',
              { class: 'muted' },
              t(`screenshot.source.${screenshot.source}`),
              ' · ',
              formatDateTime(screenshot.createdAt),
            ),
          );
          const figure = h('figure', {}, image, caption);
          return h(
            'li',
            {},
            screenshot.sessionId === null
              ? figure
              : h('a', { attrs: { href: pathTo('sessions', screenshot.sessionId) } }, figure),
          );
        }),
      );

const versionList = (versions: readonly UiVersion[]): HTMLElement =>
  versions.length === 0
    ? h('p', { class: 'muted' }, t('ui.noVersions'))
    : h(
        'ol',
        { class: 'history versions' },
        [...versions]
          .reverse()
          .map((version) =>
            h(
              'li',
              {},
              h(
                'a',
                { attrs: { href: pathTo('versions', version.id) } },
                h('strong', {}, `V${String(version.versionNo)}`),
              ),
              ' · ',
              formatDateTime(version.createdAt),
              version.changeDescription !== '' && ` · ${version.changeDescription}`,
            ),
          ),
      );

const detailsBlock = (details: UiViewDetails): HTMLElement[] => {
  const { view, pathHistory } = details;
  return [
    h('h1', {}, view.name, ' ', h('code', { class: 'muted' }, view.uiId)),
    h(
      'dl',
      { class: 'facts' },
      h('dt', {}, t('ui.path')),
      h('dd', {}, h('code', {}, view.path)),
      h('dt', {}, t('ui.headVersion')),
      h('dd', {}, view.headVersionId ?? t('ui.noVersion')),
    ),
    view.description !== '' ? h('p', {}, view.description) : h('span'),
    h('h2', {}, t('ui.pathHistory')),
    h(
      'ol',
      { class: 'history' },
      pathHistory.map((change) =>
        h(
          'li',
          {},
          h('code', {}, t('ui.pathChange', { old: change.oldPath ?? t('common.none'), new: change.newPath })),
          ' · ',
          formatDateTime(change.changedAt),
          change.reason !== '' && ` · ${change.reason}`,
        ),
      ),
    ),
  ];
};

const changePathForm = (projectId: string, uiId: string, onDone: () => void): HTMLFormElement => {
  const form = h(
    'form',
    { class: 'stack' },
    field(
      t('ui.newPath'),
      h('input', { attrs: { name: 'newPath', required: true, maxlength: 500 } }),
      t('ui.pathHint'),
    ),
    field(t('ui.reason'), h('input', { attrs: { name: 'reason', maxlength: 2000 } }), t('common.optional')),
    formError(),
    h('button', { attrs: { type: 'submit' } }, t('common.save')),
  );
  form.addEventListener(
    'submit',
    handleSubmit(form, async () => {
      await api.changeUiPath(projectId, uiId, {
        newPath: formValue(form, 'newPath'),
        reason: formValue(form, 'reason'),
      });
      form.reset();
      onDone();
    }),
  );
  return form;
};

export const uiViewView: View = (root, params) => {
  const projectId = params['projectId'] ?? '';
  const uiId = params['uiId'] ?? '';
  const disposer = new Disposer();
  const ofProject = (event: DomainEvent) => 'projectId' in event && event.projectId === projectId;

  const details = disposer.add(
    liveSection({
      load: () => api.getUiView(projectId, uiId),
      relevant: (event) => event.type === 'UiViewChanged' && ofProject(event),
      render: detailsBlock,
    }),
  );
  const screenshots = disposer.add(
    liveSection({
      load: () => api.listScreenshots(projectId, { uiId }),
      relevant: (event) => event.type === 'ScreenshotSubmitted' && ofProject(event),
      render: screenshotGrid,
    }),
  );
  const versions = disposer.add(
    liveSection({
      load: () => api.listVersions(projectId, uiId),
      relevant: (event) => event.type === 'UiVersionCreated' && ofProject(event),
      render: versionList,
    }),
  );
  const sessions = disposer.add(
    liveSection({
      load: async () => {
        const [list, view] = await Promise.all([
          api.listSessions(projectId, { uiId }),
          api.getUiView(projectId, uiId),
        ]);
        return { list, views: [view.view] };
      },
      relevant: ofProject,
      render: ({ list, views }) => sessionTable(list, views),
    }),
  );

  root.append(
    h(
      'nav',
      { class: 'breadcrumb' },
      h('a', { attrs: { href: '/' } }, t('projects.title')),
      ' / ',
      h('a', { attrs: { href: pathTo('projects', projectId) } }, t('project.uiViews')),
    ),
    h(
      'div',
      { class: 'columns' },
      h(
        'div',
        { class: 'stack' },
        details.element,
        h(
          'section',
          {},
          h(
            'div',
            { class: 'row section-head' },
            h('h2', {}, t('ui.versions')),
            h(
              'a',
              { attrs: { href: pathTo('projects', projectId, 'ui', uiId, 'history') } },
              t('history.open'),
            ),
          ),
          versions.element,
        ),
        h('section', {}, h('h2', {}, t('project.sessions')), sessions.element),
      ),
      h(
        'details',
        { class: 'panel' },
        h('summary', {}, t('ui.changePath')),
        changePathForm(projectId, uiId, () => {
          details.reload();
        }),
      ),
    ),
    h('section', {}, h('h2', {}, t('ui.screenshots')), screenshots.element),
  );
  return disposer.dispose;
};
