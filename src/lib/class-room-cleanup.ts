import { newVideoRoomName } from './room-identity';

/**
 * A class start prepares its LiveKit room before the optimistic database update,
 * so a session never becomes live without video. When that update loses, delete
 * the prepared room unless a concurrent start already claimed the same name.
 */
export async function releaseUnclaimedRoom(
  classId: string,
  deps: {
    read: () => Promise<{ status: string; videoRoomName: string | null } | null>;
    remove: (roomName: string) => Promise<void>;
  },
) {
  const roomName = newVideoRoomName(classId);
  const current = await deps.read();
  if (current?.status === 'live' && current.videoRoomName === roomName) return false;
  await deps.remove(roomName);
  return true;
}
