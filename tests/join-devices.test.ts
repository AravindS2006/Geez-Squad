import { expect, it, vi } from 'vitest';
import { enableJoinDevices } from '../src/lib/join-devices';
it('joins with microphone when camera is denied', async () => {
  const participant = {
    setCameraEnabled: vi.fn().mockRejectedValue(new Error('denied')),
    setMicrophoneEnabled: vi.fn().mockResolvedValue(undefined),
  };
  const errors = await enableJoinDevices(
    participant,
    { cameraOn: true, microphoneOn: true },
    () => true,
  );
  expect(participant.setMicrophoneEnabled).toHaveBeenCalledWith(true);
  expect(errors).toHaveLength(1);
  expect(errors[0]).toContain('Camera');
});
it('keeps a working camera when microphone fails', async () => {
  const participant = {
    setCameraEnabled: vi.fn().mockResolvedValue(undefined),
    setMicrophoneEnabled: vi.fn().mockRejectedValue(new Error('denied')),
  };
  const errors = await enableJoinDevices(
    participant,
    { cameraOn: true, microphoneOn: true },
    () => true,
  );
  expect(participant.setCameraEnabled).toHaveBeenCalledWith(true);
  expect(errors).toHaveLength(1);
  expect(errors[0]).toContain('Microphone');
});
it('does not start another device after leave or an overlapping join cancels setup', async () => {
  let current = true;
  const participant = {
    setCameraEnabled: vi.fn().mockImplementation(async () => {
      current = false;
    }),
    setMicrophoneEnabled: vi.fn(),
  };
  await enableJoinDevices(participant, { cameraOn: true, microphoneOn: true }, () => current);
  expect(participant.setMicrophoneEnabled).not.toHaveBeenCalled();
});
it('supports joining with both devices off', async () => {
  const participant = {
    setCameraEnabled: vi.fn().mockResolvedValue(undefined),
    setMicrophoneEnabled: vi.fn().mockResolvedValue(undefined),
  };
  expect(
    await enableJoinDevices(participant, { cameraOn: false, microphoneOn: false }, () => true),
  ).toEqual([]);
  expect(participant.setCameraEnabled).toHaveBeenCalledWith(false);
  expect(participant.setMicrophoneEnabled).toHaveBeenCalledWith(false);
});
