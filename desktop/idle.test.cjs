const { test } = require('node:test');
const assert = require('node:assert/strict');
const { idleAction, validateSettings } = require('./idle.cjs');
const base = { enabled: true, active: false, locked: false, idleState: 'idle', idleSeconds: 300, threshold: 300, cooldown: false };

test('idle activation respects preferences, OS locks, availability, and cooldown', () => {
  assert.equal(idleAction(base), 'start');
  for (const change of [{ enabled: false }, { locked: true }, { cooldown: true }, { idleState: 'unknown' }, { idleState: 'locked' }, { idleSeconds: 299 }]) {
    assert.equal(idleAction({ ...base, ...change }), 'none');
  }
});
test('activity, a lock, or disabling auto-start dismisses an active saver', () => {
  for (const change of [{ idleSeconds: 0 }, { locked: true }, { enabled: false }]) {
    assert.equal(idleAction({ ...base, active: true, ...change }), 'dismiss');
  }
});
test('renderer settings cannot smuggle invalid intervals or extra persisted data', () => {
  assert.throws(() => validateSettings({ idleEnabled: true, idleMinutes: -1 }));
  assert.throws(() => validateSettings({ idleEnabled: 'true', idleMinutes: 5 }));
  assert.deepEqual(validateSettings({ idleEnabled: true, idleMinutes: 5, extra: 'discard' }), { idleEnabled: true, idleMinutes: 5 });
});
