/** Own only streams acquired here. A late permission grant must never leave a camera running. */
export function requestCamera(
  constraints: MediaStreamConstraints,
  signal: AbortSignal,
  timeoutMs = 20000,
): Promise<MediaStream> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(deadline);
      signal.removeEventListener('abort', abort);
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const abort = () => fail(new DOMException('Camera request cancelled.', 'AbortError'));
    const deadline = setTimeout(
      () =>
        fail(
          new DOMException(
            'Camera permission is still pending. Check the browser camera prompt and retry.',
            'TimeoutError',
          ),
        ),
      timeoutMs,
    );
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) return abort();
    if (!navigator.mediaDevices?.getUserMedia) {
      fail(new Error('Camera access requires HTTPS or localhost and a supported browser.'));
      return;
    }
    navigator.mediaDevices.getUserMedia(constraints).then((stream) => {
      if (settled) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      settled = true;
      cleanup();
      resolve(stream);
    }, fail);
  });
}
