import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { isOpsisError, type ErrorCode } from '@opsis/core';

export const HTTP_STATUS: Readonly<Record<ErrorCode, number>> = {
  VALIDATION: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN_ACTOR: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  VERSION_CONFLICT: 409,
  INVALID_TRANSITION: 409,
  NOT_READY: 409,
  INCOMPLETE: 422,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA: 415,
};

export interface ErrorBody {
  readonly error: { readonly code: string; readonly message: string; readonly details?: unknown };
}

/** Maps domain and framework errors to a uniform JSON body; internals are logged, never exposed. */
export const errorHandler = (
  error: FastifyError | Error,
  request: FastifyRequest,
  reply: FastifyReply,
): void => {
  if (isOpsisError(error)) {
    const body: ErrorBody = {
      error: {
        code: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
      },
    };
    if (error.code === 'UNAUTHENTICATED') void reply.header('www-authenticate', 'Bearer');
    void reply.status(HTTP_STATUS[error.code]).send(body);
    return;
  }
  const statusCode = 'statusCode' in error && typeof error.statusCode === 'number' ? error.statusCode : 500;
  if (statusCode >= 500) {
    request.log.error({ err: error }, 'unhandled error');
    void reply
      .status(500)
      .send({ error: { code: 'INTERNAL', message: 'Internal server error' } } satisfies ErrorBody);
    return;
  }
  const code =
    statusCode === 413 ? 'PAYLOAD_TOO_LARGE' : statusCode === 415 ? 'UNSUPPORTED_MEDIA' : 'VALIDATION';
  void reply.status(statusCode).send({ error: { code, message: error.message } } satisfies ErrorBody);
};
