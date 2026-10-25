const { desktopConfig } = require('./scripts/lib/desktop-config.cjs');

// Use scripts/desktop-build.mjs to stage this edition and select its native target.
module.exports = desktopConfig();
