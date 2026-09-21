/* Entry: with a project in the address, load the viewer; without one,
   the launcher — organizations, and their projects. */

import { route, registry } from './load.js';
import { $, hideLoader } from './util.js';
import { t } from './i18n.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function launcher() {
  const el = $('launcher');
  el.hidden = false;
  for (const n of el.querySelectorAll('[data-i18n]')) n.textContent = t(n.dataset.i18n);
  document.body.classList.add('is-launcher');
  let orgs = [];
  try { orgs = await registry(); } catch (err) { $('launcher-list').innerHTML = `<p class="launch-empty">${esc(t('The project list could not be loaded.'))}</p>`; hideLoader(); return; }
  let recent = [];
  try { recent = JSON.parse(localStorage.getItem('wire-recent') || '[]'); } catch (err) { /* private mode */ }
  const card = (org, p) => `
    <a class="launch-card" href="#/${esc(org.slug)}/${esc(p.slug)}" style="--c: ${esc(org.color || '#8fd8ff')}">
      <span class="launch-name">${esc(p.name)}</span>
      <span class="launch-site">${esc(p.site || '')}</span>
      <span class="launch-summary">${esc(p.summary || '')}</span>
      ${p.status ? `<span class="launch-status">${esc(p.status)}</span>` : ''}
    </a>`;
  const byAddr = new Map();
  for (const org of orgs) for (const p of org.projects) byAddr.set(`${org.slug}/${p.slug}`, { org, p });
  const recentCards = recent.map((a) => byAddr.get(a)).filter(Boolean).map(({ org, p }) => card(org, p)).join('');
  $('launcher-list').innerHTML = (recentCards ? `<section class="launch-org"><h2>${esc(t('Recent'))}</h2><div class="launch-cards">${recentCards}</div></section>` : '')
    + orgs.map((org) => `
    <section class="launch-org" style="--c: ${esc(org.color || '#8fd8ff')}">
      <h2><i></i>${esc(org.name)}</h2>
      ${org.projects.length ? `<div class="launch-cards">${org.projects.map((p) => card(org, p)).join('')}</div>` : `<p class="launch-empty">${esc(t('No projects yet.'))}</p>`}
    </section>`).join('');
  $('launch-quit').addEventListener('click', () => {
    if (window.self !== window.top) window.parent.postMessage({ type: 'close-game' }, '*');
    else window.location.href = '../../';
  });
  hideLoader();
}

const r = route();
if (r) {
  try { recentPush(`${r.org}/${r.slug}`); } catch (err) { /* private mode */ }
  import('./viewer.js').catch((err) => {
    console.error(err);
    $('fail').textContent = `${t('This project could not be loaded.')} ${err.message}`;
    $('fail').hidden = false;
    hideLoader();
  });
} else {
  launcher();
}
/* Changing project means starting over: the viewer holds one scene. */
window.addEventListener('hashchange', () => location.reload());

function recentPush(addr) {
  const list = JSON.parse(localStorage.getItem('wire-recent') || '[]').filter((a) => a !== addr);
  list.unshift(addr);
  localStorage.setItem('wire-recent', JSON.stringify(list.slice(0, 6)));
}
