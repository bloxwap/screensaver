import { useEffect, useState } from 'react';

export function useDisplay() {
  const [now, setNow] = useState(Date.now());
  const [online, setOnline] = useState(navigator.onLine);
  const [controls, setControls] = useState(true);
  const [awake, setAwake] = useState(false);
  const [message, setMessage] = useState('');
  const [fullscreen, setFullscreen] = useState(Boolean(document.fullscreenElement));
  const automatic = new URLSearchParams(location.search).get('mode') === 'idle';

  useEffect(() => {
    const clock = setInterval(() => { if (!document.hidden) setNow(Date.now()); }, 1_000);
    const updateNetwork = () => setOnline(navigator.onLine);
    const updateFullscreen = () => setFullscreen(Boolean(document.fullscreenElement));
    window.addEventListener('online', updateNetwork);
    window.addEventListener('offline', updateNetwork);
    document.addEventListener('fullscreenchange', updateFullscreen);
    let hideTimer: ReturnType<typeof setTimeout>;
    const show = () => {
      setControls(true);
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => setControls(false), 4_000);
    };
    show();
    window.addEventListener('pointermove', show, { passive: true });
    window.addEventListener('pointerdown', show, { passive: true });
    window.addEventListener('keydown', show);
    return () => {
      clearInterval(clock);
      clearTimeout(hideTimer);
      window.removeEventListener('online', updateNetwork);
      window.removeEventListener('offline', updateNetwork);
      document.removeEventListener('fullscreenchange', updateFullscreen);
      window.removeEventListener('pointermove', show);
      window.removeEventListener('pointerdown', show);
      window.removeEventListener('keydown', show);
    };
  }, []);

  useEffect(() => {
    if (!awake || automatic) return;
    let cancelled = false;
    let lock: WakeLockSentinel | null = null;
    const acquire = async () => {
      if (document.hidden || (lock && !lock.released)) return;
      try {
        const next = await navigator.wakeLock.request('screen');
        if (cancelled) await next.release(); else lock = next;
      } catch {
        if (!cancelled) { setAwake(false); setMessage('This device could not keep the screen awake.'); }
      }
    };
    void acquire();
    document.addEventListener('visibilitychange', acquire);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', acquire);
      void lock?.release();
    };
  }, [awake, automatic]);

  useEffect(() => {
    if (!automatic || !window.screensaver) return;
    // Give the window time to settle before responding to pointer events generated on opening.
    const started = performance.now();
    const dismiss = () => { if (performance.now() - started > 1_500) window.screensaver?.dismiss(); };
    window.addEventListener('pointermove', dismiss);
    window.addEventListener('pointerdown', dismiss);
    window.addEventListener('keydown', dismiss);
    return () => {
      window.removeEventListener('pointermove', dismiss);
      window.removeEventListener('pointerdown', dismiss);
      window.removeEventListener('keydown', dismiss);
    };
  }, [automatic]);

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
      else setMessage('Add this app to your Home Screen for an immersive display.');
    } catch { setMessage('Full screen is unavailable in this browser. Try installing the app.'); }
  }

  return { now, online, controls, awake, setAwake, message, setMessage, fullscreen, toggleFullscreen, automatic };
}
