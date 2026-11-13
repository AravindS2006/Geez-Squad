/**
 * Content Security Policy for Geez Squad.
 *
 * Documents get a per-request nonce from `src/proxy.ts`: Next.js reads the nonce from the request
 * CSP header and stamps it on its own bootstrap/flight scripts, and 'strict-dynamic' lets those
 * trusted scripts load the page chunks and MediaPipe's loader. No 'unsafe-inline' for scripts.
 *
 * Static worker/offline documents in public/ (pose worker, service worker, offline page) cannot
 * carry a nonce, so they get the same policy without it (script-src 'self'). The pose worker loads
 * /vision and /wasm with importScripts, which needs 'self' and must not use 'strict-dynamic'.
 *
 * 'wasm-unsafe-eval' lets MediaPipe compile its WASM pose model. 'unsafe-eval' is development-only
 * (React uses eval for server error stacks in dev). style-src keeps 'unsafe-inline' because React
 * style attributes and next/font emit inline styles.
 */
export type CspOptions = {
  nonce?: string;
  livekitUrl?: string;
  isDev?: boolean;
};

export function liveKitSources(livekitUrl?: string): string {
  const livekit = livekitUrl || 'wss://*.livekit.cloud';
  const endpoint = livekit.startsWith('wss://')
    ? livekit.replace('wss://', 'https://')
    : livekit.replace('ws://', 'http://');
  // LiveKit Cloud selects and reconnects through regional hosts.
  const cloudSources =
    livekit.endsWith('.livekit.cloud') || livekit.includes('*.livekit.cloud')
      ? ' wss://*.livekit.cloud https://*.livekit.cloud'
      : '';
  return `${livekit} ${endpoint}${cloudSources}`;
}

export function buildContentSecurityPolicy({ nonce, livekitUrl, isDev }: CspOptions = {}): string {
  const scriptSrc = [
    "'self'",
    ...(nonce ? [`'nonce-${nonce}'`, "'strict-dynamic'"] : []),
    "'wasm-unsafe-eval'",
    ...(isDev ? ["'unsafe-eval'"] : []),
  ].join(' ');
  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self' ${liveKitSources(livekitUrl)}`,
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}

/** 128 random bits, base64. Uses Web Crypto so it works in any proxy runtime. */
export function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
