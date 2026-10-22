'use client';
export default function ErrorPage({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <main className="error-page">
      <h1>Let’s try that again.</h1>
      <p>We couldn’t load this page. Your saved data is still there.</p>
      {error.digest && (
        <p>
          Support reference: <code>{error.digest}</code>
        </p>
      )}
      <button className="button lime" onClick={retry}>
        Try again
      </button>
      <a href="/demo">Open sample studio</a>
    </main>
  );
}
