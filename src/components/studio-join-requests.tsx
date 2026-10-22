'use client';
import { useEffect, useState } from 'react';
import { fetchJson } from '@/lib/client';
type Requests = { requests: { id: string; studioName: string }[]; verificationRequired: boolean };
export function StudioJoinRequests() {
  const [data, setData] = useState<Requests | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    async function refresh() {
      try {
        const result = await fetchJson<Requests>('/api/studio-join-requests');
        if (active) {
          setData(result);
          setError('');
        }
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : 'Studio requests could not load.');
      }
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 15000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  async function respond(requestId: string, action: 'accept' | 'decline') {
    setBusy(true);
    setError('');
    try {
      await fetchJson('/api/studio-join-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId, action }),
      });
      if (action === 'accept') window.location.href = '/app';
      else
        setData((previous) =>
          previous
            ? { ...previous, requests: previous.requests.filter((r) => r.id !== requestId) }
            : null,
        );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Please retry.');
    } finally {
      setBusy(false);
    }
  }
  if (!error && !data?.verificationRequired && !data?.requests.length) return null;
  return (
    <section className="panel studio-requests" aria-label="Studio requests">
      <h2>Your studio connections</h2>
      {data?.verificationRequired && (
        <p>
          Verify your email to see and accept studio requests.{' '}
          <a className="text-link" href="/login?mode=verify">
            Verify email
          </a>
        </p>
      )}
      {data?.requests.map((request) => (
        <div className="studio-request" key={request.id}>
          <div>
            <h3>{request.studioName}</h3>
            <p>
              Your studio has added you as a member. Accept to share your coaching progress and see
              your membership, payments and visits.
            </p>
          </div>
          <div className="form-actions">
            <button
              className="button outline"
              disabled={busy}
              onClick={() => void respond(request.id, 'decline')}
            >
              Decline
            </button>
            <button
              className="button dark"
              disabled={busy}
              onClick={() => void respond(request.id, 'accept')}
            >
              Accept studio request
            </button>
          </div>
        </div>
      ))}
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
