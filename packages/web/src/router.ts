/** Tiny History-API router: `/projects/:projectId` style patterns, no dependencies. */

export type RouteParams = Readonly<Record<string, string>>;

/** Matches a path against a pattern; returns decoded params or null. */
export const matchRoute = (pattern: string, path: string): RouteParams | null => {
  const patternParts = pattern.split('/').filter((part) => part.length > 0);
  const pathParts = path.split('/').filter((part) => part.length > 0);
  if (patternParts.length !== pathParts.length) return null;
  const params: Record<string, string> = {};
  for (const [index, part] of patternParts.entries()) {
    const actual = pathParts[index] ?? '';
    if (part.startsWith(':')) {
      try {
        params[part.slice(1)] = decodeURIComponent(actual);
      } catch {
        return null; // malformed percent encoding
      }
    } else if (part !== actual) {
      return null;
    }
  }
  return params;
};

/** Builds a path from segments, encoding every dynamic segment. */
export const pathTo = (...segments: string[]): string =>
  '/' + segments.map((segment) => encodeURIComponent(segment)).join('/');

const listeners = new Set<() => void>();

export const navigate = (path: string, options: { replace?: boolean } = {}): void => {
  if (path === location.pathname + location.search) return;
  if (options.replace === true) history.replaceState(null, '', path);
  else history.pushState(null, '', path);
  for (const listener of listeners) listener();
};

export const onRouteChange = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** Intercepts clicks on same-origin links so navigation stays inside the single-page app. */
export const installLinkInterception = (): void => {
  window.addEventListener('popstate', () => {
    for (const listener of listeners) listener();
  });
  document.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const target = event.target instanceof Element ? event.target.closest('a') : null;
    if (target === null || target.target !== '' || target.hasAttribute('download')) return;
    const url = new URL(target.href, location.href);
    if (url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
    event.preventDefault();
    navigate(url.pathname + url.search);
  });
};
