'use client';
import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Modal } from './ui';
import { fetchJson } from '@/lib/client';
import { ACCOUNT_DELETION_CONFIRMATION } from '@/lib/account-deletion-policy';

/** Settings entry for permanent self-service account deletion. */
export function AccountDeletion({ demo, notify }: { demo: boolean; notify: (m: string) => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState('');
  return (
    <>
      <div className="settings-feature">
        <Trash2 size={21} />
        <div>
          <h3>Delete your account.</h3>
          <p>
            Permanently removes your sign-in, workouts, check-ins, nutrition journal and class
            history. Studio membership and payment records stay with the studio. Export your data
            first if you want a copy.
          </p>
        </div>
      </div>
      <button
        className="button outline"
        onClick={() =>
          demo ? notify('The sample workspace has no account to delete.') : setOpen(true)
        }
      >
        Delete my account
      </button>
      {open && (
        <Modal
          title="Delete your account permanently"
          onClose={() => {
            if (!busy) {
              setOpen(false);
              setError('');
              setConfirm('');
            }
          }}
        >
          <form
            className="form-stack"
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              setBusy(true);
              setError('');
              try {
                await fetchJson('/api/account', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    action: 'delete',
                    confirm: String(f.get('confirm')),
                    password: String(f.get('password')),
                  }),
                });
                window.location.assign('/');
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Please retry.');
                setBusy(false);
              }
            }}
          >
            <p>
              This cannot be undone. Your profile, sign-in, saved workouts, check-ins, nutrition
              entries and live-class history are erased, and you are signed out on every device.
            </p>
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
              Type {ACCOUNT_DELETION_CONFIRMATION} to confirm
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
              className="button danger"
              disabled={busy || confirm !== ACCOUNT_DELETION_CONFIRMATION}
            >
              {busy ? 'Deleting…' : 'Delete account permanently'}
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}
