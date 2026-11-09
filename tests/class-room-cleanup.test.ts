import { describe, expect, it, vi } from 'vitest';
import { releaseUnclaimedRoom } from '../src/lib/class-room-cleanup';

describe('class start room cleanup', () => {
  it('deletes a room prepared by a start that lost the optimistic update', async () => {
    const remove = vi.fn(async () => undefined);
    const released = await releaseUnclaimedRoom('class', {
      read: async () => ({ status: 'scheduled', videoRoomName: null }),
      remove,
    });
    expect(released).toBe(true);
    expect(remove).toHaveBeenCalledWith('geez-squad-class');
  });
  it('keeps the room when a concurrent start already made the class live with it', async () => {
    const remove = vi.fn(async () => undefined);
    const released = await releaseUnclaimedRoom('class', {
      read: async () => ({ status: 'live', videoRoomName: 'geez-squad-class' }),
      remove,
    });
    expect(released).toBe(false);
    expect(remove).not.toHaveBeenCalled();
  });
  it('deletes the prepared room when the class was cancelled concurrently', async () => {
    const remove = vi.fn(async () => undefined);
    await releaseUnclaimedRoom('class', {
      read: async () => ({ status: 'cancelled', videoRoomName: null }),
      remove,
    });
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
