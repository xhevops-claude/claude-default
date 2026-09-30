/* Loading: the address names an organization and a project; the
   registries say what exists; a project is a folder of JSON under
   projects/<org>/<slug>/ — scene.json for what is there, and the assets
   it names (the relief as a height field) beside it. Nothing here is
   code from a project: projects are data. */

export const ROOT = new URL('../../projects/', import.meta.url);

/* #/org/slug → { org, slug }, or null for the launcher. */
export function route() {
  const m = location.hash.match(/^#\/([\w-]+)\/([\w-]+)\/?$/);
  return m ? { org: m[1], slug: m[2] } : null;
}

export async function fetchJSON(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

/* Every organization with its projects, for the launcher. */
export async function registry() {
  const { organizations } = await fetchJSON(new URL('index.json', ROOT));
  return Promise.all(organizations.map(async (org) => {
    let projects = [];
    try { ({ projects } = await fetchJSON(new URL(`${org.slug}/index.json`, ROOT))); } catch (err) { /* an org with nothing yet */ }
    return { ...org, projects };
  }));
}

/* The routed project: its scene and its relief, and where it lives. */
export async function loadCurrent() {
  const r = route();
  if (!r) throw new Error('no project in the address');
  const base = new URL(`${r.org}/${r.slug}/`, ROOT);
  const scene = await fetchJSON(new URL('scene.json', base));
  const relief = scene.assets?.relief ? await fetchJSON(new URL(scene.assets.relief, base)) : null;
  return {
    PLAN: scene,
    RELIEF: relief,
    PROJECT: { ...r, base, tracker: scene.tracker ? new URL(scene.tracker, base).href : null },
  };
}
