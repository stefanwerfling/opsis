import { resolve } from 'node:path';

export interface OpsisConfig {
  readonly host: string;
  readonly port: number;
  readonly dataDir: string;
  /** Additional host names accepted in the Host header (DNS-rebinding protection). */
  readonly allowedHosts: readonly string[];
  readonly logLevel: string;
}

const parsePort = (value: string | undefined, fallback: number): number => {
  if (value === undefined || value === '') return fallback;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) throw new Error(`Invalid OPSIS_PORT "${value}"`);
  return port;
};

export const loadConfig = (env: NodeJS.ProcessEnv = process.env): OpsisConfig => ({
  host: env['OPSIS_HOST'] ?? '127.0.0.1',
  port: parsePort(env['OPSIS_PORT'], 4777),
  dataDir: resolve(env['OPSIS_DATA_DIR'] ?? 'data'),
  allowedHosts: (env['OPSIS_ALLOWED_HOSTS'] ?? '')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter((host) => host.length > 0),
  logLevel: env['OPSIS_LOG_LEVEL'] ?? 'info',
});
