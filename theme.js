(function () {
  const THEMES = ['dark', 'light', 'space', 'sunset', 'mono', 'solarized', 'gameboy'];
  const KEY = 'arcade-theme';

  function applyTheme(theme) {
    if (!THEMES.includes(theme)) theme = 'dark';
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem(KEY, theme); } catch (_) {}
    document.querySelectorAll('.swatch').forEach((s) => {
      s.classList.toggle('active', s.dataset.theme === theme);
    });
    window.dispatchEvent(new CustomEvent('themechange', { detail: { theme } }));
  }

  function init() {
    let saved = null;
    try { saved = localStorage.getItem(KEY); } catch (_) {}
    const theme = THEMES.includes(saved)
      ? saved
      : (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    applyTheme(theme);

    document.querySelectorAll('.swatch').forEach((s) => {
      s.addEventListener('click', () => applyTheme(s.dataset.theme));
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
