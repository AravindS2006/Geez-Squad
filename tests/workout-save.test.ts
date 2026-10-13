import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { WorkoutSetRecord } from '../src/lib/types';
const request = vi.hoisted(() => vi.fn());
vi.mock('../src/lib/client', () => ({ fetchJson: request }));
import { saveWorkoutSet, retryWorkoutSets, pendingWorkoutSets } from '../src/lib/workout-save';
const key = 'geez-squad:pending-sets:v1';
const record: WorkoutSetRecord = {
  clientId: '018f165d-c727-4951-8f0e-e6f9d9fddba9',
  classId: null,
  revision: 0,
  exercise: 'curl',
  ruleVersion: 'profile-v3',
  setNumber: 1,
  target: 2,
  reps: 2,
  holdMs: 0,
  activeMs: 5000,
  trackedMs: 5000,
  formScore: 90,
  qualityScore: 90,
  rangeDegrees: 95,
  repSeconds: 2,
  confidence: 0.9,
  rejectedReps: 0,
  loadKg: null,
  completed: true,
  startedAt: '2026-10-09T00:00:00Z',
  endedAt: '2026-10-09T00:00:05Z',
};
let values: Map<string, string>;
beforeEach(() => {
  values = new Map();
  request.mockReset();
  vi.stubGlobal('localStorage', {
    getItem: (name: string) => values.get(name) ?? null,
    setItem: (name: string, value: string) => values.set(name, value),
  });
});
afterEach(() => vi.unstubAllGlobals());
it('migrates the old pending queue without discarding unsent sets', async () => {
  values.set('fuzzfit:pending-sets:v1', JSON.stringify([{ userId: 'owner', record }]));
  expect(pendingWorkoutSets('owner')).toBe(1);
  request.mockResolvedValue({ saved: true });
  expect(await retryWorkoutSets('owner')).toBe(1);
  expect(pendingWorkoutSets('owner')).toBe(0);
});
it('queues a failed save and sends its intended owner on a kept-alive retry', async () => {
  request.mockRejectedValueOnce(Error('Offline')).mockResolvedValue({ saved: true });
  await expect(saveWorkoutSet('owner', record)).rejects.toThrow('Offline');
  expect(pendingWorkoutSets('owner')).toBe(1);
  await retryWorkoutSets('owner');
  expect(pendingWorkoutSets('owner')).toBe(0);
  expect(request.mock.calls[1][1].keepalive).toBe(true);
  expect(JSON.parse(request.mock.calls[1][1].body)).toMatchObject({
    clientId: record.clientId,
    ownerId: 'owner',
  });
});
it('never submits records queued for another account', async () => {
  values.set(key, JSON.stringify([{ userId: 'other', record }]));
  expect(await retryWorkoutSets('owner')).toBe(0);
  expect(request).not.toHaveBeenCalled();
  expect(pendingWorkoutSets('other')).toBe(1);
});
it('does not silently discard older unsent records when more than 100 accumulate', async () => {
  values.set(
    key,
    JSON.stringify(
      Array.from({ length: 101 }, (_, index) => ({
        userId: 'owner',
        record: { ...record, clientId: `pending-${index}` },
      })),
    ),
  );
  expect(pendingWorkoutSets('owner')).toBe(101);
  request.mockRejectedValue(Error('Offline'));
  await expect(saveWorkoutSet('owner', record)).rejects.toThrow('Offline');
  expect(pendingWorkoutSets('owner')).toBe(102);
  expect(
    JSON.parse(values.get(key)!).some(
      (item: { record: { clientId: string } }) => item.record.clientId === 'pending-0',
    ),
  ).toBe(true);
});
it('retries later records when one pending record is rejected', async () => {
  const later = { ...record, clientId: '01636788-f8a1-44e7-88b4-ae74a9fe5895' };
  values.set(
    key,
    JSON.stringify([
      { userId: 'owner', record },
      { userId: 'owner', record: later },
    ]),
  );
  request.mockRejectedValueOnce(Error('Expired')).mockResolvedValue({ saved: true });
  await expect(retryWorkoutSets('owner')).rejects.toThrow('1 workout saves are still pending.');
  expect(request).toHaveBeenCalledTimes(2);
  expect(pendingWorkoutSets('owner')).toBe(1);
});
it('tolerates corrupt device storage without duplicating the current record', async () => {
  values.set(key, 'invalid JSON');
  request.mockRejectedValue(Error('Offline'));
  await expect(saveWorkoutSet('owner', record)).rejects.toThrow();
  await expect(saveWorkoutSet('owner', record)).rejects.toThrow();
  expect(pendingWorkoutSets('owner')).toBe(1);
});
