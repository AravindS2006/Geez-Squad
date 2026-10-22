'use client';
import { useEffect, useState } from 'react';
import { CreditCard, CalendarCheck } from 'lucide-react';
import { fetchJson } from '@/lib/client';
import { money, studioToday, selectCurrentTerm } from '@/lib/studio-operations';
type MembershipSummary = {
  id: string;
  name: string;
  status: string;
  studio: { name: string; phone: string };
  terms: {
    id: string;
    planName: string;
    feePaise: number;
    startsOn: string;
    endsOn: string;
    status: string;
    payments: { amountPaise: number }[];
  }[];
  attendance: { date: string }[];
};
export function MemberMembership() {
  const [rows, setRows] = useState<MembershipSummary[]>([]),
    [error, setError] = useState('');
  useEffect(() => {
    const c = new AbortController();
    fetchJson<{ memberships: MembershipSummary[] }>('/api/my-membership', { signal: c.signal })
      .then((d) => setRows(d.memberships))
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      });
    return () => c.abort();
  }, []);
  if (error)
    return (
      <p className="inline-notice" role="status">
        {error}
      </p>
    );
  if (!rows.length) return null;
  const today = studioToday();
  return (
    <section className="ops-member-membership panel">
      <h2>
        <CreditCard size={20} />
        Your studio membership
      </h2>
      {rows.map((m) => {
        const term = selectCurrentTerm(m.terms, today);
        const due = m.terms
          .filter((t) => t.status !== 'cancelled')
          .reduce(
            (s, t) =>
              s + Math.max(0, t.feePaise - t.payments.reduce((s, p) => s + p.amountPaise, 0)),
            0,
          );
        return (
          <div key={m.id}>
            <div>
              <strong>
                {m.studio.name} · {term?.planName || 'No plan assigned'}
              </strong>
              <p>
                {term
                  ? `${term.startsOn} → ${term.endsOn}`
                  : 'Contact your studio to choose a membership.'}
              </p>
              <span className="ops-badge green">
                {m.status === 'active' && term && term.startsOn <= today && term.endsOn >= today
                  ? 'Active'
                  : m.status !== 'active'
                    ? m.status
                    : term && term.startsOn > today
                      ? 'Upcoming'
                      : 'Membership ended'}
              </span>
            </div>
            <div>
              <strong>{due ? `${money(due)} balance due` : 'No outstanding balance'}</strong>
              <p>
                <CalendarCheck size={13} />
                Last visit: {m.attendance[0]?.date || 'Not yet'}
              </p>
              {m.studio.phone && <small>Studio: {m.studio.phone}</small>}
            </div>
          </div>
        );
      })}
    </section>
  );
}
