import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestCamera } from '../src/lib/camera-access';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
function deferredCamera() {
  let resolve!: (stream: MediaStream) => void;
  let reject!: (error: unknown) => void;
  const pending = new Promise<MediaStream>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  const getUserMedia = vi.fn(() => pending);
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
  const stop = vi.fn();
  return {
    resolve,
    reject,
    stop,
    getUserMedia,
    stream: { getTracks: () => [{ stop }] } as unknown as MediaStream,
  };
}
describe('camera request ownership', () => {
  it('returns a granted stream without stopping it after request cleanup', async () => {
    const camera = deferredCamera(),
      abort = new AbortController();
    const pending = requestCamera({ video: true }, abort.signal);
    camera.resolve(camera.stream);
    expect(await pending).toBe(camera.stream);
    abort.abort();
    expect(camera.stop).not.toHaveBeenCalled();
  });
  it('closes a late grant after a permission request times out', async () => {
    vi.useFakeTimers();
    const camera = deferredCamera();
    const pending = requestCamera({ video: true }, new AbortController().signal, 100);
    const rejected = expect(pending).rejects.toMatchObject({ name: 'TimeoutError' });
    await vi.advanceTimersByTimeAsync(101);
    await rejected;
    camera.resolve(camera.stream);
    await Promise.resolve();
    expect(camera.stop).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('closes a stream granted after the user leaves or cancels setup', async () => {
    const camera = deferredCamera(),
      abort = new AbortController();
    const pending = requestCamera({ video: true }, abort.signal);
    abort.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    camera.resolve(camera.stream);
    await Promise.resolve();
    expect(camera.stop).toHaveBeenCalledOnce();
  });
  it('does not request hardware when already cancelled', async () => {
    const camera = deferredCamera(),
      abort = new AbortController();
    abort.abort();
    await expect(requestCamera({ video: true }, abort.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(camera.getUserMedia).not.toHaveBeenCalled();
  });
  it('propagates permission denial and clears the deadline', async () => {
    vi.useFakeTimers();
    const camera = deferredCamera();
    const pending = requestCamera({ video: true }, new AbortController().signal);
    camera.reject(new DOMException('Denied by fixture', 'NotAllowedError'));
    await expect(pending).rejects.toMatchObject({ name: 'NotAllowedError' });
    expect(vi.getTimerCount()).toBe(0);
  });
});
