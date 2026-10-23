'use client';
import { useCallback, useEffect, useState } from 'react';
import { fetchJson } from '@/lib/client';
import { ShieldCheck, UserRoundCog } from 'lucide-react';
type Team = {
  history: { id: string; memberId: string; assignedAt: string; endedAt: string; note: string }[];
  ownerId: string;
  grants: {
    id: string;
    userId: string;
    role: string;
    status: string;
    user: { name: string; email: string };
  }[];
  requests: { id: string; email: string; status: string; expiresAt: string }[];
  members: {
    id: string;
    name: string;
    primaryCoach: { coachId: string; assignedAt: string; note: string } | null;
  }[];
};
export function StudioTeam() {
  const [data, setData] = useState<Team | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const refresh = useCallback(async () => setData(await fetchJson<Team>('/api/studio-team')), []);
  useEffect(() => {
    void refresh().catch((e) => setError(e.message));
  }, [refresh]);
  async function act(command: Record<string, unknown>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await fetchJson('/api/studio-team', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(command),
      });
      await refresh();
      setNotice(
        command.action === 'invite'
          ? 'Coach invitation email sent. The recipient must verify and accept inside the app.'
          : 'Team access updated.',
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Please retry.');
      await refresh().catch(() => {});
    } finally {
      setBusy(false);
    }
  }
  const coaches = data?.grants.filter((g) => g.status === 'active') ?? [];
  return (
    <section className="panel team-access" aria-labelledby="team-access-title">
      <div className="section-title">
        <div>
          <span className="eyebrow">PERMISSIONS</span>
          <h2 id="team-access-title">
            <ShieldCheck size={22} aria-hidden="true" /> Studio access
          </h2>
          <p>
            Admins manage the studio. Coaches see assigned trainees and classes they host. Directory
            job titles do not grant app access.
          </p>
        </div>
      </div>
      <form
        className="form-stack"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          void act({ action: 'invite', email: f.get('email') });
        }}
      >
        <label>
          Coach’s personal email
          <input name="email" type="email" required maxLength={254} placeholder="coach@gmail.com" />
        </label>
        <button className="button dark" disabled={busy}>
          Send coach invitation email
        </button>
      </form>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      <p role="status">{notice}</p>
      <div className="team-access-list">
        {data?.grants.map((g) => (
          <article key={g.id} className="studio-request">
            <div>
              <h3>{g.user.name}</h3>
              <p>{g.user.email}</p>
              <span className="status-pill">
                {g.role} · {g.status}
                {g.userId === data.ownerId ? ' · Protected owner' : ''}
              </span>
            </div>
            {g.userId !== data.ownerId && g.role === 'coach' && (
              <div className="form-actions">
                <button
                  className="button outline"
                  disabled={busy}
                  onClick={() =>
                    void act({
                      action: 'status',
                      userId: g.userId,
                      status: g.status === 'active' ? 'suspended' : 'active',
                    })
                  }
                >
                  {g.status === 'active' ? 'Suspend coach' : 'Restore coach role'}
                </button>
                {g.status !== 'revoked' && (
                  <button
                    className="button outline"
                    disabled={busy}
                    onClick={() => {
                      if (
                        window.confirm(
                          'Revoke coaching access? Primary assignments will be cleared and upcoming/live classes will transfer to the admin.',
                        )
                      )
                        void act({ action: 'status', userId: g.userId, status: 'revoked' });
                    }}
                  >
                    Revoke coach
                  </button>
                )}
              </div>
            )}
          </article>
        ))}
      </div>
      {!!data?.requests.filter((r) => r.status === 'pending').length && (
        <h3>Pending coach confirmations</h3>
      )}
      {data?.requests
        .filter((r) => r.status === 'pending')
        .map((r) => (
          <div className="studio-request" key={r.id}>
            <div>
              <strong>{r.email}</strong>
              <p>{Date.parse(r.expiresAt) > Date.now() ? 'Awaiting acceptance' : 'Expired'}</p>
            </div>
            <div className="form-actions">
              <button
                className="button outline"
                disabled={busy}
                onClick={() => void act({ action: 'invite', email: r.email })}
              >
                Send invitation email
              </button>
              <button
                className="button outline"
                disabled={busy}
                onClick={() => void act({ action: 'withdraw', requestId: r.id })}
              >
                Withdraw
              </button>
            </div>
          </div>
        ))}
      <h3>
        <UserRoundCog size={19} aria-hidden="true" /> Primary coach assignments
      </h3>
      <p className="microcopy">
        One primary coach per trainee. Reassignment starts a new visibility period and removes the
        previous coach’s profile access.
      </p>
      {data?.members.map((m) => (
        <div className="studio-request" key={m.id}>
          <div>
            <strong>{m.name}</strong>
            {m.primaryCoach && (
              <p>Assigned {new Date(m.primaryCoach.assignedAt).toLocaleDateString('en-IN')}</p>
            )}
            {(m.primaryCoach?.note || data.history.some((h) => h.memberId === m.id && h.note)) && (
              <details>
                <summary>Coaching notes &amp; assignment history</summary>
                {m.primaryCoach?.note && <p>Current assignment: {m.primaryCoach.note}</p>}
                {data.history
                  .filter((h) => h.memberId === m.id)
                  .map((h) => (
                    <p key={h.id}>
                      {new Date(h.assignedAt).toLocaleDateString('en-IN')} –{' '}
                      {new Date(h.endedAt).toLocaleDateString('en-IN')}:{' '}
                      {h.note || 'No note recorded'}
                    </p>
                  ))}
              </details>
            )}
          </div>
          <label>
            Primary coach for {m.name}
            <select
              disabled={busy}
              value={m.primaryCoach?.coachId ?? ''}
              onChange={(e) =>
                void act({ action: 'assign', memberId: m.id, coachId: e.target.value || null })
              }
            >
              <option value="">Unassigned · Admin can coach</option>
              {coaches.map((g) => (
                <option key={g.id} value={g.userId}>
                  {g.user.name} ({g.role})
                </option>
              ))}
            </select>
          </label>
        </div>
      ))}
    </section>
  );
}
