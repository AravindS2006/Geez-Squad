import 'server-only';
import { RoomServiceClient, DataPacket_Kind } from 'livekit-server-sdk';
import { existingVideoRoomName } from './room-identity';
import { logEvent } from './logger';
export const MEETING_EVENT_TOPIC = 'geez-coaching-v2';
/** Notifications contain no metrics or messages. HTTP remains the authorized source of truth. */
export async function notifyMeeting(
  item: { id: string; videoRoomName: string | null; controlSequence: number },
  recipients?: string[],
) {
  const { LIVEKIT_URL: url, LIVEKIT_API_KEY: key, LIVEKIT_API_SECRET: secret } = process.env;
  if (!url || !key || !secret) return;
  try {
    const client = new RoomServiceClient(url.replace(/^ws/, 'http'), key, secret);
    await client.sendData(
      existingVideoRoomName(item),
      new TextEncoder().encode(
        JSON.stringify({
          version: 2,
          classId: item.id,
          sequence: item.controlSequence,
          nonce: crypto.randomUUID(),
        }),
      ),
      DataPacket_Kind.RELIABLE,
      {
        topic: MEETING_EVENT_TOPIC,
        ...(recipients ? { destinationIdentities: [...new Set(recipients)] } : {}),
      },
    );
  } catch {
    logEvent('warn', 'meeting_notification_delayed', { targetId: item.id, provider: 'livekit' });
  }
}
