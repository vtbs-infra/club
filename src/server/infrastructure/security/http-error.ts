import type { FastifyError } from 'fastify';

import { AppError } from '../../../shared/errors/app-error.js';

export function publicHttpError(error: FastifyError): AppError {
  if (error instanceof AppError) return error;
  if (error.validation) {
    return new AppError('VALIDATION_ERROR', 'The request did not match the expected schema.', 400);
  }
  // Fastify and its multipart plugin identify their own request errors with FST_ codes.
  if (
    error.code?.startsWith('FST_') &&
    error.statusCode &&
    error.statusCode >= 400 &&
    error.statusCode < 500
  ) {
    const message =
      error.statusCode === 413
        ? 'The request or uploaded file exceeds the size limit.'
        : 'The request body or content type is invalid.';
    return new AppError(error.code, message, error.statusCode);
  }
  return new AppError('INTERNAL_SERVER_ERROR', 'An unexpected error occurred.', 500);
}
