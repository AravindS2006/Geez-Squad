'use client';
import { useState } from 'react';
import { CalendarDays } from 'lucide-react';
import { MAX_CLASS_CLIENTS } from '@/lib/class-policy';
import { localDateTime, parseSessionTime } from '@/lib/session-timing';
import type { ClassView, WorkspaceData } from '@/lib/types';
import { Avatar } from './ui';
import { useTimeFormat } from './time-provider';

export function ScheduleForm({
  data,
  session,
  busy,
  onSubmit,
}: {
  data: WorkspaceData;
  session?: ClassView | null;
  busy: boolean;
  onSubmit: (payload: Record<string, unknown>) => void;
}) {
  const { timeZone } = useTimeFormat();
  const [selected, setSelected] = useState<string[]>(session?.participants.map((p) => p.id) ?? []);
  const [allClients, setAllClients] = useState(false);
  const [search, setSearch] = useState('');
  const [timeError, setTimeError] = useState('');
  const [capacity, setCapacity] = useState(
    session?.capacity ?? Math.max(1, Math.min(MAX_CLASS_CLIENTS, data.clients.length)),
  );
  const selectedCount = allClients ? data.clients.length : selected.length;
  const next = session ? new Date(session.startsAt) : new Date(Date.now() + 3600000);
  const [local, setLocal] = useState(() => localDateTime(next));
  const [duration, setDuration] = useState(session?.duration ?? 30);
  const startsAt = parseSessionTime(local, session?.startsAt);
  function pick(id: string, checked: boolean) {
    const current = allClients ? data.clients.map((client) => client.id) : selected;
    const updated = checked
      ? [...new Set([...current, id])]
      : current.filter((value) => value !== id);
    setAllClients(false);
    setSelected(updated);
    setCapacity((value) => Math.max(value, updated.length));
  }
  return (
    <form
      className="form-stack"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        if (!startsAt) {
          setTimeError(
            'Choose a valid local time. This time may not exist because the clocks change.',
          );
          return;
        }
        if (Date.parse(startsAt) < Date.now() - 60000) {
          setTimeError('Choose a future start time.');
          return;
        }
        setTimeError('');
        onSubmit({
          action: session ? 'updateClass' : 'createClass',
          ...(session
            ? { id: session.id, expectedVersion: session.editVersion ?? '0'.repeat(64) }
            : {}),
          title: form.get('title'),
          startsAt,
          duration,
          capacity,
          planId: form.get('planId') || (session ? null : undefined),
          participantIds: selected,
          includeAllClients: allClients,
        });
      }}
    >
      <div className="form-two">
        <label>
          Session title
          <input
            name="title"
            required
            minLength={2}
            maxLength={80}
            defaultValue={session?.title}
            placeholder="Full body foundations"
          />
        </label>
        <label>
          Workout plan
          <select name="planId" defaultValue={session?.planId ?? ''}>
            <option value="">Choose at session time</option>
            {data.plans.map((plan) => (
              <option key={plan.id} value={plan.id}>
                {plan.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Date &amp; time
          <input
            name="startsAt"
            type="datetime-local"
            value={local}
            onChange={(event) => {
              setLocal(event.target.value);
              setTimeError('');
            }}
            required
          />
        </label>
        <label>
          Duration (minutes)
          <input
            name="duration"
            type="number"
            min={10}
            max={120}
            value={duration}
            onChange={(event) => setDuration(Number(event.target.value))}
            required
          />
        </label>
        <label>
          Class capacity
          <input
            name="capacity"
            type="number"
            min={1}
            max={MAX_CLASS_CLIENTS}
            value={capacity}
            onChange={(event) => setCapacity(Number(event.target.value))}
            required
          />
        </label>
      </div>
      {timeError && (
        <p className="inline-error" role="alert">
          {timeError}
        </p>
      )}
      {startsAt && duration > 0 && duration <= 120 && (
        <p className="microcopy">
          Starts{' '}
          {new Date(startsAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
          {' · Ends '}
          {new Date(Date.parse(startsAt) + duration * 60000).toLocaleString('en-IN', {
            dateStyle: 'medium',
            timeStyle: 'short',
          })}
          {' · '}
          {
            new Intl.DateTimeFormat('en-IN', { timeZoneName: 'longOffset' })
              .formatToParts(new Date(startsAt))
              .find((part) => part.type === 'timeZoneName')?.value
          }
        </p>
      )}
      <p className="microcopy">
        Times use {timeZone}. Sessions support up to {MAX_CLASS_CLIENTS} trainees.
        {session && ' Changes appear on the enrolled trainees’ calendars after you save.'}
      </p>
      <h3>
        Session trainees <span className="subtle">{selectedCount} selected</span>
      </h3>
      {!!data.clients.length && (
        <div className="session-client-actions">
          <label>
            <input
              type="checkbox"
              checked={allClients}
              disabled={data.clients.length > MAX_CLASS_CLIENTS}
              onChange={(event) => {
                setAllClients(event.target.checked);
                setSelected([]);
                if (event.target.checked)
                  setCapacity((value) => Math.max(value, data.clients.length));
              }}
            />{' '}
            Include all clients
          </label>
          <button
            type="button"
            className="text-action"
            onClick={() => {
              setSelected([]);
              setAllClients(false);
            }}
          >
            Clear selection
          </button>
        </div>
      )}
      {data.clients.length > 8 && (
        <label>
          Find a client
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search names"
          />
        </label>
      )}
      <div className="participant-picker">
        {data.clients
          .filter((client) => client.name.toLowerCase().includes(search.toLowerCase()))
          .map((client, index) => (
            <label key={client.id}>
              <input
                type="checkbox"
                checked={allClients || selected.includes(client.id)}
                disabled={
                  !allClients &&
                  !selected.includes(client.id) &&
                  selected.length >= MAX_CLASS_CLIENTS
                }
                onChange={(event) => pick(client.id, event.target.checked)}
              />
              <Avatar name={client.name} small index={index} />
              {client.name}
            </label>
          ))}
      </div>
      {!data.clients.length && (
        <p className="inline-notice">
          Add clients in Members and ask them to accept their studio request. You can schedule a
          solo rehearsal now.
        </p>
      )}
      {selectedCount > capacity && (
        <p role="alert">Increase the capacity or remove trainees before saving.</p>
      )}
      <button
        className="button dark"
        disabled={busy || selectedCount > capacity || selectedCount > MAX_CLASS_CLIENTS}
      >
        <CalendarDays size={17} />
        {busy ? 'Saving…' : session ? 'Save session changes' : 'Schedule session'}
      </button>
    </form>
  );
}
