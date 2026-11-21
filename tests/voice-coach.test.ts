import { describe, expect, it } from 'vitest';
import {
  cuePriority,
  FAULT_GAP_MS,
  FAULT_REPEAT_MS,
  INFO_GAP_MS,
  initialVoiceGate,
  pickVoice,
  planSpeech,
  PROTECT_MS,
  resetHeardFaults,
  shortCue,
  speechLanguage,
  voiceEnabledFromPreference,
} from '../src/lib/voice-coach';

const curlFault = 'Keep your upper arm steadier and reduce the weight if needed.';
const slowFault = 'Rep not counted. Move more slowly and under control.';

describe('voice preference', () => {
  it('is on unless the trainee turned it off', () => {
    expect(voiceEnabledFromPreference(null)).toBe(true);
    expect(voiceEnabledFromPreference('on')).toBe(true);
    expect(voiceEnabledFromPreference('off')).toBe(false);
  });
});

describe('voice choice', () => {
  it('speaks English cues with an English voice', () => {
    expect(speechLanguage('en-GB')).toBe('en-GB');
    expect(speechLanguage('de-DE')).toBe('en-US');
    expect(speechLanguage(undefined)).toBe('en-US');
  });

  it('prefers neural and enhanced voices over default and novelty voices', () => {
    const voices = [
      { name: 'Microsoft David - English (United States)', lang: 'en-US', default: true },
      { name: 'Zarvox', lang: 'en-US' },
      { name: 'Microsoft Aria Online (Natural) - English (United States)', lang: 'en-US' },
      { name: 'Google Deutsch', lang: 'de-DE' },
    ];
    expect(pickVoice(voices, 'en-US')?.name).toContain('Aria Online (Natural)');
    const apple = [
      { name: 'Fred', lang: 'en-US' },
      { name: 'Samantha (Enhanced)', lang: 'en_US' },
      { name: 'Samantha', lang: 'en-US', default: true },
    ];
    expect(pickVoice(apple, 'en-US')?.name).toBe('Samantha (Enhanced)');
  });

  it('prefers the exact accent and never picks novelty or other-language voices', () => {
    const voices = [
      { name: 'Google UK English Female', lang: 'en-GB' },
      { name: 'Google US English', lang: 'en-US' },
    ];
    expect(pickVoice(voices, 'en-GB')?.name).toBe('Google UK English Female');
    expect(pickVoice([{ name: 'Bubbles', lang: 'en-US' }], 'en-US')).toBeNull();
    expect(pickVoice([{ name: 'Google français', lang: 'fr-FR' }], 'en-US')).toBeNull();
    expect(pickVoice([], 'en-US')).toBeNull();
  });
});

describe('cue priority', () => {
  it('treats form cues and rejected reps as faults', () => {
    expect(cuePriority(curlFault, { tracked: true, score: 80 })).toBe('fault');
    expect(cuePriority(slowFault, { tracked: true, score: null })).toBe('fault');
    expect(cuePriority('Hold steady and breathe comfortably.', { tracked: true, score: 60 })).toBe(
      'fault',
    );
    expect(cuePriority('Hold steady and breathe comfortably.', { tracked: true, score: 90 })).toBe(
      'info',
    );
    expect(
      cuePriority('Step back so your ankles are in view.', { tracked: false, score: null }),
    ).toBe('tracking');
  });

  it('has a short spoken form for rejected reps', () => {
    expect(shortCue(slowFault)).toBe('Not counted. Slow down.');
    expect(shortCue('Rep not counted. Something new.')).toBe('Not counted.');
    expect(shortCue(curlFault)).toBe('Keep your elbow still.');
    expect(shortCue('Unknown cue.')).toBeNull();
  });
});

describe('speech plan', () => {
  it('speaks a fault in full first, then briefly on repeats', () => {
    let gate = initialVoiceGate();
    let plan = planSpeech(gate, curlFault, 'fault', 0);
    expect(plan.text).toBe(curlFault);
    gate = plan.gate;
    plan = planSpeech(gate, curlFault, 'fault', FAULT_REPEAT_MS - 1);
    expect(plan.text).toBeNull();
    plan = planSpeech(gate, curlFault, 'fault', FAULT_REPEAT_MS);
    expect(plan.text).toBe('Keep your elbow still.');
    plan = planSpeech(resetHeardFaults(plan.gate), curlFault, 'fault', FAULT_REPEAT_MS * 3);
    expect(plan.text).toBe(curlFault);
  });

  it('does not chain different faults inside the gap', () => {
    const first = planSpeech(initialVoiceGate(), curlFault, 'fault', 0).gate;
    expect(planSpeech(first, slowFault, 'fault', FAULT_GAP_MS - 1).text).toBeNull();
    expect(planSpeech(first, slowFault, 'fault', FAULT_GAP_MS).text).toBe(slowFault);
  });

  it('lets a fault cut through setup chatter but not the other way round', () => {
    const info = planSpeech(initialVoiceGate(), 'Lower with control.', 'info', 0).gate;
    expect(planSpeech(info, curlFault, 'fault', 100).text).toBe(curlFault);
    const fault = planSpeech(initialVoiceGate(), curlFault, 'fault', 0).gate;
    expect(planSpeech(fault, 'Step back into view.', 'tracking', PROTECT_MS - 1).text).toBeNull();
    expect(planSpeech(fault, 'Step back into view.', 'tracking', PROTECT_MS).text).toBe(
      'Step back into view.',
    );
  });

  it('keeps the info gap and skips an unchanged cue', () => {
    const gate = planSpeech(initialVoiceGate(), 'Lower with control.', 'info', 0).gate;
    expect(planSpeech(gate, 'Press up.', 'info', INFO_GAP_MS - 1).text).toBeNull();
    expect(planSpeech(gate, 'Press up.', 'info', INFO_GAP_MS).text).toBe('Press up.');
    expect(planSpeech(gate, 'Lower with control.', 'info', INFO_GAP_MS * 5).text).toBeNull();
  });

  it('always speaks forced announcements and protects them briefly', () => {
    const gate = planSpeech(initialVoiceGate(), 'Lower with control.', 'info', 0).gate;
    const forced = planSpeech(gate, 'Go. Your set has started.', 'info', 10, true);
    expect(forced.text).toBe('Go. Your set has started.');
    expect(planSpeech(forced.gate, 'Step back.', 'tracking', 2000).text).toBeNull();
    expect(planSpeech(forced.gate, '', 'fault', 5000).text).toBeNull();
  });
});
