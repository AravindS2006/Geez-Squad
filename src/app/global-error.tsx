'use client';
// Replaces the root layout when it fails, so styles are inline and self-contained.
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  const digest =
    typeof error === 'object' && error && 'digest' in error ? String(error.digest) : undefined;
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          background: '#f7f8f4',
          color: '#1d241f',
          fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif",
        }}
      >
        <title>Something went wrong · Geez Squad</title>
        <main style={{ maxWidth: 420, padding: 24, textAlign: 'center' }}>
          <h1 style={{ fontSize: 28, margin: '0 0 8px' }}>Let’s try that again.</h1>
          <p style={{ color: '#4f5a49', lineHeight: 1.6 }}>
            Geez Squad hit an unexpected problem. Your saved data is safe.
          </p>
          {digest && (
            <p style={{ color: '#6b7563', fontSize: 13 }}>
              Support reference: <code>{digest}</code>
            </p>
          )}
          <button
            onClick={() => retry()}
            style={{
              minHeight: 44,
              padding: '0 20px',
              border: 0,
              borderRadius: 10,
              background: '#26392b',
              color: '#fff',
              fontSize: 15,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
