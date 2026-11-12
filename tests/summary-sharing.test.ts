import { describe, expect, it } from 'vitest';
import {
  METRICS_RATE_LIMIT_PER_MINUTE,
  SUMMARY_HEARTBEAT_MS,
  SUMMARY_MIN_INTERVAL_MS,
  summaryChanged,
  summaryDue,
  type SummaryGate,
} from '../src/lib/summary-sharing';

const ready: SummaryGate = {
  consentRecorded: true,
  classLive: true,
  classPaused: false,
  hasSnapshot: true,
  requestInFlight: false,
  now: 100_000,
  lastSentAt: 0,
};

describe('trainee summary sharing', () => {
  it('does not depend on the video room (no connection field at all)', () => {
    expect(summaryDue(ready)).toBe(true);
    expect(Object.keys(ready)).not.toContain('connected');
  });

  it('requires server-recorded consent and a live, unpaused class', () => {
    expect(summaryDue({ ...ready, consentRecorded: false })).toBe(false);
    expect(summaryDue({ ...ready, classLive: false })).toBe(false);
    expect(summaryDue({ ...ready, classPaused: true })).toBe(false);
    expect(summaryDue({ ...ready, hasSnapshot: false })).toBe(false);
  });

  it('never overlaps requests and spaces them under the metrics rate limit', () => {
    expect(summaryDue({ ...ready, requestInFlight: true })).toBe(false);
    expect(summaryDue({ ...ready, lastSentAt: ready.now - SUMMARY_MIN_INTERVAL_MS + 1 })).toBe(
      false,
    );
    expect(summaryDue({ ...ready, lastSentAt: ready.now - SUMMARY_MIN_INTERVAL_MS })).toBe(true);
    expect(Math.ceil(60_000 / SUMMARY_MIN_INTERVAL_MS)).toBeLessThan(METRICS_RATE_LIMIT_PER_MINUTE);
  });

  it('skips an unchanged summary until the heartbeat is due', () => {
    expect(summaryChanged('a', 'a', 10_000, 10_000 - SUMMARY_HEARTBEAT_MS + 1)).toBe(false);
    expect(summaryChanged('a', 'a', 10_000, 10_000 - SUMMARY_HEARTBEAT_MS)).toBe(true);
    expect(summaryChanged('b', 'a', 10_000, 9_999)).toBe(true);
    // The coach view treats a summary as fresh for 12 s.
    expect(SUMMARY_HEARTBEAT_MS).toBeLessThan(12_000);
  });
});
