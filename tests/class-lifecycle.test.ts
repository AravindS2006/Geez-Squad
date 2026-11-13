import { describe, expect, it } from 'vitest';
import {
  COACH_CUE_LIMIT,
  COMMAND_LIMITS,
  HOST_ABSENCE_GRACE_MS,
  IN_CLASS_ACTIONS,
  MAX_LIVE_MS,
  TARGET_CLASS_TRAINEES,
  autoCompleteReason,
  classRateBuckets,
  hostPresenceDue,
  liveClassDeadline,
} from '../src/lib/class-lifecycle';
import { MAX_CLASS_CLIENTS } from '../src/lib/class-policy';

const start = new Date('2026-11-12T10:00:00Z');
const at = (minutes: number) => new Date(start.getTime() + minutes * 60_000);
const live = (over: Partial<Parameters<typeof autoCompleteReason>[0]> = {}) => ({
  status: 'live',
  startedAt: start,
  duration: 45,
  hostLastSeenAt: start,
  ...over,
});

describe('automatic completion of live classes', () => {
  it('keeps a class running while its coach polls', () => {
    expect(autoCompleteReason(live({ hostLastSeenAt: at(30) }), at(31))).toBeNull();
  });
  it('completes a class whose coach has been absent past the grace period', () => {
    const seen = at(20);
    expect(autoCompleteReason(live({ hostLastSeenAt: seen }), at(29))).toBeNull();
    expect(
      autoCompleteReason(
        live({ hostLastSeenAt: seen }),
        new Date(seen.getTime() + HOST_ABSENCE_GRACE_MS),
      ),
    ).toBe('host_absent');
  });
  it('measures legacy live rows without presence from their start time', () => {
    expect(autoCompleteReason(live({ hostLastSeenAt: null }), at(5))).toBeNull();
    expect(autoCompleteReason(live({ hostLastSeenAt: null }), at(10))).toBe('host_absent');
  });
  it('completes an over-long class even when the coach is present', () => {
    expect(liveClassDeadline(live())).toEqual(at(105));
    expect(autoCompleteReason(live({ hostLastSeenAt: at(104) }), at(105))).toBe('max_duration');
  });
  it('caps the hard maximum at the room idle timeout', () => {
    expect(liveClassDeadline(live({ duration: 120 }))!.getTime() - start.getTime()).toBe(
      MAX_LIVE_MS,
    );
  });
  it('ignores classes that are not live', () => {
    for (const status of ['scheduled', 'completed', 'cancelled'])
      expect(autoCompleteReason(live({ status, hostLastSeenAt: null }), at(500))).toBeNull();
    expect(autoCompleteReason(live({ startedAt: null }), at(500))).toBeNull();
  });
  it('throttles the coach presence write to every 30 seconds', () => {
    expect(hostPresenceDue(null, at(0))).toBe(true);
    expect(hostPresenceDue(at(0), new Date(start.getTime() + 29_000))).toBe(false);
    expect(hostPresenceDue(at(0), new Date(start.getTime() + 30_000))).toBe(true);
  });
});

describe('command rate-limit buckets', () => {
  it('lets the coach cue every trainee of a 36-trainee class individually, several times a minute', () => {
    expect(COACH_CUE_LIMIT).toBeGreaterThanOrEqual(TARGET_CLASS_TRAINEES * 5);
    expect(COACH_CUE_LIMIT).toBeGreaterThan(MAX_CLASS_CLIENTS);
    const [bucket] = classRateBuckets('class-a', true, 'message');
    expect(bucket).toEqual({ action: 'class-cue:class-a', max: COACH_CUE_LIMIT });
    expect(classRateBuckets('class-a', true, 'message')).toHaveLength(1);
  });
  it('keys coach buckets per class and separates cues from controls', () => {
    expect(classRateBuckets('class-b', true, 'message')[0].action).not.toBe(
      classRateBuckets('class-a', true, 'message')[0].action,
    );
    expect(classRateBuckets('class-a', true, 'control')[0].action).toBe('class-control:class-a');
  });
  it('keeps the trainee abuse limits: shared command bucket and 20 messages a minute', () => {
    expect(classRateBuckets('class-a', false, 'message')).toEqual([
      { action: 'command', max: 60 },
      { action: 'message', max: 20 },
    ]);
    expect(classRateBuckets('class-a', false, 'control')).toEqual([{ action: 'command', max: 60 }]);
  });
  it('routes only in-class actions away from the general command bucket', () => {
    for (const action of ['message', 'help', 'consent', 'classControl', 'muteParticipants'])
      expect(IN_CLASS_ACTIONS.has(action)).toBe(true);
    for (const action of ['savePlan', 'invite', 'profile', 'checkIn', 'createClass'])
      expect(IN_CLASS_ACTIONS.has(action)).toBe(false);
    expect(COMMAND_LIMITS.general).toEqual({ action: 'command', max: 60 });
  });
});
