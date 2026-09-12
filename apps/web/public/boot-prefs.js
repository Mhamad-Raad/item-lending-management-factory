// Applies saved browser preferences before React renders (no flash of wrong language/theme).
// Must stay in sync with src/lib/preferences.ts (key, defaults, allowed values).
(function () {
  var KEY = 'pallet.prefs.v1';
  var FONT_PX = { sm: 14, md: 16, lg: 18, xl: 20 };
  var prefs = { language: 'ckb', theme: 'light', fontSize: 'md' };
  try {
    var saved = JSON.parse(localStorage.getItem(KEY) || '{}');
    if (['ckb', 'ar', 'en'].indexOf(saved.language) >= 0) prefs.language = saved.language;
    if (['light', 'dark'].indexOf(saved.theme) >= 0) prefs.theme = saved.theme;
    if (FONT_PX[saved.fontSize]) prefs.fontSize = saved.fontSize;
  } catch (e) {
    // Corrupt or blocked storage: keep defaults.
  }
  var root = document.documentElement;
  root.lang = prefs.language;
  root.dir = prefs.language === 'en' ? 'ltr' : 'rtl';
  root.classList.toggle('dark', prefs.theme === 'dark');
  root.style.colorScheme = prefs.theme;
  root.style.setProperty('--app-font-size', FONT_PX[prefs.fontSize] + 'px');
})();
