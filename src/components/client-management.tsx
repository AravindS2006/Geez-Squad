'use client';
import { useState } from 'react';
import type { ClientView, WorkspaceData } from '@/lib/types';

export function ClientManagement({
  client,
  data,
  onSave,
  onRemoved,
  busy,
}: {
  client: ClientView;
  data: WorkspaceData;
  busy: boolean;
  onSave: (payload: Record<string, unknown>) => Promise<unknown>;
  onRemoved: () => void;
}) {
  const [name, setName] = useState(client.name),
    [goal, setGoal] = useState(client.goal);
  const [expected, setExpected] = useState({ name: client.name, goal: client.goal });
  const [confirmRemove, setConfirmRemove] = useState(false),
    [message, setMessage] = useState('');
  const enrolled = data.classes.filter((item) => item.participants.some((p) => p.id === client.id));
  const live = enrolled.some((item) => item.status === 'live');
  const upcoming = enrolled.filter((item) => item.status === 'scheduled').length;
  return (
    <div className="client-management">
      <form
        className="form-stack"
        onSubmit={async (event) => {
          event.preventDefault();
          try {
            await onSave({
              action: 'clientProfile',
              userId: client.id,
              name,
              goal,
              expectedName: expected.name,
              expectedGoal: expected.goal,
            });
            setExpected({ name: name.trim(), goal: goal.trim() });
            setMessage('Trainee profile saved.');
          } catch {
            setMessage('');
          }
        }}
      >
        <h3>Trainee profile</h3>
        <label>
          Trainee name
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            minLength={2}
            maxLength={80}
          />
        </label>
        <label>
          Training goal
          <input
            value={goal}
            onChange={(event) => setGoal(event.target.value)}
            required
            minLength={2}
            maxLength={160}
          />
        </label>
        <p className="microcopy">
          Name and goal are shared with the trainee. Account email: {client.email}
        </p>
        <button className="button outline" disabled={busy}>
          Save trainee profile
        </button>
        {message && <p role="status">{message}</p>}
      </form>
      {(data.permissions?.admin ?? data.demo) && (
        <details className="membership-management">
          <summary>Studio membership</summary>
          <p>
            Removing this trainee removes their plan assignment and enrollment in {upcoming}{' '}
            scheduled {upcoming === 1 ? 'session' : 'sessions'}. Their account and past workout
            records are preserved.
          </p>
          {live ? (
            <p className="inline-notice">
              End their live class before removing them from the studio.
            </p>
          ) : confirmRemove ? (
            <div className="form-stack">
              <p>Remove {client.name} from your studio?</p>
              <div className="form-actions">
                <button
                  className="button danger-button"
                  disabled={busy}
                  onClick={async () => {
                    try {
                      await onSave({ action: 'removeClient', userId: client.id });
                      onRemoved();
                    } catch {
                      setConfirmRemove(false);
                    }
                  }}
                >
                  Confirm removal
                </button>
                <button
                  className="button outline"
                  disabled={busy}
                  onClick={() => setConfirmRemove(false)}
                >
                  Keep trainee
                </button>
              </div>
            </div>
          ) : (
            <button
              className="button outline"
              disabled={busy}
              onClick={() => setConfirmRemove(true)}
            >
              Remove from studio
            </button>
          )}
        </details>
      )}
    </div>
  );
}
