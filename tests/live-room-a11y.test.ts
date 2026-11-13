import { describe, expect, it } from 'vitest';
import {
  CUE_VISIBLE_MS,
  cueHideDelay,
  galleryTileDescription,
  galleryTileName,
  type TileLabelInput,
} from '../src/lib/live-room-a11y';

const base: TileLabelInput = {
  name: 'Ava',
  helpRequested: false,
  paused: false,
  metric: { reps: 7, holdSeconds: 0, timed: false, technique: 'steady', tracked: true },
  connection: 'good',
};

describe('coach gallery tile accessibility', () => {
  it('keeps the short accessible name that tests and scripts match', () => {
    expect(galleryTileName(base)).toBe('Focus Ava');
    expect(galleryTileName({ ...base, helpRequested: true })).toBe('Focus Ava, help requested');
  });

  it('describes reps, technique, tracking and connection quality', () => {
    expect(galleryTileDescription(base)).toBe(
      '7 reps, technique steady, tracking, good connection.',
    );
    expect(
      galleryTileDescription({
        ...base,
        metric: { ...base.metric!, reps: 1, arms: { left: 1, right: 0 }, tracked: false },
        connection: 'poor',
      }),
    ).toBe('1 rep, left 1, right 0, technique steady, no recent tracking, poor connection.');
  });

  it('describes hold time for timed exercises and manual counts', () => {
    expect(
      galleryTileDescription({
        ...base,
        metric: { ...base.metric!, timed: true, holdSeconds: 24, technique: 'manual' },
      }),
    ).toBe('24 seconds hold, manual count, tracking, good connection.');
  });

  it('says when there is no summary, the class is paused or video is not joined', () => {
    expect(galleryTileDescription({ ...base, metric: null, connection: null })).toBe(
      'No recent summary, video not joined.',
    );
    expect(galleryTileDescription({ ...base, paused: true, connection: 'unknown' })).toBe(
      'Class paused.',
    );
  });
});

describe('coach cue auto-hide', () => {
  it('hides after the visible delay only when nothing holds it', () => {
    const free = { kept: false, hovered: false, focused: false };
    expect(cueHideDelay(free)).toBe(CUE_VISIBLE_MS);
    expect(cueHideDelay({ ...free, kept: true })).toBeNull();
    expect(cueHideDelay({ ...free, hovered: true })).toBeNull();
    expect(cueHideDelay({ ...free, focused: true })).toBeNull();
  });
});
