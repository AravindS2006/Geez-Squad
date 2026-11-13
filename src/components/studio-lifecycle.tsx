'use client';
import { useCallback, useEffect, useState } from 'react';
import { Building2, KeyRound, DoorClosed } from 'lucide-react';
import { Modal, SectionTitle } from './ui';
import { fetchJson } from '@/lib/client';
import {
  OWNERSHIP_TRANSFER_CONFIRMATION,
  STUDIO_CLOSE_CONFIRMATION,
} from '@/lib/studio-lifecycle-policy';

type RequestView = {
  id: string;
  name: string;
  contactPhone: string;
  note: string;
  status: string;
  createdAt: string;
  requester?: { name: string; email: string; emailVerified: boolean };
};
type RequestsData = { operator: boolean; mine: RequestView | null; pending: RequestView[] };
type OwnershipData =
  | { owner: false }
  | {
      owner: true;
      studio: { id: string; name: string };
      candidates: { id: string; name: string; role: string }[];
    };

const post = (url: string, body: unknown) =>
  fetchJson<Record<string, unknown>>(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
const message = (err: unknown) => (err instanceof Error ? err.message : 'Please retry.');

/**
 * Settings panel: a studio request form for accounts without a studio, and the
 * pending-request review list for platform operators (decided by the server).
 */
export function StudioRequests({
  hasStudio,
  notify,
}: {
  hasStudio: boolean;
  notify: (m: string) => void;
}) {
  const [data, setData] = useState<RequestsData | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const load = useCallback(
    () =>
      fetchJson<RequestsData>('/api/studio-requests')
        .then(setData)
        .catch(() => setData(null)),
    [],
  );
  useEffect(() => {
    fetchJson<RequestsData>('/api/studio-requests')
      .then(setData)
      .catch(() => setData(null));
  }, []);
  if (!data || (hasStudio && !data.operator)) return null;
  const run = async (key: string, body: unknown, done: string) => {
    setBusy(key);
    setError('');
    try {
      const result = await post('/api/studio-requests', body);
      notify(result.repeated ? 'This request was already reviewed.' : done);
      await load();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy('');
    }
  };
  const mine = data.mine;
  return (
    <section className="panel">
      <SectionTitle
        title={data.operator ? 'Studio requests' : 'Run a studio'}
        action={data.operator ? <span className="pill">{data.pending.length}</span> : undefined}
      />
      {!hasStudio && mine?.status === 'pending' && (
        <div className="settings-feature">
          <Building2 size={21} />
          <div>
            <h3>{mine.name} is waiting for review.</h3>
            <p>An operator reviews each studio request. You become its owner once approved.</p>
            <button
              className="button outline"
              disabled={!!busy}
              onClick={() =>
                run('withdraw', { action: 'withdraw', requestId: mine.id }, 'Request withdrawn.')
              }
            >
              Withdraw request
            </button>
          </div>
        </div>
      )}
      {!hasStudio && mine?.status !== 'pending' && (
        <form
          className="form-stack"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void run(
              'submit',
              {
                action: 'submit',
                name: String(f.get('name') ?? ''),
                contactPhone: String(f.get('contactPhone') ?? ''),
                note: String(f.get('note') ?? ''),
              },
              'Studio request sent for review.',
            );
          }}
        >
          <p>
            {mine?.status === 'rejected'
              ? 'Your last request was not approved. You can send a new one.'
              : 'Request a studio workspace. An operator reviews it and makes you its owner and first admin.'}
          </p>
          <label>
            Studio name
            <input name="name" required minLength={2} maxLength={80} />
          </label>
          <label>
            Contact phone
            <input name="contactPhone" type="tel" required minLength={6} maxLength={40} />
          </label>
          <label>
            Note for the reviewer (optional)
            <textarea name="note" maxLength={600} rows={3} />
          </label>
          <button className="button dark" disabled={!!busy}>
            {busy === 'submit' ? 'Sending…' : 'Request a studio'}
          </button>
        </form>
      )}
      {data.operator &&
        (data.pending.length ? (
          data.pending.map((r) => (
            <div className="settings-feature" key={r.id}>
              <Building2 size={21} />
              <div>
                <h3>{r.name}</h3>
                <p>
                  {r.requester?.name} · {r.requester?.email}
                  {r.requester && !r.requester.emailVerified ? ' (email not verified)' : ''} ·{' '}
                  {r.contactPhone}
                </p>
                {r.note && <p className="microcopy">{r.note}</p>}
                <button
                  className="button dark"
                  disabled={!!busy}
                  onClick={() =>
                    run(r.id, { action: 'approve', requestId: r.id }, `${r.name} approved.`)
                  }
                >
                  {busy === r.id ? 'Approving…' : 'Approve'}
                </button>{' '}
                <button
                  className="button outline"
                  disabled={!!busy}
                  onClick={() =>
                    run(r.id, { action: 'reject', requestId: r.id }, `${r.name} declined.`)
                  }
                >
                  Decline
                </button>
              </div>
            </div>
          ))
        ) : (
          <p className="microcopy">No studio requests are waiting.</p>
        ))}
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
    </section>
  );
}

/** Settings panel for the studio owner: transfer ownership or close the studio. */
export function StudioOwnership({ notify }: { notify: (m: string) => void }) {
  const [data, setData] = useState<OwnershipData | null>(null);
  const [open, setOpen] = useState<'transfer' | 'close' | null>(null);
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    fetchJson<OwnershipData>('/api/studio-ownership')
      .then(setData)
      .catch(() => setData(null));
  }, []);
  if (!data?.owner) return null;
  const word = open === 'close' ? STUDIO_CLOSE_CONFIRMATION : OWNERSHIP_TRANSFER_CONFIRMATION;
  const reset = () => {
    if (busy) return;
    setOpen(null);
    setConfirm('');
    setError('');
  };
  return (
    <section className="panel">
      <SectionTitle title="Studio ownership" />
      <div className="settings-feature">
        <KeyRound size={21} />
        <div>
          <h3>Hand the studio to someone else.</h3>
          <p>
            Transfer ownership of {data.studio.name} to a current admin, coach or member. You stay
            an admin until the new owner changes that.
          </p>
        </div>
      </div>
      <button
        className="button outline"
        disabled={!data.candidates.length}
        onClick={() => setOpen('transfer')}
      >
        Transfer ownership
      </button>
      <div className="settings-feature">
        <DoorClosed size={21} />
        <div>
          <h3>Close the studio.</h3>
          <p>
            Ends live classes, cancels scheduled ones and removes everyone’s access. Member, payment
            and attendance records are kept. This cannot be undone here.
          </p>
        </div>
      </div>
      <button className="button outline" onClick={() => setOpen('close')}>
        Close studio
      </button>
      {open && (
        <Modal
          title={open === 'close' ? `Close ${data.studio.name}` : 'Transfer studio ownership'}
          onClose={reset}
        >
          <form
            className="form-stack"
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              setBusy(true);
              setError('');
              try {
                await post('/api/studio-ownership', {
                  action: open,
                  ...(open === 'transfer' ? { userId: String(f.get('userId')) } : {}),
                  confirm: String(f.get('confirm')),
                  password: String(f.get('password')),
                });
                notify(open === 'close' ? 'Studio closed.' : 'Ownership transferred.');
                // Permissions changed: reload so every panel reads the new studio access.
                window.location.reload();
              } catch (err) {
                setError(message(err));
                setBusy(false);
              }
            }}
          >
            {open === 'transfer' ? (
              <label>
                New owner
                <select name="userId" required defaultValue="">
                  <option value="" disabled>
                    Choose a person
                  </option>
                  {data.candidates.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.role})
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <p>
                Everyone loses access to this studio, including you. Cancel any subscription in the
                billing portal separately.
              </p>
            )}
            <label>
              Password
              <input
                required
                name="password"
                type="password"
                autoComplete="current-password"
                maxLength={128}
              />
            </label>
            <label>
              Type {word} to confirm
              <input
                required
                name="confirm"
                autoComplete="off"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </label>
            {error && (
              <p role="alert" className="inline-error">
                {error}
              </p>
            )}
            <button
              className={open === 'close' ? 'button danger' : 'button dark'}
              disabled={busy || confirm !== word}
            >
              {busy ? 'Working…' : open === 'close' ? 'Close studio' : 'Transfer ownership'}
            </button>
          </form>
        </Modal>
      )}
    </section>
  );
}
