const IDLE_MINUTES = [1, 2, 5, 10, 15, 30];
const DEFAULT_SETTINGS = { idleEnabled: false, idleMinutes: 5 };

function validateSettings(value) {
  if (!value || typeof value.idleEnabled !== 'boolean' || !IDLE_MINUTES.includes(value.idleMinutes)) {
    throw new Error('Invalid screensaver preferences');
  }
  return { idleEnabled: value.idleEnabled, idleMinutes: value.idleMinutes };
}

function idleAction({ enabled, active, locked, idleState, idleSeconds, threshold, cooldown }) {
  if (locked || idleState === 'locked' || !enabled) return active ? 'dismiss' : 'none';
  if (active) return idleSeconds < 2 ? 'dismiss' : 'none';
  if (cooldown || idleState === 'unknown' || !Number.isFinite(idleSeconds)) return 'none';
  return idleSeconds >= threshold ? 'start' : 'none';
}

module.exports = { DEFAULT_SETTINGS, validateSettings, idleAction };
