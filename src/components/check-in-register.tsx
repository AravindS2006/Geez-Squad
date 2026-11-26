'use client';
import { useEffect, useState } from 'react';
import { Check, RefreshCw } from 'lucide-react';
import { fetchJson } from '@/lib/client';
import { addDays, studioToday } from '@/lib/studio-operations';
import {
  REGISTER_DAYS,
  journalCells,
  registerRows,
  registerSummary,
  type RegisterRow,
} from '@/lib/check-in-register';
import type { WorkspaceData } from '@/lib/types';
import { Avatar, EmptyState, SectionTitle } from './ui';
import { useTimeFormat } from './time-provider';
import styles from './check-in-register.module.css';

const columns = [
  'Status',
  'Energy',
  'Soreness',
  'Sleep',
  'Sunlight',
  'Stress',
  'Alcohol',
  'Caffeine',
  'Hydrated',
  'Note',
] as const;

/** A coach's attendance-style register of the daily check-ins their trainees shared. */
export function CheckInRegister({ data }: { data: WorkspaceData }) {
  const { dateLabel, timeLabel } = useTimeFormat();
  const today = studioToday();
  const [date, setDate] = useState(today);
  const [loaded, setLoaded] = useState<{ date: string; rows: RegisterRow[] } | null>(null);
  const [failure, setFailure] = useState<{ date: string; message: string } | null>(null);
  const [revision, setRevision] = useState(0);
  // Re-reads when the date changes, on Refresh, and whenever the workspace poll brings new
  // check-ins, so a trainee who checks in appears without a reload.
  useEffect(() => {
    if (data.demo) return;
    const controller = new AbortController();
    fetchJson<{ date: string; rows: RegisterRow[] }>(`/api/check-ins?date=${date}`, {
      signal: controller.signal,
    })
      .then((result) => {
        setLoaded(result);
        setFailure(null);
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setFailure({
          date,
          message: error instanceof Error ? error.message : 'Check-ins could not load.',
        });
      });
    return () => controller.abort();
  }, [date, revision, data.demo, data.checkIns]);
  const rows = data.demo
    ? registerRows(data.clients, data.checkIns, date)
    : loaded?.date === date
      ? loaded.rows
      : null;
  const summary = rows ? registerSummary(rows) : null;
  const error = failure?.date === date ? failure.message : '';
  return (
    <section className={`panel ${styles.register}`}>
      <SectionTitle
        title="Daily check-ins"
        detail="One row per trainee · answers are self-reported · India time"
        action={
          <div className={styles.controls}>
            <input
              type="date"
              className={styles.date}
              aria-label="Check-in date"
              value={date}
              min={addDays(today, -REGISTER_DAYS)}
              max={today}
              onChange={(event) => setDate(event.target.value || today)}
            />
            {!data.demo && (
              <button
                type="button"
                className="icon-button"
                aria-label="Refresh check-ins"
                onClick={() => setRevision((n) => n + 1)}
              >
                <RefreshCw size={16} aria-hidden />
              </button>
            )}
          </div>
        }
      />
      <div className={styles.summary} role="status">
        <strong>
          {summary ? `${summary.checkedIn} of ${summary.total} checked in` : 'Loading check-ins…'}
        </strong>
        <p>{dateLabel(`${date}T12:00:00+05:30`)}</p>
      </div>
      {error && (
        <p className="inline-error" role="alert">
          {error}{' '}
          <button className="text-link" onClick={() => setRevision((n) => n + 1)}>
            Retry
          </button>
        </p>
      )}
      {rows && !rows.length && (
        <EmptyState
          title="No trainees to show yet"
          text="Trainees assigned to you appear here, with the check-in they share each day."
        />
      )}
      {!!rows?.length && (
        <div className={styles.scroll} role="region" aria-label="Check-in register" tabIndex={0}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Trainee</th>
                {columns.map((column) => (
                  <th scope="col" key={column}>
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const entry = row.checkIns[0];
                const cells = journalCells(entry?.journal);
                const values = entry
                  ? [
                      `${entry.energy}/5`,
                      `${entry.soreness}/5`,
                      entry.sleepHours === null ? '—' : `${entry.sleepHours}h`,
                      cells.sunlight,
                      cells.stress,
                      cells.alcohol,
                      cells.caffeine,
                      cells.hydrated,
                      entry.note || '—',
                    ]
                  : columns.slice(1).map(() => '—');
                return (
                  <tr key={row.userId} className={entry ? undefined : styles.absent}>
                    <th scope="row">
                      <span className={styles.person}>
                        <Avatar name={row.name} index={index} small />
                        <strong>{row.name}</strong>
                      </span>
                    </th>
                    <td data-label="Status">
                      {entry ? (
                        <span className={styles.present}>
                          <Check size={15} aria-hidden />
                          Checked in {timeLabel(entry.createdAt)}
                          {row.checkIns.length > 1 && ` · ${row.checkIns.length} check-ins`}
                        </span>
                      ) : (
                        <span className={styles.missing}>Not yet</span>
                      )}
                    </td>
                    {values.map((value, i) => (
                      <td
                        key={columns[i + 1]}
                        data-label={columns[i + 1]}
                        className={columns[i + 1] === 'Note' ? styles.note : undefined}
                      >
                        {value}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
