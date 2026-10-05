/* Small helpers shared by the engine's modules. */

export const $ = (id) => document.getElementById(id);
export const fmt = (n) => n.toFixed(2).replace(/\.?0+$/, '');

export function hideLoader() {
  const l = $('app-loading');
  if (!l) return;
  l.classList.add('hidden');
  setTimeout(() => l.remove(), 320);
}
