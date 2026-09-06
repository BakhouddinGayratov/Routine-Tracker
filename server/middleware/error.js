import { config } from '../config.js';
import { ApiError } from '../lib/errors.js';

export function notFound(req, res, next) {
  if (req.path.startsWith('/api/')) {
    return next(ApiError.notFound(`No API route for ${req.method} ${req.path}`));
  }
  next();
}

export function errorHandler(err, req, res, _next) {
  const status = err.status || err.statusCode || 500;

  if (status >= 500) {
    console.error(`[error] ${req.method} ${req.originalUrl}`, err);
  }

  const body = {
    error: {
      message:
        status >= 500 && config.isProd
          ? 'Something went wrong on our side. Please try again.'
          : err.message || 'Unexpected error',
    },
  };
  if (err instanceof ApiError && err.details) body.error.fields = err.details;
  if (status >= 500 && !config.isProd) body.error.stack = err.stack;

  res.status(status).json(body);
}

/** Wrap an async handler so rejected promises reach the error handler. */
export function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}
