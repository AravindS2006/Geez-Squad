'use client';
import { useEffect, useRef, useState } from 'react';
import { Camera, VideoOff } from 'lucide-react';

export type DevicePreferences = {
  cameraId: string;
  microphoneId: string;
  cameraOn: boolean;
  microphoneOn: boolean;
};
export function VideoDevices({
  preferences,
  onChange,
  preview = false,
}: {
  preferences: DevicePreferences;
  onChange: (next: DevicePreferences) => void;
  preview?: boolean;
}) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [error, setError] = useState('');
  const [previewing, setPreviewing] = useState(false);
  const [loading, setLoading] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const capture = useRef<MediaStream | null>(null);
  const generation = useRef(0);
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const list = await navigator.mediaDevices?.enumerateDevices();
        if (active && list) setDevices(list);
      } catch {}
    };
    void refresh();
    navigator.mediaDevices?.addEventListener('devicechange', refresh);
    return () => {
      active = false;
      generation.current++;
      navigator.mediaDevices?.removeEventListener('devicechange', refresh);
      capture.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);
  function stopPreview() {
    generation.current++;
    capture.current?.getTracks().forEach((track) => track.stop());
    capture.current = null;
    if (video.current) video.current.srcObject = null;
    setPreviewing(false);
    setLoading(false);
  }
  async function startPreview(cameraId = preferences.cameraId) {
    const run = ++generation.current;
    capture.current?.getTracks().forEach((t) => t.stop());
    setError('');
    setLoading(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: cameraId
          ? {
              deviceId: { exact: cameraId },
              width: { ideal: 1280 },
              height: { ideal: 720 },
              frameRate: { ideal: 30 },
            }
          : { facingMode: 'user' },
        audio: false,
      });
      if (run !== generation.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      capture.current = stream;
      if (video.current) {
        video.current.srcObject = stream;
        await video.current.play();
      }
      if (run !== generation.current) return;
      setPreviewing(true);
      setDevices(await navigator.mediaDevices.enumerateDevices());
    } catch {
      if (run === generation.current) {
        capture.current?.getTracks().forEach((track) => track.stop());
        capture.current = null;
        if (video.current) video.current.srcObject = null;
        setPreviewing(false);
        setError('Camera preview could not start. Allow camera access or join with camera off.');
      }
    } finally {
      if (run === generation.current) setLoading(false);
    }
  }
  return (
    <div className="video-device-settings">
      {preview && (
        <>
          <div className="prejoin-preview">
            <video ref={video} muted playsInline />
            {!previewing && (
              <span>
                <VideoOff size={23} /> Your camera preview
              </span>
            )}
          </div>
          <button className="button outline" disabled={loading} onClick={() => void startPreview()}>
            <Camera size={16} />
            {loading ? 'Opening camera…' : previewing ? 'Refresh preview' : 'Preview camera'}
          </button>
          {(previewing || loading) && (
            <button className="text-link" onClick={stopPreview}>
              Stop preview
            </button>
          )}
        </>
      )}
      <label>
        Camera
        <select
          value={preferences.cameraId}
          onChange={(e) => {
            const id = e.target.value;
            onChange({ ...preferences, cameraId: id });
            if (previewing || loading) void startPreview(id);
          }}
        >
          <option value="">Default camera</option>
          {devices
            .filter((d) => d.kind === 'videoinput' && d.deviceId)
            .map((d, i) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || `Camera ${i + 1}`}
              </option>
            ))}
        </select>
      </label>
      <label>
        Microphone
        <select
          value={preferences.microphoneId}
          onChange={(e) => onChange({ ...preferences, microphoneId: e.target.value })}
        >
          <option value="">Default microphone</option>
          {devices
            .filter((d) => d.kind === 'audioinput' && d.deviceId)
            .map((d, i) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || `Microphone ${i + 1}`}
              </option>
            ))}
        </select>
      </label>
      {preview && (
        <>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={preferences.cameraOn}
              onChange={(e) => onChange({ ...preferences, cameraOn: e.target.checked })}
            />
            Join with camera on
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={preferences.microphoneOn}
              onChange={(e) => onChange({ ...preferences, microphoneOn: e.target.checked })}
            />
            Join with microphone on
          </label>
          <p className="microcopy">
            Preview is local. Video sharing starts when you join. Microphone is muted by default.
          </p>
        </>
      )}
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
