import { useEffect, useState } from 'react';

export function useDisplay() {
  const [now, setNow] = useState(Date.now());
  const [online, setOnline] = useState(navigator.onLine);
  const [controls, setControls] = useState(false);
  const [awake, setAwake] = useState(false);
  const [message, setMessage] = useState('');
  const [fullscreen, setFullscreen] = useState(Boolean(document.fullscreenElement));
  const nativeHost = Boolean(window.nativeScreensaver);
  const automatic = nativeHost || Boolean(window.screensaver) && new URLSearchParams(location.search).get('mode') === 'idle';

  useEffect(() => {
    const clock = setInterval(() => { if (!document.hidden) setNow(Date.now()); }, 1_000);
    const updateNetwork = () => setOnline(navigator.onLine);
    const updateFullscreen = () => setFullscreen(Boolean(document.fullscreenElement));
    window.addEventListener('online', updateNetwork);
    window.addEventListener('offline', updateNetwork);
    if (!nativeHost) document.addEventListener('fullscreenchange', updateFullscreen);
    let hideTimer: ReturnType<typeof setTimeout>;
    const show = () => {
      setControls(true);
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => setControls(false), 4_000);
    };
    if (!nativeHost) {
      window.addEventListener('pointermove', show, { passive: true });
      window.addEventListener('pointerdown', show, { passive: true });
      window.addEventListener('keydown', show);
    }
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
  }, [nativeHost]);

  useEffect(() => {
    if (nativeHost || !awake || automatic) return;
    let cancelled = false;
    let active = true;
    let pending = false;
    let resumePending = false;
    let lock: WakeLockSentinel | null = null;
    const acquire = async () => {
      if (cancelled || !active || document.hidden || (lock && !lock.released)) return;
      if (pending) { resumePending = true; return; }
      pending = true;
      try {
        if (!('wakeLock' in navigator)) throw new Error('Wake lock unavailable');
        const next = await navigator.wakeLock.request('screen');
        if (cancelled || !active || document.hidden) await next.release(); else lock = next;
      } catch {
        // A denied request needs another explicit opt-in, not an automatic retry loop.
        resumePending = false;
        if (!cancelled && active && !document.hidden) { setAwake(false); setMessage('This device could not keep the screen awake.'); }
      } finally {
        pending = false;
        // A restored page may have asked for a lock while the previous hidden-page
        // request was still releasing. Revisit that request once cleanup settles.
        if (resumePending) { resumePending = false; void acquire(); }
      }
    };
    const release = () => {
      const previous = lock;
      lock = null;
      void previous?.release().catch(() => { /* A browser may already have released it. */ });
    };
    const visibility = () => { if (document.hidden) release(); else void acquire(); };
    const leave = () => { active = false; release(); };
    const resume = () => { active = true; void acquire(); };
    void acquire();
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', leave);
    window.addEventListener('pageshow', resume);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pagehide', leave);
      window.removeEventListener('pageshow', resume);
      release();
    };
  }, [awake, automatic, nativeHost]);

  useEffect(() => {
    if (nativeHost || !automatic || !window.screensaver) return;
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
  }, [automatic, nativeHost]);

  async function toggleFullscreen() {
    if (nativeHost) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
      else setMessage('Add this app to your Home Screen for an immersive display.');
    } catch { setMessage('Full screen is unavailable in this browser. Try installing the app.'); }
  }

  return { now, online, controls, awake, setAwake, message, setMessage, fullscreen, toggleFullscreen, automatic };
}
