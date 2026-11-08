import type { FastifyInstance } from 'fastify';
import { IMAGE_LIMITS, IMAGE_MIME_TYPES, OpsisError, completeUpload, type AppContext } from '@opsis/core';

/** Path of the upload URL; the token in it is redacted from logs (see app.ts). */
export const UPLOAD_PATH_PREFIX = '/api/v1/uploads/';

const ACCEPTED_TYPES = [...IMAGE_MIME_TYPES, 'application/octet-stream'];

/**
 * Second stage of the two-stage upload: `PUT <upload_url>` with the raw image as body
 * (e.g. `curl -T shot.png -H 'content-type: image/png' <upload_url>`). The one-time
 * token in the URL is the authorization. The content decides the format, not the header.
 */
export const registerUploadRoute = async (app: FastifyInstance, ctx: AppContext): Promise<void> => {
  await app.register((scope) => {
    scope.addContentTypeParser(
      ACCEPTED_TYPES,
      { parseAs: 'buffer', bodyLimit: IMAGE_LIMITS.maxBytes },
      (_request, body, done) => {
        done(null, body);
      },
    );
    scope.put<{ Params: { token: string } }>(`${UPLOAD_PATH_PREFIX}:token`, async (request, reply) => {
      const body = request.body;
      if (!Buffer.isBuffer(body) || body.byteLength === 0) {
        throw new OpsisError('UNSUPPORTED_MEDIA', 'Expected the raw image as request body');
      }
      const result = await completeUpload(
        ctx,
        request.params.token,
        new Uint8Array(body.buffer, body.byteOffset, body.byteLength),
      );
      return reply.status(201).send({
        session_id: result.session.id,
        screenshot_id: result.screenshot.id,
        ui_id: result.uiView.uiId,
        status: result.session.status,
      });
    });
    return Promise.resolve();
  });
};
