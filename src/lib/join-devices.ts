type ParticipantDevices = {
  setCameraEnabled: (enabled: boolean) => Promise<unknown>;
  setMicrophoneEnabled: (enabled: boolean) => Promise<unknown>;
};
/** A denied device must not prevent the other device from starting. */
export async function enableJoinDevices(
  participant: ParticipantDevices,
  preferences: { cameraOn: boolean; microphoneOn: boolean },
  isCurrent: () => boolean,
) {
  const errors: string[] = [];
  if (!isCurrent()) return errors;
  try {
    await participant.setCameraEnabled(preferences.cameraOn);
  } catch {
    errors.push('Camera unavailable. Allow camera access or choose another device in Settings.');
  }
  if (!isCurrent()) return errors;
  try {
    await participant.setMicrophoneEnabled(preferences.microphoneOn);
  } catch {
    errors.push(
      'Microphone unavailable. Allow microphone access or choose another device in Settings.',
    );
  }
  return errors;
}
