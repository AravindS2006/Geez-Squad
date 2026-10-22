export class ApiClientError extends Error {
  constructor(
    message: string,
    public status: number,
    public requestId?: string,
    public code?: string,
  ) {
    super(requestId ? `${message} (Reference: ${requestId})` : message);
    this.name = 'ApiClientError';
  }
}
export async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...options, cache: 'no-store' });
  const result = await response.json().catch(() => null);
  const requestId = result?.requestId || response.headers.get('X-Request-ID') || undefined;
  if (!response.ok || result === null)
    throw new ApiClientError(
      result?.error || 'This request failed. Please retry.',
      response.status,
      requestId,
      result?.code,
    );
  return result as T;
}
export function apiCommand(data: unknown) {
  return fetchJson<Record<string, unknown>>('/api/command', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}
