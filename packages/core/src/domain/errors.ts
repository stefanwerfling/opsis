/**
 * Machine-readable error codes shared by all adapters (REST, MCP, CLI).
 * Adapters map them to their transport (HTTP status, MCP isError result, exit code).
 */
export const ERROR_CODES = [
  'VALIDATION',
  'NOT_FOUND',
  'CONFLICT',
  'VERSION_CONFLICT',
  'INVALID_TRANSITION',
  'FORBIDDEN_ACTOR',
  'NOT_READY',
  'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_MEDIA',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export class OpsisError extends Error {
  readonly code: ErrorCode;
  readonly details: Readonly<Record<string, unknown>> | undefined;

  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'OpsisError';
    this.code = code;
    this.details = details;
  }
}

export const isOpsisError = (error: unknown): error is OpsisError => error instanceof OpsisError;
