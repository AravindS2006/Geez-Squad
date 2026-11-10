import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="error-page">
      <h1>This page stepped out.</h1>
      <p>Find your next session in your studio.</p>
      <Link className="button lime" href="/">
        Back to Geez Squad
      </Link>
    </main>
  );
}
