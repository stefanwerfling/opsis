import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface OpsisConfig {
  readonly host: string;
  readonly port: number;
  readonly dataDir: string;
  /** Additional host names accepted in the Host header (DNS-rebinding protection). */
  readonly allowedHosts: readonly string[];
  readonly logLevel: string;
  /** Built web UI; undefined when it has not been built (API-only operation). */
  readonly webRoot: string | undefined;
  /** Base URL in links handed to agents; default derived from host and port. */
  readonly publicUrl: string;
}

/** packages/server/{src,dist}/config.* → packages/web/dist */
const DEFAULT_WEB_ROOT = fileURLToPath(new URL('../../web/dist', import.meta.url));

const resolveWebRoot = (configured: string | undefined): string | undefined => {
  const root = resolve(configured ?? DEFAULT_WEB_ROOT);
  return existsSync(join(root, 'index.html')) ? root : undefined;
};

const parsePort = (value: string | undefined, fallback: number): number => {
  if (value === undefined || value === '') return fallback;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) throw new Error(`Invalid OPSIS_PORT "${value}"`);
  return port;
};

const defaultPublicUrl = (host: string, port: number): string => {
  const shown = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host.includes(':') ? `[${host}]` : host;
  return `http://${shown}:${String(port)}`;
};

export const loadConfig = (env: NodeJS.ProcessEnv = process.env): OpsisConfig => {
  const host = env['OPSIS_HOST'] ?? '127.0.0.1';
  const port = parsePort(env['OPSIS_PORT'], 4777);
  return {
    host,
    port,
    publicUrl: env['OPSIS_PUBLIC_URL'] ?? defaultPublicUrl(host, port),
    dataDir: resolve(env['OPSIS_DATA_DIR'] ?? 'data'),
    allowedHosts: (env['OPSIS_ALLOWED_HOSTS'] ?? '')
      .split(',')
      .map((host) => host.trim().toLowerCase())
      .filter((host) => host.length > 0),
    logLevel: env['OPSIS_LOG_LEVEL'] ?? 'info',
    webRoot: resolveWebRoot(env['OPSIS_WEB_DIR']),
  };
};
