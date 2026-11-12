// Browser-safe redaction shared by the server logger and the client error reporter.
// Error text can carry emails, tokens, reset links or provider responses. Keep the
// first line only, strip URL queries and anything that looks like a credential.

const sensitiveKey =
  /\b(access[_-]?token|refresh[_-]?token|id[_-]?token|token|secret|password|passwd|pwd|api[_-]?key|apikey|key|auth|authorization|code|session|cookie|signature|sig|otp)\b(\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s&,;"')]+)/gi;

export function redactText(value: unknown, max = 180): string {
  if (typeof value !== 'string') return '';
  const line =
    value
      .split(/[\r\n]+/)
      .map((part) => part.trim())
      .find(Boolean) ?? '';
  return (
    line
      .slice(0, 600)
      // URL query strings and fragments often carry tokens.
      .replace(/(\b(?:https?|wss?):\/\/[^\s?#"'<>]*)[?#][^\s"'<>]*/gi, '$1')
      .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [redacted]')
      .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)?/g, '[token]')
      .replace(sensitiveKey, '$1$2[redacted]')
      .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]')
      // Long mixed letter-and-digit runs: ids, API keys, reset or session tokens.
      .replace(/[A-Za-z0-9+_-]{21,}={0,2}/g, (run) =>
        /\d/.test(run) && /[A-Za-z]/.test(run) ? '[token]' : run,
      )
      .replace(/\+?\d[\d -]{6,}\d/g, '[number]')
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .slice(0, max)
  );
}

/** Path only: no origin, query or fragment, and id- or token-like segments masked. */
export function redactPath(value: unknown, max = 180): string | undefined {
  if (typeof value !== 'string' || !value) return undefined;
  let pathname: string;
  try {
    pathname = new URL(value, 'http://path.invalid').pathname;
  } catch {
    return undefined;
  }
  return pathname
    .split('/')
    .map((segment) => {
      let decoded = segment;
      try {
        decoded = decodeURIComponent(segment);
      } catch {
        /* Keep the raw segment. */
      }
      if (decoded.includes('@')) return ':email';
      if (/^\d{3,}$/.test(decoded)) return ':id';
      if (decoded.length >= 16 && /\d/.test(decoded) && /^[A-Za-z0-9_.~-]+$/.test(decoded))
        return ':id';
      return /^[A-Za-z0-9_.~-]*$/.test(decoded) ? decoded : ':value';
    })
    .join('/')
    .slice(0, max);
}

/** File:line:column frames only, so hosts, query strings and local paths never reach logs. */
export function stackFrames(stack: unknown, limit = 4): string | undefined {
  if (typeof stack !== 'string') return undefined;
  const frames = stack
    .split('\n')
    .map((line) => line.match(/([A-Za-z0-9_.[\]-]+\.(?:tsx?|m?jsx?|cjs)):(\d+):(\d+)/))
    .filter((match): match is RegExpMatchArray => !!match)
    .map((match) => `${match[1]}:${match[2]}:${match[3]}`)
    .slice(0, limit);
  return frames.length ? frames.join(' <- ') : undefined;
}
