import type { FastifyReply, FastifyRequest } from 'fastify';

/**
 * DNS-rebinding and CSRF protection for a server bound to localhost: the Host header must
 * name an allowed host, and browser requests that change state must come from the same
 * origin. Without this, any website could drive the local API through the user's browser.
 */
export const createHostGuard = (allowedHostnames: readonly string[]) => {
  const allowed = new Set(allowedHostnames.map((host) => host.toLowerCase()));
  const hostnameOf = (hostHeader: string): string => {
    const value = hostHeader.toLowerCase();
    if (value.startsWith('[')) return value.slice(0, value.indexOf(']') + 1);
    return value.split(':')[0] ?? value;
  };

  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const host = request.headers.host;
    if (host === undefined || !allowed.has(hostnameOf(host))) {
      await reply.status(403).send({ error: { code: 'FORBIDDEN_HOST', message: 'Host not allowed' } });
      return;
    }
    const origin = request.headers.origin;
    const safeMethod = request.method === 'GET' || request.method === 'HEAD' || request.method === 'OPTIONS';
    // Defense in depth for browsers that omit Origin: Fetch Metadata names cross-site requests.
    const fetchSite = request.headers['sec-fetch-site'];
    if (!safeMethod && (fetchSite === 'cross-site' || fetchSite === 'same-site')) {
      await reply
        .status(403)
        .send({ error: { code: 'FORBIDDEN_ORIGIN', message: 'Cross-origin request rejected' } });
      return;
    }
    if (!safeMethod && origin !== undefined) {
      let originHost: string;
      try {
        originHost = new URL(origin).host;
      } catch {
        originHost = '';
      }
      if (originHost.toLowerCase() !== host.toLowerCase()) {
        await reply
          .status(403)
          .send({ error: { code: 'FORBIDDEN_ORIGIN', message: 'Cross-origin request rejected' } });
      }
    }
  };
};
