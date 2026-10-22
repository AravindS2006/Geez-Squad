import type { Instrumentation } from 'next';
import { errorContext, logEvent } from './lib/logger';
export const onRequestError: Instrumentation.onRequestError = (error, _request, context) => {
  logEvent('error', 'server_render_error', {
    route: context.routePath,
    ...errorContext(error),
    digest:
      error && typeof error === 'object' && 'digest' in error ? String(error.digest) : undefined,
  });
};
