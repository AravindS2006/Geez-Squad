'use client';
import { useState } from 'react';
import type { WorkspaceData } from '@/lib/types';
import { fetchJson } from '@/lib/client';
import { exerciseLibrary, capabilityLabels } from '@/lib/exercise-library';
import { coachingFeatures } from '@/lib/coaching-features';

export function ExerciseLibraryManager({
  data,
  onRefresh,
}: {
  data: WorkspaceData;
  onRefresh: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState('');
  const flags = data.features ?? coachingFeatures();
  return (
    <section className="panel exercise-library-manager">
      <div className="section-title">
        <div>
          <h2>Exercise library</h2>
          <p>36 curated movements · {data.customExercises?.length ?? 0} studio exercises</p>
        </div>
        <button className="button outline" onClick={() => setOpen(!open)}>
          {open ? 'Close library' : 'Browse and customize'}
        </button>
      </div>
      {open && (
        <>
          <div className="exercise-library-grid">
            {[...exerciseLibrary, ...(data.customExercises ?? [])].map((e) => (
              <article key={e.id}>
                <strong>{e.name}</strong>
                <span>
                  {e.group} · {e.equipment}
                </span>
                <small>{capabilityLabels[e.capability]}</small>
              </article>
            ))}
          </div>
          <form
            className="form-stack"
            onSubmit={async (event) => {
              event.preventDefault();
              const form = event.currentTarget,
                values = new FormData(form);
              setBusy(true);
              setNotice('');
              try {
                if (data.demo) throw new Error('Sign in to create studio exercises.');
                await fetchJson('/api/exercises', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    action: 'create',
                    name: values.get('name'),
                    equipment: values.get('equipment'),
                    instructions: values.get('instructions'),
                    targetUnit: values.get('targetUnit'),
                  }),
                });
                await onRefresh();
                form.reset();
                setNotice('Studio exercise created. Add it to a workout plan.');
              } catch (error) {
                setNotice(error instanceof Error ? error.message : 'Please retry.');
              } finally {
                setBusy(false);
              }
            }}
          >
            <h3>Create a studio exercise</h3>
            <div className="form-two">
              <label>
                Name
                <input name="name" minLength={2} maxLength={80} required />
              </label>
              <label>
                Equipment
                <input name="equipment" maxLength={120} />
              </label>
            </div>
            <label>
              Coaching instructions
              <textarea name="instructions" minLength={10} maxLength={2000} required />
            </label>
            <label>
              Track with
              <select name="targetUnit">
                <option value="reps">Manual repetitions</option>
                <option value="seconds">Activity timer</option>
              </select>
            </label>
            <button className="button dark" disabled={busy}>
              Create exercise
            </button>
          </form>
          {data.permissions?.admin && (
            <details>
              <summary>Studio coaching rollout</summary>
              <p>Changes apply to newly opened workout players and rooms.</p>
              {(Object.keys(flags) as (keyof typeof flags)[]).map((key) => (
                <label className="checkbox-label" key={key}>
                  <input
                    type="checkbox"
                    checked={flags[key]}
                    disabled={busy || data.demo}
                    onChange={async (event) => {
                      setBusy(true);
                      try {
                        await fetchJson('/api/exercises', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            action: 'rollout',
                            ...flags,
                            [key]: event.target.checked,
                          }),
                        });
                        await onRefresh();
                      } catch {
                        setNotice('Rollout settings could not be saved.');
                      } finally {
                        setBusy(false);
                      }
                    }}
                  />
                  {key === 'measurement'
                    ? 'Camera measurement v8'
                    : key === 'library'
                      ? 'Expanded exercise library'
                      : 'Professional meeting layout'}
                </label>
              ))}
            </details>
          )}
        </>
      )}
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
