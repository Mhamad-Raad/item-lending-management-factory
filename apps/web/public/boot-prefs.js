// Applies saved browser preferences before React renders (no flash of wrong language/theme).
// Must stay in sync with src/lib/preferences.ts (key, defaults, allowed values).
(function () {
  var KEY = 'pallet.prefs.v1';
  var FONT_PX = { sm: 14, md: 16, lg: 18, xl: 20 };
  var prefs = { language: 'ckb', theme: 'light', palette: 'harbor', font: 'inter', fontSize: 'md' };
  var allowed = {
    language: ['ckb', 'ar', 'en'],
    theme: ['light', 'dark', 'system'],
    palette: ['harbor', 'lagoon', 'forest', 'timber', 'clay', 'plum', 'graphite'],
    font: ['inter', 'vazirmatn', 'plex', 'kufi', 'naskh'],
  };
  try {
    var saved = JSON.parse(localStorage.getItem(KEY) || '{}');
    for (var field in allowed) {
      if (allowed[field].indexOf(saved[field]) >= 0) prefs[field] = saved[field];
    }
    if (FONT_PX[saved.fontSize]) prefs.fontSize = saved.fontSize;
  } catch (e) {
    // Corrupt or blocked storage: keep defaults.
  }
  var dark =
    prefs.theme === 'dark' ||
    (prefs.theme === 'system' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  var root = document.documentElement;
  root.lang = prefs.language;
  root.dir = prefs.language === 'en' ? 'ltr' : 'rtl';
  root.classList.toggle('dark', dark);
  root.style.colorScheme = dark ? 'dark' : 'light';
  root.setAttribute('data-palette', prefs.palette);
  root.setAttribute('data-font', prefs.font);
  root.style.setProperty('--app-font-size', FONT_PX[prefs.fontSize] + 'px');
})();
