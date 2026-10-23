'use client';
import { useState } from 'react';
import {
  CalendarDays,
  Clock3,
  MapPin,
  Plus,
  Users,
  ArrowUpRight,
  Check,
  Pencil,
} from 'lucide-react';
import { Modal, Avatar, EmptyState } from './ui';
import {
  studioToday,
  termStatus,
  type OperationsCommand,
  type OperationsData,
} from '@/lib/studio-operations';

export function StudioSchedule({
  data,
  search,
  save,
  busy,
  error,
}: {
  data: OperationsData;
  search: string;
  save: (c: OperationsCommand) => Promise<boolean | undefined>;
  busy: boolean;
  error: string;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [roster, setRoster] = useState<string | null>(null);
  const [filter, setFilter] = useState('upcoming');
  const item = data.studioClasses.find((s) => s.id === editing);
  const rosterClass = data.studioClasses.find((s) => s.id === roster);
  const dateTime = (date: string) =>
    new Date(date).toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
    });
  const localValue = (date: string) => {
    const d = new Date(Date.parse(date) + 330 * 60000);
    return d.toISOString().slice(0, 16);
  };
  const rows = data.studioClasses.filter(
    (s) =>
      s.title.toLowerCase().includes(search.toLowerCase()) &&
      (filter === 'all' || (s.status === 'scheduled' && Date.parse(s.startsAt) > Date.now())),
  );
  return (
    <>
      <div className="ops-toolbar">
        <div className="ops-tabs" role="group" aria-label="Studio class filters">
          <button
            className={filter === 'upcoming' ? 'active' : ''}
            aria-pressed={filter === 'upcoming'}
            onClick={() => setFilter('upcoming')}
          >
            Upcoming classes
          </button>
          <button
            className={filter === 'all' ? 'active' : ''}
            aria-pressed={filter === 'all'}
            onClick={() => setFilter('all')}
          >
            All classes
          </button>
        </div>
        <button className="button dark" onClick={() => setEditing('new')}>
          <Plus size={16} />
          Schedule studio class
        </button>
      </div>
      <div className="ops-studio-classes">
        {rows.map((s) => {
          const booked = s.bookings.filter((b) => b.status === 'booked').length;
          return (
            <section className="ops-card ops-studio-class" key={s.id}>
              <div className="ops-class-date">
                <CalendarDays size={18} />
                {dateTime(s.startsAt)}
                <span className={`ops-badge ${s.status === 'scheduled' ? 'green' : 'amber'}`}>
                  {s.status}
                </span>
              </div>
              <h2>{s.title}</h2>
              <p>With {s.trainer}</p>
              <div className="ops-class-meta">
                <span>
                  <Clock3 size={14} />
                  {s.duration} min
                </span>
                <span>
                  <MapPin size={14} />
                  {s.location}
                </span>
              </div>
              <div className="ops-class-capacity">
                <span>
                  {booked} / {s.capacity} places booked
                </span>
                <div>
                  <span style={{ width: `${(booked / s.capacity) * 100}%` }} />
                </div>
              </div>
              <div className="ops-class-actions">
                <button className="button outline small-button" onClick={() => setRoster(s.id)}>
                  <Users size={15} />
                  View roster
                  <ArrowUpRight size={14} />
                </button>
                {s.status === 'scheduled' && (
                  <button
                    className="icon-button"
                    aria-label={`Edit ${s.title}`}
                    onClick={() => setEditing(s.id)}
                  >
                    <Pencil size={16} />
                  </button>
                )}
              </div>
            </section>
          );
        })}
      </div>
      {!rows.length && (
        <EmptyState
          title="Make room for your next class"
          text="Schedule in-studio sessions, manage capacity, and book members into the roster."
          action={
            <button className="button dark" onClick={() => setEditing('new')}>
              Schedule studio class
            </button>
          }
        />
      )}
      {editing && (
        <Modal
          title={item ? 'Edit studio class' : 'Schedule a studio class'}
          onClose={() => {
            if (!busy) setEditing(null);
          }}
        >
          <form
            className="form-stack ops-editor"
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const ok = await save({
                action: 'studioClass',
                id: item?.id,
                title: String(f.get('title')),
                trainer: String(f.get('trainer')),
                hostId: String(f.get('hostId') || '') || undefined,
                location: String(f.get('location')),
                startsAt: new Date(`${f.get('startsAt')}+05:30`).toISOString(),
                duration: Number(f.get('duration')),
                capacity: Number(f.get('capacity')),
                status: String(f.get('status')) as 'scheduled',
              });
              if (ok) setEditing(null);
            }}
          >
            <label>
              Class name
              <input
                required
                name="title"
                minLength={2}
                maxLength={160}
                defaultValue={item?.title}
              />
            </label>
            <label>
              Class host
              <select name="hostId" defaultValue={item?.hostId ?? data.coaches?.[0]?.id ?? ''}>
                {data.coaches?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Trainer
              <input
                required
                name="trainer"
                list="studio-trainers"
                minLength={2}
                maxLength={160}
                defaultValue={item?.trainer}
              />
              <datalist id="studio-trainers">
                {data.staff
                  .filter((s) => s.status === 'active')
                  .map((s) => (
                    <option key={s.id} value={s.name} />
                  ))}
              </datalist>
            </label>
            <label>
              Studio / room
              <input
                required
                name="location"
                minLength={2}
                maxLength={160}
                defaultValue={item?.location || 'Main studio'}
              />
            </label>
            <label>
              Starts at (India time)
              <input
                required
                name="startsAt"
                type="datetime-local"
                defaultValue={item ? localValue(item.startsAt) : undefined}
              />
            </label>
            <div className="ops-form-grid">
              <label>
                Duration (minutes)
                <input
                  required
                  type="number"
                  name="duration"
                  min={10}
                  max={240}
                  defaultValue={item?.duration || 45}
                />
              </label>
              <label>
                Capacity
                <input
                  required
                  type="number"
                  name="capacity"
                  min={1}
                  max={100}
                  defaultValue={item?.capacity || 12}
                />
              </label>
            </div>
            <label>
              Class status
              <select name="status" defaultValue={item?.status || 'scheduled'}>
                <option value="scheduled">Scheduled</option>
                {item && (
                  <>
                    <option value="completed">Completed</option>
                    <option value="cancelled">Cancelled</option>
                  </>
                )}
              </select>
            </label>
            <p className="ops-context-note">
              In-studio classes have their own roster. Use Live sessions for video coaching. Members
              need a valid membership on the class date to book.
            </p>
            {error && (
              <p role="alert" className="inline-error">
                {error}
              </p>
            )}
            <button className="button dark" disabled={busy}>
              {busy ? 'Saving…' : 'Save class'}
              <Check size={15} />
            </button>
          </form>
        </Modal>
      )}
      {rosterClass && (
        <Modal title={`${rosterClass.title} · roster`} wide onClose={() => setRoster(null)}>
          <p className="ops-context-note">
            {dateTime(rosterClass.startsAt)} · {rosterClass.location} ·{' '}
            {rosterClass.bookings.filter((b) => b.status === 'booked').length}/
            {rosterClass.capacity} booked
          </p>
          {error && (
            <p role="alert" className="inline-error">
              {error}
            </p>
          )}
          <div className="ops-roster-list">
            {data.members
              .filter(
                (m) =>
                  m.status !== 'archived' ||
                  rosterClass.bookings.some((b) => b.memberId === m.id && b.status === 'booked'),
              )
              .map((m, i) => {
                const booked = rosterClass.bookings.some(
                  (b) => b.memberId === m.id && b.status === 'booked',
                );
                const eligible =
                  m.status === 'active' &&
                  data.terms.some(
                    (t) =>
                      t.memberId === m.id &&
                      termStatus(t, studioToday(new Date(rosterClass.startsAt))) === 'active',
                  );
                return (
                  <div className="ops-roster-person" key={m.id}>
                    <Avatar name={m.name} index={i} small />
                    <span>
                      <strong>{m.name}</strong>
                      <small>
                        {booked ? 'Booked' : eligible ? 'Membership valid' : 'Membership required'}
                      </small>
                    </span>
                    <button
                      className="button outline small-button"
                      disabled={
                        busy ||
                        rosterClass.status !== 'scheduled' ||
                        Date.parse(rosterClass.startsAt) <= Date.now() ||
                        (!booked && !eligible)
                      }
                      onClick={() =>
                        save({
                          action: 'booking',
                          classId: rosterClass.id,
                          memberId: m.id,
                          status: booked ? 'cancelled' : 'booked',
                        })
                      }
                    >
                      {booked ? 'Cancel booking' : 'Book place'}
                    </button>
                  </div>
                );
              })}
          </div>
          {!data.members.length && <p>Add a member and membership before booking a place.</p>}
        </Modal>
      )}
    </>
  );
}
