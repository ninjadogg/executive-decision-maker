// Pick the month's backdrop theme (or ?theme=name) before anything renders, so
// the loading screen and overlays match. Loaded as a blocking script in <head>.
(() => {
  const byMonth = { 9: 'halloween' };
  const known = ['studio', 'halloween'];
  const asked = new URLSearchParams(location.search).get('theme');
  window.__theme = known.includes(asked) ? asked : byMonth[new Date().getMonth()] || 'studio';
  document.documentElement.dataset.theme = window.__theme;
})();
