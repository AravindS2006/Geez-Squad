/** Minimal stand-ins for `@/lib/security` used by route-level unit tests. */
export class TestApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}
export function testSafeError(error: unknown) {
  if (error instanceof TestApiError)
    return Response.json({ error: error.message }, { status: error.status });
  return Response.json({ error: 'Something went wrong.' }, { status: 500 });
}
