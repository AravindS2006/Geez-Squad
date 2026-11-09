import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserPoseTask, initialPoseModel } from '../src/lib/pose-browser';

const media = vi.hoisted(() => ({ create: vi.fn(), files: vi.fn() }));
vi.mock('@mediapipe/tasks-vision', () => ({
  FilesetResolver: { forVisionTasks: media.files },
  PoseLandmarker: { createFromOptions: media.create },
}));

function model() {
  return { close: vi.fn(), detectForVideo: vi.fn(() => ({ landmarks: [], worldLandmarks: [] })) };
}
function task() {
  const instance = new BrowserPoseTask();
  const messages: Record<string, unknown>[] = [];
  instance.onmessage = (event) => messages.push(event.data);
  return { instance, messages };
}
const init = { type: 'init', variant: 'full', cpuOnly: false } as const;
function frame() {
  const close = vi.fn();
  return {
    close,
    request: {
      type: 'frame',
      bitmap: { width: 540, height: 960, close } as unknown as ImageBitmap,
      timestamp: 123,
      mediaTimeMs: 456,
      width: 540,
      height: 960,
      presentFrame: true,
    } as const,
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  media.files.mockResolvedValue({});
  vi.stubGlobal('document', { createElement: vi.fn(() => ({ width: 1, height: 1 })) });
});
afterEach(() => vi.unstubAllGlobals());

describe('iOS browser pose compatibility', () => {
  it('starts Full on iPhone and desktop-mode iPad without changing desktop Heavy', () => {
    vi.stubGlobal('navigator', { userAgent: 'iPhone', platform: 'iPhone', maxTouchPoints: 5 });
    expect(initialPoseModel()).toBe('full');
    vi.stubGlobal('navigator', { userAgent: 'Macintosh', platform: 'MacIntel', maxTouchPoints: 5 });
    expect(initialPoseModel()).toBe('full');
    vi.stubGlobal('navigator', { userAgent: 'Macintosh', platform: 'MacIntel', maxTouchPoints: 0 });
    expect(initialPoseModel()).toBe('heavy');
  });
  it('falls back from rejected GPU initialization to CPU with an explicit HTML canvas', async () => {
    const cpu = model();
    media.create.mockRejectedValueOnce(new Error('GPU unavailable')).mockResolvedValueOnce(cpu);
    const { instance, messages } = task();
    instance.postMessage(init);
    await vi.waitFor(() =>
      expect(messages).toContainEqual({ type: 'ready', variant: 'full', delegate: 'CPU' }),
    );
    expect(media.create.mock.calls.map((call) => call[1].baseOptions.delegate)).toEqual([
      'GPU',
      'CPU',
    ]);
    expect(media.create.mock.calls.every((call) => !!call[1].canvas)).toBe(true);
    instance.terminate();
    expect(cpu.close).toHaveBeenCalledOnce();
  });
  it('closes a model that finishes initializing after cancellation and never signals ready', async () => {
    let resolve!: (value: ReturnType<typeof model>) => void;
    media.create.mockReturnValueOnce(
      new Promise((yes) => {
        resolve = yes;
      }),
    );
    const { instance, messages } = task();
    instance.postMessage(init);
    await vi.waitFor(() => expect(media.create).toHaveBeenCalledOnce());
    instance.terminate();
    const late = model();
    resolve(late);
    await vi.waitFor(() => expect(late.close).toHaveBeenCalledOnce());
    expect(messages).toEqual([]);
  });
  it('recovers inference on CPU and returns the same observed frame and timestamps once', async () => {
    const gpu = model(),
      cpu = model();
    gpu.detectForVideo.mockImplementation(() => {
      throw new Error('context lost');
    });
    gpu.close.mockImplementation(() => {
      throw new Error('context already lost');
    });
    media.create.mockResolvedValueOnce(gpu).mockResolvedValueOnce(cpu);
    const { instance, messages } = task();
    instance.postMessage(init);
    await vi.waitFor(() => expect(messages[0]?.type).toBe('ready'));
    const input = frame();
    instance.postMessage(input.request);
    await vi.waitFor(() =>
      expect(messages.filter((message) => message.type === 'result')).toHaveLength(1),
    );
    expect(messages).toContainEqual(expect.objectContaining({ type: 'backend', delegate: 'CPU' }));
    expect(messages).toContainEqual(
      expect.objectContaining({
        type: 'result',
        timestamp: 123,
        mediaTimeMs: 456,
        width: 540,
        height: 960,
        bitmap: input.request.bitmap,
      }),
    );
    expect(input.close).not.toHaveBeenCalled();
    expect(gpu.close).toHaveBeenCalledOnce();
    instance.terminate();
    expect(cpu.close).toHaveBeenCalledOnce();
  });
  it('closes a queued frame when tracking is stopped before inference', async () => {
    const active = model();
    media.create.mockResolvedValueOnce(active);
    const { instance, messages } = task();
    instance.postMessage(init);
    await vi.waitFor(() => expect(messages[0]?.type).toBe('ready'));
    const input = frame();
    instance.postMessage(input.request);
    instance.terminate();
    expect(input.close).toHaveBeenCalledOnce();
    expect(active.detectForVideo).not.toHaveBeenCalled();
  });
});
