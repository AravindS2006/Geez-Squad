'use client';
import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
type InstallEvent = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> };
export function AppInstall() {
  const [prompt, setPrompt] = useState<InstallEvent | null>(null);
  const [offline, setOffline] = useState(false);
  const [ios, setIos] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    try {
      setDismissed(sessionStorage.getItem('geez-install-dismissed:v1') === 'yes');
    } catch {}
    if (
      'serviceWorker' in navigator &&
      window.isSecureContext &&
      process.env.NODE_ENV === 'production'
    )
      void navigator.serviceWorker
        .register('/sw.js', { scope: '/', updateViaCache: 'none' })
        .catch(() => {});
    const display = window.matchMedia('(display-mode: standalone)');
    const updateDisplay = () =>
      setInstalled(
        display.matches || !!(navigator as Navigator & { standalone?: boolean }).standalone,
      );
    updateDisplay();
    setIos(
      /iPhone|iPad|iPod/.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1),
    );
    const connection = () => setOffline(!navigator.onLine);
    const ready = (event: Event) => {
      event.preventDefault();
      setPrompt(event as InstallEvent);
    };
    const completed = () => {
      setInstalled(true);
      setPrompt(null);
    };
    connection();
    display.addEventListener('change', updateDisplay);
    window.addEventListener('online', connection);
    window.addEventListener('offline', connection);
    window.addEventListener('beforeinstallprompt', ready);
    window.addEventListener('appinstalled', completed);
    return () => {
      display.removeEventListener('change', updateDisplay);
      window.removeEventListener('online', connection);
      window.removeEventListener('offline', connection);
      window.removeEventListener('beforeinstallprompt', ready);
      window.removeEventListener('appinstalled', completed);
    };
  }, []);
  return (
    <>
      {offline && (
        <div className="connection-banner" role="status">
          Offline · Live coaching and new saves will resume when connected.
        </div>
      )}
      {!installed && !dismissed && (prompt || ios) && (
        <div className="app-install">
          <details>
            <summary>Install Geez Squad</summary>
            <p>Open your studio from your home screen.</p>
            {prompt ? (
              <button
                className="button dark"
                onClick={async () => {
                  try {
                    await prompt.prompt();
                    await prompt.userChoice;
                  } finally {
                    setPrompt(null);
                  }
                }}
              >
                Install app
              </button>
            ) : (
              <p>In Safari, open Share, then choose Add to Home Screen.</p>
            )}
          </details>
          <button
            className="install-dismiss"
            aria-label="Dismiss install suggestion"
            onClick={() => {
              setDismissed(true);
              try {
                sessionStorage.setItem('geez-install-dismissed:v1', 'yes');
              } catch {}
            }}
          >
            <X size={18} />
          </button>
        </div>
      )}
    </>
  );
}
