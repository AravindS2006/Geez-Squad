// Spoken coaching for the camera analyzer. Pure and free of browser globals so the
// voice choice and the speak/skip decision can be unit tested. Speech only reads
// cues the engine already produced; it never changes counting or scoring.

export const VOICE_PREFERENCE_KEY = 'geez-squad-voice';
export const VOICE_RATE = 1.05;
export const VOICE_PITCH = 1;

export type VoiceCandidate = {
  name: string;
  lang: string;
  localService?: boolean;
  default?: boolean;
};

// Novelty and effect voices shipped with macOS/iOS. They are never coaching voices.
const novelty =
  /\b(albert|bad news|bahh|bells|boing|bubbles|cellos|deranged|good news|hysterical|jester|organ|superstar|trinoids|whisper|wobble|zarvox)\b/i;
// Apple's compact character voices sound noticeably synthetic next to Siri-class voices.
const compact = /\b(eddy|flo|fred|grandma|grandpa|junior|kathy|ralph|reed|rocko|sandy|shelley)\b/i;

const normalizeLang = (lang: string) => lang.replace('_', '-').toLowerCase();

// Cue text is English, so speak it with an English voice even on non-English browsers.
export function speechLanguage(browserLanguage: string | undefined): string {
  return browserLanguage && /^en\b/i.test(browserLanguage) ? browserLanguage : 'en-US';
}

export function voiceScore(voice: VoiceCandidate, lang: string): number {
  const wanted = normalizeLang(lang);
  const actual = normalizeLang(voice.lang);
  if (actual.split('-')[0] !== wanted.split('-')[0]) return -Infinity;
  if (novelty.test(voice.name)) return -Infinity;
  let score = actual === wanted ? 40 : 20;
  // Edge/Windows "Online (Natural)" and other neural voices are the most human.
  if (/natural|neural/i.test(voice.name)) score += 35;
  // Apple downloadable Siri-class voices.
  if (/enhanced|premium/i.test(voice.name)) score += 30;
  // Chrome's network voices are smoother than most local eSpeak/SAPI voices.
  if (/^google\b/i.test(voice.name)) score += 15;
  if (
    /\b(samantha|ava|allison|serena|karen|daniel|moira|tessa|zoe|evan|nathan|aria|jenny|guy)\b/i.test(
      voice.name,
    )
  )
    score += 10;
  if (compact.test(voice.name)) score -= 20;
  if (/espeak/i.test(voice.name)) score -= 30;
  if (voice.localService) score += 1;
  if (voice.default) score += 2;
  return score;
}

// Best installed voice for the language, or null to let the browser use its default.
export function pickVoice<T extends VoiceCandidate>(voices: readonly T[], lang: string): T | null {
  let best: T | null = null;
  let bestScore = -Infinity;
  for (const voice of voices) {
    const score = voiceScore(voice, lang);
    if (score > bestScore) {
      best = voice;
      bestScore = score;
    }
  }
  return bestScore === -Infinity ? null : best;
}

// Short spoken forms for the form cues in pose-form.ts and pose-engine.ts. The first
// time a fault is heard in a set the full cue is spoken; repeats use the short form.
const shortForms: Record<string, string> = {
  'Keep shoulders, hips, and ankles in a steadier line.': 'Brace. Keep your body in one line.',
  'Keep shoulders, hips, and knees in a steadier line.': 'Brace. Keep your body in one line.',
  'Move into a side-on push-up position: hands below shoulders, legs extended.':
    'Turn side-on. Hands under shoulders.',
  'Keep your upper arm steadier and reduce the weight if needed.': 'Keep your elbow still.',
  'Keep your torso steady as you curl.': 'No swinging. Torso steady.',
  'Check your trunk position with your coach before continuing.': 'Check your trunk position.',
  'Start with your hands near shoulder height, then press upward.': 'Hands at shoulder height.',
  'Keep your torso tall and steady.': 'Stay tall.',
  'Raise only to your coach-approved shoulder height.': 'Shoulder height only.',
  'Hinge at your hips and keep your trunk steady before rowing.': 'Hinge at the hips.',
  'Keep your knees softly bent and push your hips back, not down.': 'Soft knees. Hips back.',
  'Keep your elbows pointing up beside your head.': 'Elbows up.',
  'Keep your back flat against the wall.': 'Back flat on the wall.',
  'Keep your trunk upright.': 'Stay upright.',
  'Turn onto your supporting side and stack your shoulders. Ask your coach to verify the side plank.':
    'Stack your shoulders.',
  'Return to the start and make one continuous controlled movement.': 'One smooth rep.',
  'Complete your coach-approved range and return to the start. Adjust the range with your coach if needed.':
    'Full range.',
  'Move more slowly and under control.': 'Slow down.',
  'Ask your coach to correct your alignment before continuing.': 'Check your alignment.',
};
const notCounted = 'Rep not counted. ';

export function shortCue(cue: string): string | null {
  if (cue.startsWith(notCounted)) {
    const rest = shortForms[cue.slice(notCounted.length)];
    return rest ? `Not counted. ${rest}` : 'Not counted.';
  }
  return shortForms[cue] ?? null;
}

export type CuePriority = 'fault' | 'tracking' | 'info';

export function cuePriority(
  cue: string,
  analysis: { tracked: boolean; score: number | null },
): CuePriority {
  if (cue.startsWith(notCounted) || cue in shortForms) return 'fault';
  if (analysis.score !== null && analysis.score < 75 && analysis.tracked) return 'fault';
  return analysis.tracked ? 'info' : 'tracking';
}

export type VoiceGate = {
  cue: string;
  at: number;
  priority: CuePriority | 'forced';
  heard: Record<string, number>;
};

export const initialVoiceGate = (): VoiceGate => ({
  cue: '',
  at: -Infinity,
  priority: 'info',
  heard: {},
});

// Same fault again only after this long, so a repeated mistake is corrected about once per rep.
export const FAULT_REPEAT_MS = 6000;
// Two different faults are not spoken back to back.
export const FAULT_GAP_MS = 2000;
export const TRACKING_GAP_MS = 2000;
export const INFO_GAP_MS = 7000;
// Lower-priority cues never cut off a fault or a forced announcement this recent.
export const PROTECT_MS = 4000;

// Decides whether a cue is spoken now and with which words. Returns the next gate
// state; text is null when the cue is skipped. Whatever is spoken interrupts the
// current utterance, because a stale cue is worse than a cut-off one.
export function planSpeech(
  gate: VoiceGate,
  cue: string,
  priority: CuePriority,
  now: number,
  force = false,
): { gate: VoiceGate; text: string | null } {
  if (!cue) return { gate, text: null };
  const since = now - gate.at;
  if (force) return { gate: { ...gate, cue, at: now, priority: 'forced' }, text: cue };
  if (priority === 'fault') {
    if (gate.cue === cue && since < FAULT_REPEAT_MS) return { gate, text: null };
    if (gate.priority === 'fault' && since < FAULT_GAP_MS) return { gate, text: null };
    const times = gate.heard[cue] ?? 0;
    const text = times > 0 ? (shortCue(cue) ?? cue) : cue;
    return {
      gate: { cue, at: now, priority, heard: { ...gate.heard, [cue]: times + 1 } },
      text,
    };
  }
  if ((gate.priority === 'fault' || gate.priority === 'forced') && since < PROTECT_MS)
    return { gate, text: null };
  if (gate.cue === cue) return { gate, text: null };
  if (since < (priority === 'tracking' ? TRACKING_GAP_MS : INFO_GAP_MS))
    return { gate, text: null };
  return { gate: { ...gate, cue, at: now, priority }, text: cue };
}

// A new set starts with full-length corrections again.
export const resetHeardFaults = (gate: VoiceGate): VoiceGate => ({ ...gate, heard: {} });

export const voiceEnabledFromPreference = (stored: string | null) => stored !== 'off';
