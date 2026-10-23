'use client';
import { useEffect, useState } from 'react';
import { fetchJson } from '@/lib/client';
import { useTimeFormat } from './time-provider';
type Bookings = {
  history: { id: string; title: string; action: string; createdAt: string }[];
  classes: {
    id: string;
    title: string;
    trainer: string;
    location: string;
    startsAt: string;
    duration: number;
    seats: number;
    bookingStatus: string | null;
    eligible: boolean;
  }[];
  bookings: { id: string; title: string; startsAt: string; status: string; classStatus: string }[];
  attendance: { id: string; date: string }[];
};
export function MyBookings() {
  const [data, setData] = useState<Bookings | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState('');
  const { dateLabel, timeLabel } = useTimeFormat();
  useEffect(() => {
    let active = true;
    async function refresh() {
      try {
        const fresh = await fetchJson<Bookings>('/api/my-bookings');
        if (active) setData(fresh);
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : 'Classes could not load.');
      }
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 30000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  async function book(classId: string, action: 'book' | 'cancel') {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await fetchJson('/api/my-bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ classId, action }),
      });
      setData(await fetchJson<Bookings>('/api/my-bookings'));
      setNotice(
        action === 'book'
          ? 'Your place is booked.'
          : 'Booking cancelled. Your place has been released.',
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Please retry.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel my-bookings" aria-labelledby="my-bookings-title">
      <span className="eyebrow">AT THE STUDIO</span>
      <h2 id="my-bookings-title">Classes &amp; visits</h2>
      <p>
        Book with an active membership covering the class date. You can cancel before the class
        starts, even if your membership has expired.
      </p>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      <p role="status">{notice}</p>
      {!data ? (
        <p>Loading your classes…</p>
      ) : (
        <>
          <div className="team-access-list">
            {data.classes.length === 0 && (
              <p>
                No upcoming classes are available. Accept your studio connection to see classes
                here.
              </p>
            )}
            {data.classes.map((c) => (
              <article className="studio-request" key={c.id}>
                <div>
                  <h3>{c.title}</h3>
                  <p>
                    {dateLabel(c.startsAt)} · {timeLabel(c.startsAt)} · {c.duration} min
                  </p>
                  <p>
                    {c.location} · {c.trainer} · {c.seats} places available
                  </p>
                  {!c.eligible && c.bookingStatus !== 'booked' && (
                    <small>A valid membership for this date is required.</small>
                  )}
                </div>
                <button
                  className={`button ${c.bookingStatus === 'booked' ? 'outline' : 'dark'}`}
                  disabled={busy || (c.bookingStatus !== 'booked' && (!c.eligible || c.seats <= 0))}
                  onClick={() => void book(c.id, c.bookingStatus === 'booked' ? 'cancel' : 'book')}
                >
                  {c.bookingStatus === 'booked'
                    ? 'Cancel my booking'
                    : c.seats <= 0
                      ? 'Class full'
                      : 'Book my place'}
                </button>
              </article>
            ))}
          </div>
          <h3>Booking history</h3>
          {data.bookings.length ? (
            <ul>
              {data.bookings.map((b) => (
                <li key={b.id}>
                  {b.title} · {dateLabel(b.startsAt)} ·{' '}
                  {b.classStatus === 'cancelled' ? 'Class cancelled' : b.status}
                </li>
              ))}
            </ul>
          ) : (
            <p>No bookings yet.</p>
          )}
          {!!data.history.length && (
            <details>
              <summary>Booking activity</summary>
              <ul>
                {data.history.map((h) => (
                  <li key={h.id}>
                    {h.title} · {dateLabel(h.createdAt)} ·{' '}
                    {h.action === 'booking.booked'
                      ? 'Booked'
                      : h.action === 'booking.cancelled'
                        ? 'Cancelled by member or admin'
                        : h.action === 'booking.classCancelled'
                          ? 'Class cancelled'
                          : 'Membership changed · place released'}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <h3>Attendance</h3>
          {data.attendance.length ? (
            <ul>
              {data.attendance.map((a) => (
                <li key={a.id}>{a.date} · Visited the studio</li>
              ))}
            </ul>
          ) : (
            <p>Your recorded visits will appear here.</p>
          )}
        </>
      )}
    </section>
  );
}
