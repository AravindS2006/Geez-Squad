'use client';
import { useEffect, useState } from 'react';
import { fetchJson } from '@/lib/client';
import { useTimeFormat } from './time-provider';
type Classes = {
  classes: {
    id: string;
    title: string;
    location: string;
    startsAt: string;
    status: string;
    bookings: { id: string; member: { name: string } }[];
  }[];
};
export function HostedClasses() {
  const [data, setData] = useState<Classes | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const { dateLabel, timeLabel } = useTimeFormat();
  useEffect(() => {
    let active = true;
    void fetchJson<Classes>('/api/studio-team/classes')
      .then((d) => {
        if (active) setData(d);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  async function act(classId: string, action: 'cancel' | 'complete') {
    setBusy(true);
    setError('');
    try {
      await fetchJson('/api/studio-team/classes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ classId, action }),
      });
      setData(await fetchJson<Classes>('/api/studio-team/classes'));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Please retry.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel hosted-classes">
      <h1>Your hosted studio classes</h1>
      <p>
        Roster access is limited to these classes. Long-term coaching profiles follow primary
        assignments.
      </p>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {data?.classes.map((c) => (
        <article className="studio-request" key={c.id}>
          <div>
            <h2>{c.title}</h2>
            <p>
              {dateLabel(c.startsAt)} · {timeLabel(c.startsAt)} · {c.location} · {c.status}
            </p>
            <details>
              <summary>Class roster · {c.bookings.length} booked</summary>
              <ul>
                {c.bookings.map((b) => (
                  <li key={b.id}>{b.member.name}</li>
                ))}
              </ul>
            </details>
          </div>
          {c.status === 'scheduled' && (
            <div className="form-actions">
              <button
                className="button outline"
                disabled={busy || Date.parse(c.startsAt) > Date.now()}
                onClick={() => void act(c.id, 'complete')}
              >
                Mark complete
              </button>
              <button
                className="button outline"
                disabled={busy}
                onClick={() => {
                  if (window.confirm('Cancel this class and release all bookings?'))
                    void act(c.id, 'cancel');
                }}
              >
                Cancel class
              </button>
            </div>
          )}
        </article>
      ))}
      {data?.classes.length === 0 && <p>An admin can appoint you as a class host.</p>}
    </section>
  );
}
