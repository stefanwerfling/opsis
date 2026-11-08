import { api } from '../api.js';
import { h, replaceChildren } from '../dom.js';
import { t } from '../i18n/i18n.js';
import { pathTo } from '../router.js';
import { Disposer, errorBox, formatDateTime, liveSection, type View } from '../ui.js';

type Tab = 'prompt' | 'specification' | 'json';

const TAB_LABELS = {
  prompt: 'version.prompt',
  specification: 'version.specification',
  json: 'version.json',
} as const;

/** A released UI version (read-only): prompt, readable specification and JSON. */
export const versionView: View = (root, params) => {
  const versionId = params['versionId'] ?? '';
  const disposer = new Disposer();
  const content = h('pre', { class: 'document', attrs: { tabindex: 0 } });
  const output = h('div');
  const tabs = h('div', { class: 'strip', attrs: { role: 'tablist' } });
  let active: Tab = 'prompt';
  let sequence = 0;

  const load = async (tab: Tab): Promise<string> => {
    if (tab === 'prompt') return api.getPrompt(versionId);
    if (tab === 'specification') return api.getSpecificationMarkdown(versionId);
    return JSON.stringify(await api.getSpecificationJson(versionId), null, 2);
  };

  const show = (tab: Tab): void => {
    active = tab;
    const current = ++sequence;
    for (const button of tabs.querySelectorAll<HTMLButtonElement>('button')) {
      button.setAttribute('aria-selected', String(button.dataset['tab'] === tab));
    }
    replaceChildren(output);
    content.textContent = t('common.loading');
    load(tab)
      .then((text) => {
        if (current === sequence) content.textContent = text;
      })
      .catch((error: unknown) => {
        if (current === sequence) {
          content.textContent = '';
          replaceChildren(output, errorBox(error));
        }
      });
  };

  for (const tab of ['prompt', 'specification', 'json'] as const) {
    tabs.append(
      h(
        'button',
        {
          attrs: { type: 'button', role: 'tab' },
          dataset: { tab },
          onClick: () => {
            show(tab);
          },
        },
        t(TAB_LABELS[tab]),
      ),
    );
  }
  const copy = h(
    'button',
    {
      attrs: { type: 'button' },
      onClick: () => {
        navigator.clipboard
          .writeText(content.textContent)
          .then(() => {
            copy.textContent = t('version.copied');
            setTimeout(() => {
              copy.textContent = t('version.copy');
            }, 1500);
          })
          .catch((error: unknown) => {
            replaceChildren(output, errorBox(error));
          });
      },
    },
    t('version.copy'),
  );

  const header = disposer.add(
    liveSection({
      load: () => api.getVersion(versionId),
      relevant: () => false,
      render: ({ uiVersion, snapshot, references }) => [
        h('nav', { class: 'breadcrumb' }, [
          h('a', { attrs: { href: '/' } }, t('projects.title')),
          ' / ',
          h(
            'a',
            { attrs: { href: pathTo('projects', uiVersion.projectId, 'ui', snapshot.uiView.uiId) } },
            snapshot.uiView.name,
          ),
        ]),
        h(
          'h1',
          {},
          t('version.title', { version: uiVersion.versionNo, name: snapshot.uiView.name }),
          ' ',
          h('code', { class: 'muted' }, snapshot.uiView.uiId),
        ),
        h(
          'dl',
          { class: 'facts' },
          h('dt', {}, t('ui.path')),
          h('dd', {}, h('code', {}, uiVersion.pathAtVersion)),
          h('dt', {}, t('version.released')),
          h('dd', {}, formatDateTime(references.releasedAt), ' · ', references.releasedBy),
          h('dt', {}, t('version.session')),
          h(
            'dd',
            {},
            h('a', { attrs: { href: pathTo('sessions', uiVersion.sessionId) } }, uiVersion.sessionId),
          ),
          references.predecessor !== null && [
            h('dt', {}, t('version.predecessor')),
            h(
              'dd',
              {},
              h(
                'a',
                { attrs: { href: pathTo('versions', references.predecessor.id) } },
                `V${String(references.predecessor.versionNo)}`,
              ),
            ),
          ],
          uiVersion.changeDescription !== '' && [
            h('dt', {}, t('version.changeDescription')),
            h('dd', {}, uiVersion.changeDescription),
          ],
        ),
      ],
    }),
  );

  root.append(header.element, h('div', { class: 'row version-tabs' }, tabs, copy), output, content);
  show(active);
  return disposer.dispose;
};
