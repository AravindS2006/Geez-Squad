import { redactPath, redactText } from './redact';

export type ClientErrorSource = 'window' | 'rejection' | 'boundary' | 'global-boundary';
export type ClientErrorReport = {
  source: ClientErrorSource;
  name?: string;
  message: string;
  stack?: string;
  url?: string;
  digest?: string;
};

export const CLIENT_ERROR_ENDPOINT = '/api/client-errors';
/** Reports sent per page load, after duplicates are dropped. */
export const MAX_REPORTS_PER_PAGE = 5;

// Noise that says nothing about the app: opaque cross-origin script errors and a
// benign layout warning browsers raise as an error event.
const ignored = [/^Script error\.?$/i, /ResizeObserver loop/i];

/** Build a bounded, pre-redacted report. The server redacts again; this keeps payloads small. */
export function buildClientErrorReport(
  source: ClientErrorSource,
  error: unknown,
  href?: string,
  digest?: string,
): ClientErrorReport | undefined {
  const isError = error instanceof Error;
  const raw = isError
    ? error.message
    : typeof error === 'string'
      ? error
      : error && typeof error === 'object' && 'message' in error
        ? String((error as { message: unknown }).message)
        : 'Non-error value thrown';
  const message = redactText(raw, 500);
  if (!message || ignored.some((pattern) => pattern.test(message))) return undefined;
  return {
    source,
    name: isError ? error.name.slice(0, 80) : typeof error,
    message,
    stack: isError && error.stack ? error.stack.slice(0, 4000) : undefined,
    url: redactPath(href, 500),
    digest:
      typeof digest === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(digest) ? digest : undefined,
  };
}

/** Dedupe by error identity (not by source) and cap per page load. */
export function createClientErrorReporter(
  send: (body: string) => void,
  max = MAX_REPORTS_PER_PAGE,
) {
  const seen = new Set<string>();
  return (report: ClientErrorReport | undefined) => {
    if (!report || seen.size >= max) return false;
    const firstFrame = report.stack?.split('\n').find((line) => /:\d+:\d+/.test(line)) ?? '';
    const key = `${report.name}|${report.message}|${firstFrame.trim()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    try {
      send(JSON.stringify(report));
    } catch {
      /* Reporting must never throw into the page. */
    }
    return true;
  };
}

/** sendBeacon survives navigation and unload; fetch keepalive is the fallback. */
export function beaconSend(body: string) {
  // text/plain is CORS-safelisted, so every browser accepts it as a beacon.
  const blob = new Blob([body], { type: 'text/plain;charset=UTF-8' });
  if (typeof navigator !== 'undefined' && navigator.sendBeacon?.(CLIENT_ERROR_ENDPOINT, blob))
    return;
  void fetch(CLIENT_ERROR_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true,
    credentials: 'same-origin',
  }).catch(() => undefined);
}

let pageReporter: ReturnType<typeof createClientErrorReporter> | undefined;
/** Report one browser error. Safe to call from listeners and error boundaries. */
export function reportClientError(source: ClientErrorSource, error: unknown, digest?: string) {
  if (typeof window === 'undefined') return;
  pageReporter ??= createClientErrorReporter(beaconSend);
  pageReporter(buildClientErrorReport(source, error, window.location.href, digest));
}
