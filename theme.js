// Apply the saved preference before the page is painted; default to charcoal.
(() => {
  const root = document.documentElement;
  let preference = 'dark';
  try {
    const saved = localStorage.getItem('portfolio-theme');
    if (saved === 'light' || saved === 'dark') preference = saved;
  } catch (_) { /* The theme still works when browser storage is unavailable. */ }
  root.dataset.theme = preference;
  document.addEventListener('DOMContentLoaded', () => {
    const toggle = document.querySelector('.theme-toggle');
    if (!toggle) return;
    const updateLabel = () => {
      const dark = root.dataset.theme === 'dark';
      toggle.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
      toggle.title = toggle.getAttribute('aria-label');
    };
    toggle.hidden = false;
    updateLabel();
    toggle.addEventListener('click', () => {
      root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem('portfolio-theme', root.dataset.theme); } catch (_) {}
      updateLabel();
    });
  });
})();
