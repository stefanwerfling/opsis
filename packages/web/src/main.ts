import { h, replaceChildren } from './dom.js';
import {
  UI_LANGUAGES,
  getLanguage,
  initLanguage,
  isUiLanguage,
  onLanguageChange,
  setLanguage,
  t,
} from './i18n/i18n.js';
import { connectLiveEvents, onLiveStatus } from './live.js';
import { installLinkInterception, matchRoute, onRouteChange } from './router.js';
import type { View } from './ui.js';
import { agentsView } from './views/agents.js';
import { projectView } from './views/project.js';
import { historyView } from './views/history.js';
import { projectsView } from './views/projects.js';
import { sessionView } from './views/session.js';
import { uiViewView } from './views/ui-view.js';
import { versionView } from './views/version.js';

const ROUTES: readonly (readonly [pattern: string, view: View])[] = [
  ['/', projectsView],
  ['/agents', agentsView],
  ['/projects/:projectId', projectView],
  ['/projects/:projectId/ui/:uiId', uiViewView],
  ['/projects/:projectId/ui/:uiId/history', historyView],
  ['/sessions/:sessionId', sessionView],
  ['/versions/:versionId', versionView],
];

const notFoundView: View = (root) => {
  root.append(h('p', {}, t('common.notFound')), h('a', { attrs: { href: '/' } }, t('projects.title')));
  return () => undefined;
};

const resolve = (path: string): { view: View; params: Record<string, string> } => {
  for (const [pattern, view] of ROUTES) {
    const params = matchRoute(pattern, path);
    if (params !== null) return { view, params };
  }
  return { view: notFoundView, params: {} };
};

/** Created once; texts are refreshed on language change so no subscriptions leak. */
const createHeader = (): HTMLElement => {
  const live = h('span', { class: 'live-dot', attrs: { role: 'status' } });
  let connected = false;
  const brand = h('a', { class: 'brand', attrs: { href: '/' } });
  const agents = h('a', { attrs: { href: '/agents' } });
  const languageSelect = h(
    'select',
    {
      onChange: (event) => {
        const value = (event.currentTarget as HTMLSelectElement).value;
        if (isUiLanguage(value)) setLanguage(value);
      },
    },
    UI_LANGUAGES.map((language) => h('option', { attrs: { value: language } }, language.toUpperCase())),
  );
  const refresh = (): void => {
    brand.textContent = t('app.title');
    agents.textContent = t('agents.title');
    languageSelect.value = getLanguage();
    languageSelect.setAttribute('aria-label', t('app.language'));
    live.classList.toggle('connected', connected);
    live.title = connected ? t('app.live') : t('app.offline');
    live.setAttribute('aria-label', live.title);
  };
  onLiveStatus((value) => {
    connected = value;
    refresh();
  });
  onLanguageChange(refresh);
  refresh();
  return h(
    'header',
    { class: 'app-header' },
    brand,
    h('div', { class: 'row' }, agents, live, languageSelect),
  );
};

const start = (): void => {
  const app = document.getElementById('app');
  if (app === null) throw new Error('#app missing');
  initLanguage();
  installLinkInterception();
  connectLiveEvents();

  const main = h('main');
  replaceChildren(app, createHeader(), main);

  let cleanup: (() => void) | undefined;
  const render = (): void => {
    cleanup?.();
    replaceChildren(main);
    const { view, params } = resolve(location.pathname);
    cleanup = view(main, params);
    window.scrollTo(0, 0);
  };

  onRouteChange(render);
  onLanguageChange(render);
  render();
};

start();
