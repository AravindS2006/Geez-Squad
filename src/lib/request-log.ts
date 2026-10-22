import { AsyncLocalStorage } from 'node:async_hooks';
import { logEvent } from './logger';
export const requestContext = new AsyncLocalStorage<{
  requestId: string;
  route: string;
  method: string;
}>();
export function loggedRoute<T extends unknown[]>(
  route: string,
  handler: (request: Request, ...args: T) => Promise<Response>,
) {
  return async (request: Request, ...args: T) => {
    const context = { requestId: crypto.randomUUID(), route, method: request.method };
    const started = performance.now();
    return requestContext.run(context, async () => {
      try {
        const response = await handler(request, ...args);
        response.headers.set('X-Request-ID', context.requestId);
        if (!response.headers.has('Cache-Control'))
          response.headers.set('Cache-Control', 'private, no-store');
        logEvent(
          response.status >= 500 ? 'error' : response.status >= 400 ? 'warn' : 'info',
          'request_complete',
          {
            ...context,
            status: response.status,
            durationMs: Math.round(performance.now() - started),
          },
        );
        return response;
      } catch (error) {
        logEvent('error', 'request_unhandled', context);
        throw error;
      }
    });
  };
}
