// config/store.js
//
// Thin wrapper around electron-store that defines the schema and
// default values for everything the app needs to remember between
// launches: which deity is selected, where the dangle sits on the
// screen, and the user's preferences.
//
// NOTE: electron-store is pinned to v8.x in package.json because
// v9+ ships as an ES Module and cannot be loaded with require().

const Store = require('electron-store');

const schema = {
  theme: {
    type: 'string',
    enum: [
      'sakthiman',
      'vinayak',
      'murugan',
      'vinayagar',
      'classicMurugan',
      'classicVinayagar'
    ],
    default: 'sakthiman'
  },
  xPercent: {
    // Horizontal position of the dangle, as a percentage (0-100)
    // of the width of the display it lives on. Using a percentage
    // (instead of raw pixels) keeps the saved position sensible
    // even if the app later opens on a different-resolution screen.
    type: 'number',
    minimum: 0,
    maximum: 100,
    default: 50
  },
  chainLength: {
    type: 'number',
    minimum: 20,
    maximum: 2000,
    default: 46
  },
  displayId: {
    // Which physical display (by Electron's screen.Display#id) the
    // dangle was last placed on. Falls back gracefully if that
    // display is no longer connected.
    type: ['number', 'null'],
    default: null
  },
  alwaysOnTop: {
    type: 'boolean',
    default: true
  },
  swingEnabled: {
    type: 'boolean',
    default: true
  },
  launchAtStartup: {
    type: 'boolean',
    default: false
  }
};

const store = new Store({
  name: 'lucky-dangle-config',
  schema,
  clearInvalidConfig: true
});

const legacyThemeMap = {
  murugan: 'sakthiman',
  vinayagar: 'vinayak',
  classicMurugan: 'sakthiman',
  classicVinayagar: 'vinayak'
};

const savedTheme = store.get('theme');
if (legacyThemeMap[savedTheme]) {
  store.set('theme', legacyThemeMap[savedTheme]);
}

module.exports = store;
