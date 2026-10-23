'use client';
import { useEffect, useState } from 'react';
import { fetchJson } from '@/lib/client';
type Trainees = {
  trainees: {
    id: string;
    name: string;
    goal: string;
    primaryCoach: { note: string; assignedAt: string };
  }[];
};
export function InPersonTrainees() {
  const [data, setData] = useState<Trainees | null>(null),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    void fetchJson<Trainees>('/api/studio-team/trainees')
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
  if (!data?.trainees.length && !error) return null;
  return (
    <section className="panel team-access">
      <h2>Assigned in-person trainees</h2>
      <p>
        These members can train at the studio without an app account. Online plans and progress
        become available after account connection.
      </p>
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
      <p role="status">{notice}</p>
      {data?.trainees.map((t) => (
        <details key={t.id}>
          <summary>{t.name}</summary>
          <form
            className="form-stack"
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              setBusy(true);
              setError('');
              setNotice('');
              try {
                await fetchJson('/api/studio-team/trainees', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    memberId: t.id,
                    goal: f.get('goal'),
                    note: f.get('note'),
                  }),
                });
                setNotice('Coaching details saved.');
              } catch (e) {
                setError(e instanceof Error ? e.message : 'Please retry.');
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              Training goal for {t.name}
              <input name="goal" defaultValue={t.goal} maxLength={160} />
            </label>
            <label>
              Coaching note for {t.name}
              <textarea name="note" defaultValue={t.primaryCoach.note} maxLength={2000} />
            </label>
            <button className="button outline" disabled={busy}>
              Save coaching details
            </button>
          </form>
        </details>
      ))}
    </section>
  );
}
