'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { WorkspaceData } from '@/lib/types';
import { fetchJson } from '@/lib/client';
import {
  emptyNutritionProfile,
  nutritionTotals,
  nutritionCommandSchema,
  type NutritionData,
  type NutritionEntry,
  type NutritionProfile,
} from '@/lib/nutrition';
import { addDays, studioToday } from '@/lib/studio-operations';
const blank = (): NutritionData => ({
  profile: { ...emptyNutritionProfile },
  entries: [],
  canEditJournal: true,
});
export function NutritionManager({ workspace }: { workspace: WorkspaceData }) {
  const [userId, setUserId] = useState(workspace.user.id);
  const [date, setDate] = useState(studioToday);
  const [data, setData] = useState<NutritionData | null>(null);
  const [draft, setDraft] = useState<NutritionProfile>({ ...emptyNutritionProfile });
  const [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<NutritionEntry | null>(null);
  const request = useRef(0),
    demo = useRef<NutritionData>(blank()),
    mutation = useRef(false);
  const own = userId === workspace.user.id;
  const url = `/api/nutrition?userId=${encodeURIComponent(userId)}&date=${date}`;
  useEffect(() => {
    const current = ++request.current;
    const controller = new AbortController();
    setLoading(true);
    setData(null);
    setError('');
    setNotice('');
    setEditing(null);
    const result = workspace.demo
      ? Promise.resolve({ ...demo.current, canEditJournal: own })
      : fetchJson<NutritionData>(url, { signal: controller.signal });
    result
      .then((next) => {
        if (current === request.current) {
          setData(next);
          setDraft(next.profile);
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      ++request.current;
      controller.abort();
    };
  }, [url, workspace.demo, own]);
  async function save(command: unknown) {
    if (mutation.current) return false;
    mutation.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    const current = request.current;
    try {
      const c = nutritionCommandSchema.parse(command);
      if (workspace.demo) {
        const next = {
          ...demo.current,
          entries: [...demo.current.entries],
          profile: { ...demo.current.profile },
        };
        if (c.action === 'entry')
          next.entries = [c.entry, ...next.entries.filter((e) => e.id !== c.entry.id)];
        if (c.action === 'remove') next.entries = next.entries.filter((e) => e.id !== c.id);
        if (c.action === 'sharing') next.profile.shareWithCoach = c.shareWithCoach;
        if (c.action === 'targets') next.profile = { ...next.profile, ...c.profile };
        demo.current = next;
        if (current === request.current) {
          setData(next);
          setDraft(next.profile);
        }
      } else {
        await fetchJson('/api/nutrition', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(c),
        });
        const next = await fetchJson<NutritionData>(url);
        if (current === request.current) {
          setData(next);
          setDraft(next.profile);
        }
      }
      if (current === request.current) {
        setNotice(
          workspace.demo ? 'Sample journal updated for this visit.' : 'Nutrition journal saved.',
        );
        setEditing(null);
      }
      return true;
    } catch (e) {
      if (current === request.current) setError(e instanceof Error ? e.message : 'Unable to save.');
      return false;
    } finally {
      mutation.current = false;
      setBusy(false);
    }
  }
  async function addEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget,
      f = new FormData(form);
    const number = (key: string) =>
      String(f.get(key) ?? '').trim() === '' ? null : Number(f.get(key));
    if (
      await save({
        action: 'entry',
        entry: {
          id: editing?.id ?? crypto.randomUUID(),
          date,
          meal: f.get('meal'),
          description: f.get('description'),
          calories: number('calories'),
          protein: number('protein'),
          carbs: number('carbs'),
          fat: number('fat'),
          waterMl: number('waterMl') ?? 0,
        },
      })
    )
      form.reset();
  }
  const entries = data?.entries.filter((e) => e.date === date) ?? [];
  const total = nutritionTotals(entries);
  const days = Array.from({ length: 7 }, (_, i) => addDays(date, i - 6));
  return (
    <section className="nutrition-workspace">
      <div className="section-title">
        <div>
          <span className="eyebrow">EVERYDAY NUTRITION</span>
          <h1>Small habits. A stronger you.</h1>
          <p>Log what you eat and drink. Set your own targets or review them with your coach.</p>
        </div>
      </div>
      <div className="nutrition-toolbar">
        <label>
          Journal date
          <input
            type="date"
            value={date}
            max={studioToday()}
            min={addDays(studioToday(), -366)}
            disabled={busy}
            onChange={(e) => {
              if (e.target.value) setDate(e.target.value);
            }}
          />
        </label>
        {(workspace.permissions?.coach || workspace.demo) && (
          <label>
            Nutrition journal
            <select value={userId} disabled={busy} onChange={(e) => setUserId(e.target.value)}>
              <option value={workspace.user.id}>My journal</option>
              {workspace.clients
                .filter((c) => c.id !== workspace.user.id)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} · shared journal
                  </option>
                ))}
            </select>
          </label>
        )}
      </div>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="inline-notice" role="status">
          {notice}
        </p>
      )}
      {loading && <p role="status">Loading journal…</p>}
      {!loading && !data && (
        <p>
          Ask the member to enable nutrition sharing. Only their current authorized coach or studio
          admin can view a shared journal.
        </p>
      )}
      {data && (
        <>
          {own && (
            <label className="nutrition-sharing">
              <input
                type="checkbox"
                checked={data.profile.shareWithCoach}
                disabled={busy}
                onChange={(e) => {
                  const shareWithCoach = e.target.checked,
                    previous = data;
                  setData({ ...data, profile: { ...data.profile, shareWithCoach } });
                  void save({ action: 'sharing', shareWithCoach }).then((ok) => {
                    if (!ok) setData(previous);
                  });
                }}
              />
              Share my nutrition journal and targets with my current coach and studio admins
            </label>
          )}
          <div className="nutrition-stats" aria-label="Logged nutrition totals">
            <article>
              <span>Logged energy</span>
              <strong>
                {total.calories.known ? `${total.calories.value} kcal` : 'Not entered'}
              </strong>
              <small>
                {data.profile.calories === null
                  ? 'No energy target'
                  : `Target ${data.profile.calories} kcal`}{' '}
                · {total.calories.known}/{total.calories.total} entries include energy
              </small>
            </article>
            <article>
              <span>Logged protein</span>
              <strong>{total.protein.known ? `${total.protein.value} g` : 'Not entered'}</strong>
              <small>
                {data.profile.protein === null
                  ? 'No protein target'
                  : `Target ${data.profile.protein} g`}
              </small>
            </article>
            <article>
              <span>Water</span>
              <strong>{total.waterMl} ml</strong>
              <small>
                {data.profile.waterMl === null
                  ? 'No water target'
                  : `Target ${data.profile.waterMl} ml`}
              </small>
            </article>
          </div>
          <div className="nutrition-grid">
            <section className="panel nutrition-journal">
              <h2>{own ? 'Your food & water journal' : 'Shared journal'}</h2>
              <p>Amounts are entered by the member. Missing nutrition values remain unknown.</p>
              {entries.length ? (
                <ul className="nutrition-entry-list">
                  {entries.map((e) => (
                    <li key={e.id}>
                      <div>
                        <span className="eyebrow">{e.meal}</span>
                        <strong>{e.description}</strong>
                        <small>
                          {[
                            e.calories !== null && `${e.calories} kcal`,
                            e.protein !== null && `${e.protein} g protein`,
                            e.carbs !== null && `${e.carbs} g carbs`,
                            e.fat !== null && `${e.fat} g fat`,
                            e.waterMl > 0 && `${e.waterMl} ml water`,
                          ]
                            .filter(Boolean)
                            .join(' · ') || 'Nutrition values not entered'}
                        </small>
                      </div>
                      {own && (
                        <div>
                          <button
                            className="button outline small-button"
                            disabled={busy}
                            onClick={() => setEditing(e)}
                            aria-label={`Edit ${e.description}`}
                          >
                            Edit
                          </button>
                          <button
                            className="text-link"
                            disabled={busy}
                            onClick={() => void save({ action: 'remove', id: e.id })}
                            aria-label={`Delete ${e.description}`}
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No entries for this day.</p>
              )}
              {own && (
                <form key={editing?.id ?? 'new'} onSubmit={addEntry} className="nutrition-form">
                  <h3>{editing ? 'Edit entry' : 'Add an entry'}</h3>
                  <label>
                    Meal
                    <select name="meal" defaultValue={editing?.meal ?? 'Breakfast'}>
                      {['Breakfast', 'Lunch', 'Dinner', 'Snack', 'Water'].map((m) => (
                        <option key={m}>{m}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Food or drink
                    <input
                      name="description"
                      required
                      maxLength={500}
                      defaultValue={editing?.description ?? ''}
                      placeholder="Oats, fruit and yogurt"
                    />
                  </label>
                  <div className="nutrition-fields">
                    {[
                      ['calories', 'Energy (kcal)', 20000],
                      ['protein', 'Protein (g)', 1000],
                      ['carbs', 'Carbohydrates (g)', 2000],
                      ['fat', 'Fat (g)', 1000],
                      ['waterMl', 'Water (ml)', 20000],
                    ].map(([key, label, max]) => (
                      <label key={key}>
                        {label}
                        <input
                          name={String(key)}
                          type="number"
                          min="0"
                          max={Number(max)}
                          step={key === 'calories' || key === 'waterMl' ? 1 : 0.1}
                          defaultValue={editing?.[key as keyof NutritionEntry] ?? ''}
                        />
                      </label>
                    ))}
                  </div>
                  <button className="button dark" disabled={busy}>
                    {busy ? 'Saving…' : editing ? 'Update entry' : 'Add entry'}
                  </button>
                  {editing && (
                    <button className="text-link" type="button" onClick={() => setEditing(null)}>
                      Cancel editing
                    </button>
                  )}
                </form>
              )}
            </section>
            <aside className="panel nutrition-targets">
              <h2>Targets & guidance</h2>
              <p>
                Targets are optional, explicitly entered values. Agree them with an appropriately
                qualified professional.
              </p>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void save({ action: 'targets', userId, profile: draft });
                }}
                className="nutrition-form"
              >
                {(
                  [
                    ['calories', 'Daily energy (kcal)', 20000],
                    ['protein', 'Daily protein (g)', 1000],
                    ['waterMl', 'Daily water (ml)', 20000],
                  ] as const
                ).map(([key, label, max]) => (
                  <label key={key}>
                    {label}
                    <input
                      type="number"
                      min="0"
                      max={max}
                      step={key === 'protein' ? 0.1 : 1}
                      value={draft[key] ?? ''}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          [key]: e.target.value === '' ? null : Number(e.target.value),
                        })
                      }
                    />
                  </label>
                ))}
                <label>
                  Food preferences & dietary requirements
                  <textarea
                    maxLength={1000}
                    value={draft.preferences}
                    onChange={(e) => setDraft({ ...draft, preferences: e.target.value })}
                  />
                </label>
                <label>
                  Agreed nutrition guidance
                  <textarea
                    maxLength={2000}
                    value={draft.guidance}
                    onChange={(e) => setDraft({ ...draft, guidance: e.target.value })}
                  />
                </label>
                <button className="button dark" disabled={busy}>
                  Save targets
                </button>
              </form>
              {data.profile.updatedAt && (
                <small>
                  Last updated {new Date(data.profile.updatedAt).toLocaleDateString()} ·{' '}
                  {data.profile.updatedById === workspace.user.id
                    ? 'by you'
                    : 'by the member or their authorized coach'}
                </small>
              )}
            </aside>
          </div>
          <section className="panel nutrition-week">
            <h2>Seven-day journal consistency</h2>
            <div>
              {days.map((day) => {
                const rows = data.entries.filter((e) => e.date === day);
                return (
                  <article key={day}>
                    <span>
                      {new Date(`${day}T12:00:00Z`).toLocaleDateString('en-IN', {
                        weekday: 'short',
                        day: 'numeric',
                        timeZone: 'UTC',
                      })}
                    </span>
                    <strong>{rows.length}</strong>
                    <small>{rows.length === 1 ? 'entry' : 'entries'}</small>
                  </article>
                );
              })}
            </div>
          </section>
        </>
      )}
    </section>
  );
}
