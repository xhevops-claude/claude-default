(function () {
  'use strict';

  // Data comes live from open, keyless APIs:
  //  - Wikidata Query Service (SPARQL) for search, film facts, cast, sagas,
  //    people (actors / producers / directors) and their filmographies
  //  - Wikipedia for posters (pageimages) and plot summaries (REST)
  //
  // Model: the Explore POOL holds sources — a person, a single film, or a
  // saga. Each source resolves to a list of films (cached in localStorage);
  // Explore aggregates every enabled source into one chronological marathon.
  const SPARQL = 'https://query.wikidata.org/sparql';
  const WP_API = 'https://en.wikipedia.org/w/api.php';
  const WP_REST = 'https://en.wikipedia.org/api/rest_v1/page/summary/';

  const LS = {
    pool: 'marathon-pool',
    srcCache: 'marathon-srccache',
    watched: 'marathon-watched',
    showWatched: 'marathon-showwatched',
    sort: 'marathon-sort',
    group: 'marathon-group',
    tab: 'marathon-tab',
    hideSrcs: 'marathon-hidesrcs',
    cutoff: 'marathon-cutoff',
    filtersOpen: 'marathon-filters-open',
    oldList: 'marathon-list',          // v1 storage, migrated on boot
  };

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function load(key, fallback) {
    try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); }
    catch (e) { return fallback; }
  }
  function save(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {} }

  // ---- persisted state ----
  // pool entries: {qid, type:'person'|'film'|'saga'|'auto', name, img, article,
  //                year?, ymd?, poster?}  (film extras inline)
  let pool = load(LS.pool, []);
  // srcCache: source qid -> [{qid,title,year,ymd,poster,article,role}]
  let srcCache = load(LS.srcCache, {});
  let watched = new Set(load(LS.watched, []));
  let showWatched = load(LS.showWatched, true);
  let sortBy = load(LS.sort, 'old');       // 'old' | 'new'
  let groupBy = load(LS.group, 'none');    // 'none' | 'source' | 'year'
  if (groupBy === 'saga') groupBy = 'source';
  let hiddenSrcs = new Set(load(LS.hideSrcs, []));
  const savedCut = load(LS.cutoff, null);
  let cutoff = (savedCut && typeof savedCut.y === 'number') ? savedCut : todayYMD();
  let filtersOpen = load(LS.filtersOpen, false);

  // v1 -> v2 migration: individual films become film sources; collections
  // (sagas or people) become 'auto' sources that resolve on first fetch.
  (function migrate() {
    const old = load(LS.oldList, null);
    if (!old || !Array.isArray(old) || pool.length) {
      if (old) try { localStorage.removeItem(LS.oldList); } catch (e) {}
      return;
    }
    const seen = new Set();
    old.forEach((m) => {
      if (m.colQ) {
        if (!seen.has(m.colQ)) {
          seen.add(m.colQ);
          pool.push({ qid: m.colQ, type: 'auto', name: m.colName || 'Collection', img: null, article: null });
        }
      } else if (!seen.has(m.qid)) {
        seen.add(m.qid);
        pool.push({ qid: m.qid, type: 'film', name: m.title, img: null, article: m.article || null,
          year: m.year || null, ymd: m.ymd || null, poster: m.poster || null });
      }
    });
    save(LS.pool, pool);
    try { localStorage.removeItem(LS.oldList); } catch (e) {}
  })();

  let tab = load(LS.tab, null);
  if (['people', 'movies', 'explore'].indexOf(tab) < 0) tab = pool.length ? 'explore' : 'movies';

  // ---- runtime state ----
  const search = {
    person: { results: [], seq: 0, abort: null },
    film: { results: [], seq: 0, abort: null },
  };
  const loadingSrcs = new Set();
  const collapsed = new Set();
  const posterCache = {};      // article title -> thumb url ('' = tried, none)
  let detail = null;           // open modal: {kind:'film'|'person', qid, ...}
  let yearRange = [];

  // ---- elements ----
  const $ = (id) => document.getElementById(id);
  const tabsEl = $('tabs'), poolCount = $('pool-count'), poolChips = $('pool-chips');
  const views = { people: $('view-people'), movies: $('view-movies'), explore: $('view-explore') };
  const ui = {
    person: { input: $('p-search-input'), clear: $('p-search-clear'), hint: $('p-hint'),
      results: $('p-results'), status: $('p-status'), msg: $('p-msg'), action: $('p-action') },
    film: { input: $('m-search-input'), clear: $('m-search-clear'), hint: $('m-hint'),
      results: $('m-results'), status: $('m-status'), msg: $('m-msg'), action: $('m-action') },
  };
  const fltEl = $('flt'), fltToggle = $('flt-toggle'), fltBody = $('flt-body'), fltSummary = $('flt-summary');
  const srcSwitches = $('src-switches'), srcAllBtn = $('src-all'), srcNoneBtn = $('src-none');
  const fltReset = $('flt-reset'), showWatchedChk = $('show-watched'), clearWatchedBtn = $('clear-watched');
  const fYear = $('f-year'), fMonth = $('f-month'), fDay = $('f-day');
  const yrValue = $('yr-value'), moValue = $('mo-value'), dyValue = $('dy-value');
  const exploreToolbar = $('explore-toolbar'), selSort = $('sel-sort'), selGroup = $('sel-group');
  const progressEl = $('progress'), progressFill = $('progress-fill'), progressText = $('progress-text');
  const upnextEl = $('upnext'), upnextPoster = $('upnext-poster'), upnextTitle = $('upnext-title'), upnextSub = $('upnext-sub');
  const sectionsEl = $('sections');
  const xStatus = $('x-status'), xMsg = $('x-msg'), xAction = $('x-action');
  const detailModal = $('detail-modal'), detailCard = $('detail-card'), detailClose = $('detail-close');
  const detailPoster = $('detail-poster'), detailTitle = $('detail-title'), detailSub = $('detail-sub');
  const detailFacts = $('detail-facts'), detailActions = $('detail-actions'), detailPlot = $('detail-plot');
  const detailSaga = $('detail-saga'), detailFilmo = $('detail-filmo');
  const castHead = $('cast-head'), castGrid = $('cast-grid'), detailLinks = $('detail-links');
  const quitBtn = $('quit');

  function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ---------------------------------------------------------------------------
  // Remote data
  // ---------------------------------------------------------------------------
  async function sparql(query, signal) {
    const res = await fetch(SPARQL + '?format=json&query=' + encodeURIComponent(query), {
      signal: signal,
      headers: { Accept: 'application/sparql-results+json' },
    });
    if (!res.ok) throw new Error('sparql ' + res.status);
    return (await res.json()).results.bindings;
  }
  function sparqlStr(s) { return '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'; }
  function qidOf(iri) { const m = /Q\d+$/.exec(iri || ''); return m ? m[0] : null; }
  function articleOf(iri) {
    if (!iri) return null;
    const i = iri.indexOf('/wiki/');
    if (i < 0) return null;
    try { return decodeURIComponent(iri.slice(i + 6)).replace(/_/g, ' '); } catch (e) { return null; }
  }
  function parseWDate(iso) {
    // e.g. "1999-03-31T00:00:00Z" — year-precision dates come through as Jan 1.
    const m = /^(-?\d+)-(\d\d)-(\d\d)/.exec(iso || '');
    if (!m) return null;
    const y = +m[1], mo = +m[2] || 1, d = +m[3] || 1;
    return { y: y, m: mo, d: d, ymd: y * 10000 + mo * 100 + d };
  }
  function httpsize(url) { return String(url || '').replace(/^http:\/\//, 'https://'); }

  // People qualify by occupation: actor, film/stage/TV/voice actor,
  // film producer, film director, screenwriter.
  const PERSON_OCCS = 'wd:Q33999 wd:Q10800557 wd:Q2259451 wd:Q10798782 wd:Q2405480 wd:Q3282637 wd:Q2526255 wd:Q28389';

  // kind: 'film' | 'person' — one EntitySearch, filtered to that kind.
  async function searchKind(term, kind, signal) {
    const typeBlock = kind === 'person'
      ? '  ?item wdt:P31 wd:Q5. VALUES ?occ { ' + PERSON_OCCS + ' }\n  ?item wdt:P106 ?occ.\n'
      : '  ?item wdt:P31/wdt:P279* wd:Q11424.\n';
    const q =
      'SELECT ?item ?itemLabel ?date ?article ?img ?occ ?occLabel WHERE {\n' +
      '  SERVICE wikibase:mwapi {\n' +
      '    bd:serviceParam wikibase:endpoint "www.wikidata.org";\n' +
      '                    wikibase:api "EntitySearch";\n' +
      '                    mwapi:search ' + sparqlStr(term) + ';\n' +
      '                    mwapi:language "en";\n' +
      '                    mwapi:limit "30".\n' +
      '    ?item wikibase:apiOutputItem mwapi:item.\n' +
      '    ?num wikibase:apiOrdinal true.\n' +
      '  }\n' +
      typeBlock +
      '  OPTIONAL { ?item wdt:P577 ?date. }\n' +
      '  OPTIONAL { ?item wdt:P18 ?img. }\n' +
      '  OPTIONAL { ?article schema:about ?item; schema:isPartOf <https://en.wikipedia.org/>. }\n' +
      '  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,mul". }\n' +
      '} ORDER BY ASC(?num)';
    const rows = await sparql(q, signal);
    const map = new Map();
    rows.forEach((r) => {
      const qid = qidOf(r.item && r.item.value);
      if (!qid) return;
      if (!map.has(qid)) {
        map.set(qid, {
          kind: kind, qid: qid,
          title: (r.itemLabel && r.itemLabel.value) || qid,
          ymd: null, year: null,
          article: articleOf(r.article && r.article.value),
          poster: null, occs: new Set(),
        });
      }
      const it = map.get(qid);
      const dt = parseWDate(r.date && r.date.value);
      if (dt && (it.ymd == null || dt.ymd < it.ymd)) { it.ymd = dt.ymd; it.year = dt.y; }
      if (!it.article) it.article = articleOf(r.article && r.article.value);
      if (kind === 'person' && r.img && !it.poster) it.poster = httpsize(r.img.value) + '?width=240';
      if (kind === 'person' && r.occLabel && r.occLabel.value) it.occs.add(r.occLabel.value);
    });
    return Array.from(map.values()).map((it) => {
      it.occText = Array.from(it.occs).slice(0, 2).join(' · ');
      delete it.occs;
      return it;
    });
  }

  // Batch-resolve Wikipedia lead images (film posters) for a set of articles.
  async function fetchPosters(titles) {
    const need = Array.from(new Set(titles.filter((t) => t && posterCache[t] === undefined)));
    for (let i = 0; i < need.length; i += 50) {
      const chunk = need.slice(i, i + 50);
      try {
        const url = WP_API + '?action=query&format=json&origin=*&redirects=1'
          + '&prop=pageimages&piprop=thumbnail&pithumbsize=360'
          + '&titles=' + encodeURIComponent(chunk.join('|'));
        const res = await fetch(url);
        if (!res.ok) continue;
        const data = await res.json();
        const q = data.query || {};
        // Map requested title -> final title through normalization + redirects.
        const fwd = {};
        chunk.forEach((t) => { fwd[t] = t; });
        (q.normalized || []).concat(q.redirects || []).forEach((r) => {
          Object.keys(fwd).forEach((k) => { if (fwd[k] === r.from) fwd[k] = r.to; });
        });
        const byTitle = {};
        Object.keys(q.pages || {}).forEach((pid) => {
          const p = q.pages[pid];
          byTitle[p.title] = (p.thumbnail && p.thumbnail.source) || '';
        });
        chunk.forEach((t) => { posterCache[t] = byTitle[fwd[t]] || ''; });
      } catch (e) {
        chunk.forEach((t) => { if (posterCache[t] === undefined) posterCache[t] = ''; });
      }
    }
  }

  async function fetchFilmFacts(qid) {
    const F = 'wd:' + qid;
    const q =
      'SELECT ?date ?runtime ?imdb ?series ?seriesLabel ?dir ?dirLabel ?genre ?genreLabel ?article WHERE {\n' +
      '  OPTIONAL { ' + F + ' wdt:P577 ?date. }\n' +
      '  OPTIONAL { ' + F + ' wdt:P2047 ?runtime. }\n' +
      '  OPTIONAL { ' + F + ' wdt:P345 ?imdb. }\n' +
      '  OPTIONAL { ' + F + ' wdt:P179 ?series. }\n' +
      '  OPTIONAL { ' + F + ' wdt:P57 ?dir. }\n' +
      '  OPTIONAL { ' + F + ' wdt:P136 ?genre. }\n' +
      '  OPTIONAL { ?article schema:about ' + F + '; schema:isPartOf <https://en.wikipedia.org/>. }\n' +
      '  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }\n' +
      '} LIMIT 400';
    const rows = await sparql(q);
    const facts = { ymd: null, year: null, runtime: null, imdb: null, seriesQ: null, seriesName: null,
      directors: [], genres: [], article: null };
    const dirs = new Set(), genres = new Set();
    rows.forEach((r) => {
      const dt = parseWDate(r.date && r.date.value);
      if (dt && (facts.ymd == null || dt.ymd < facts.ymd)) { facts.ymd = dt.ymd; facts.year = dt.y; }
      if (r.runtime && facts.runtime == null) facts.runtime = Math.round(+r.runtime.value);
      if (r.imdb && !facts.imdb) facts.imdb = r.imdb.value;
      if (r.series && !facts.seriesQ) {
        facts.seriesQ = qidOf(r.series.value);
        facts.seriesName = (r.seriesLabel && r.seriesLabel.value) || null;
      }
      if (r.dirLabel && r.dirLabel.value) dirs.add(r.dirLabel.value);
      if (r.genreLabel && r.genreLabel.value) genres.add(r.genreLabel.value);
      if (!facts.article) facts.article = articleOf(r.article && r.article.value);
    });
    facts.directors = Array.from(dirs);
    facts.genres = Array.from(genres).slice(0, 5);
    return facts;
  }

  async function fetchCast(qid) {
    const F = 'wd:' + qid;
    const q =
      'SELECT ?actor ?actorLabel ?char ?charLabel ?img WHERE {\n' +
      '  { ' + F + ' p:P161 ?st. ?st ps:P161 ?actor. }\n' +
      '  UNION { ' + F + ' p:P725 ?st. ?st ps:P725 ?actor. }\n' +
      '  OPTIONAL { ?st pq:P453 ?char. }\n' +
      '  OPTIONAL { ?actor wdt:P18 ?img. }\n' +
      '  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }\n' +
      '} LIMIT 80';
    const rows = await sparql(q);
    const map = new Map();
    rows.forEach((r) => {
      const aq = qidOf(r.actor && r.actor.value);
      if (!aq) return;
      if (!map.has(aq)) {
        map.set(aq, {
          qid: aq,
          name: (r.actorLabel && r.actorLabel.value) || aq,
          img: r.img ? httpsize(r.img.value) + '?width=160' : null,
          roles: new Set(),
        });
      }
      if (r.charLabel && r.charLabel.value && !/^Q\d+$/.test(r.charLabel.value)) {
        map.get(aq).roles.add(r.charLabel.value);
      }
    });
    return Array.from(map.values()).slice(0, 30).map((c) => ({
      qid: c.qid, name: c.name, img: c.img, role: Array.from(c.roles).slice(0, 2).join(' / '),
    }));
  }

  async function fetchSummary(article) {
    if (!article) return null;
    try {
      const res = await fetch(WP_REST + encodeURIComponent(article.replace(/ /g, '_')));
      if (!res.ok) return null;
      return await res.json();
    } catch (e) { return null; }
  }

  async function fetchSaga(seriesQ) {
    const q =
      'SELECT ?film ?filmLabel (MIN(?d) AS ?date) (SAMPLE(?art) AS ?article) WHERE {\n' +
      '  ?film wdt:P179 wd:' + seriesQ + '.\n' +
      '  ?film wdt:P31/wdt:P279* wd:Q11424.\n' +
      '  OPTIONAL { ?film wdt:P577 ?d. }\n' +
      '  OPTIONAL { ?art schema:about ?film; schema:isPartOf <https://en.wikipedia.org/>. }\n' +
      '  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }\n' +
      '} GROUP BY ?film ?filmLabel ORDER BY ?date';
    const rows = await sparql(q);
    return rows.map(sagaRow).filter(Boolean);
  }
  function sagaRow(r) {
    const qid = qidOf(r.film && r.film.value);
    if (!qid) return null;
    const dt = parseWDate(r.date && r.date.value);
    return {
      qid: qid,
      title: (r.filmLabel && r.filmLabel.value) || qid,
      ymd: dt ? dt.ymd : null, year: dt ? dt.y : null,
      article: articleOf(r.article && r.article.value),
      poster: null,
    };
  }

  const ROLE_LABELS = { P161: 'Acted', P725: 'Voice', P57: 'Directed', P162: 'Produced' };
  async function fetchFilmography(personQ) {
    const q =
      'SELECT ?film ?filmLabel (MIN(?d) AS ?date) (SAMPLE(?art) AS ?article)\n' +
      '       (GROUP_CONCAT(DISTINCT STR(?p); separator=",") AS ?props) WHERE {\n' +
      '  VALUES ?p { wdt:P161 wdt:P725 wdt:P57 wdt:P162 }\n' +
      '  ?film ?p wd:' + personQ + '.\n' +
      '  ?film wdt:P31/wdt:P279* wd:Q11424.\n' +
      '  OPTIONAL { ?film wdt:P577 ?d. }\n' +
      '  OPTIONAL { ?art schema:about ?film; schema:isPartOf <https://en.wikipedia.org/>. }\n' +
      '  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }\n' +
      '} GROUP BY ?film ?filmLabel ORDER BY ?date LIMIT 300';
    const rows = await sparql(q);
    return rows.map((r) => {
      const f = sagaRow(r);
      if (!f) return null;
      const props = ((r.props && r.props.value) || '').split(',');
      const roles = [];
      Object.keys(ROLE_LABELS).forEach((p) => {
        if (props.some((x) => x.endsWith('/' + p))) roles.push(ROLE_LABELS[p]);
      });
      f.role = roles.join(' · ');
      return f;
    }).filter(Boolean);
  }

  // ---------------------------------------------------------------------------
  // Formatting
  // ---------------------------------------------------------------------------
  function fmtRuntime(min) {
    if (!min) return '';
    const h = Math.floor(min / 60), m = min % 60;
    return h ? h + 'h ' + (m ? m + 'm' : '') : m + 'm';
  }
  function posterHTML(url, title, cls, fallbackIcon) {
    if (url) return '<img class="' + cls + '" loading="lazy" src="' + escapeHTML(url) + '" alt="" />';
    return '<span class="' + cls + ' poster-fallback" aria-hidden="true">' + (fallbackIcon || '🎬') + '</span>';
  }
  function todayYMD() { const t = new Date(); return { y: t.getFullYear(), m: t.getMonth() + 1, d: t.getDate() }; }
  function daysInMonth(y, m) { return new Date(y, m, 0).getDate(); }
  const SRC_ICON = { person: '👤', film: '🎬', saga: '🎞', auto: '🎞' };

  // ---------------------------------------------------------------------------
  // Pool (sources)
  // ---------------------------------------------------------------------------
  function inPool(qid) { return pool.some((s) => s.qid === qid); }
  function persistPool() { save(LS.pool, pool); poolCount.textContent = String(pool.length); }
  function persistCache() { save(LS.srcCache, srcCache); }

  function addPersonSource(p) {
    if (inPool(p.qid)) return;
    pool.push({ qid: p.qid, type: 'person', name: p.title || p.name, img: p.poster || p.img || null, article: p.article || null });
    persistPool();
    ensureSources();
    renderPool();
  }
  function addFilmSource(m) {
    if (inPool(m.qid)) return;
    pool.push({ qid: m.qid, type: 'film', name: m.title, img: null, article: m.article || null,
      year: m.year || null, ymd: m.ymd || null, poster: m.poster || null });
    persistPool();
    backfillFilm(m.qid);
    renderPool();
  }
  function addSagaSource(seriesQ, name) {
    if (inPool(seriesQ)) return;
    pool.push({ qid: seriesQ, type: 'saga', name: name || 'Saga', img: null, article: null });
    persistPool();
    ensureSources();
    renderPool();
  }
  function removeSource(qid) {
    pool = pool.filter((s) => s.qid !== qid);
    delete srcCache[qid];
    hiddenSrcs.delete(qid);
    persistPool(); persistCache(); save(LS.hideSrcs, Array.from(hiddenSrcs));
    renderPool();
    renderAll();
  }
  // Fill date/poster for film sources added straight from search results.
  async function backfillFilm(qid) {
    const src = pool.find((s) => s.qid === qid && s.type === 'film');
    if (!src) return;
    try {
      if (!src.ymd || !src.article) {
        const f = await fetchFilmFacts(qid);
        const cur = pool.find((s) => s.qid === qid);
        if (!cur) return;
        if (f.ymd && !cur.ymd) { cur.ymd = f.ymd; cur.year = f.year; }
        if (f.article && !cur.article) cur.article = f.article;
      }
      const cur = pool.find((s) => s.qid === qid);
      if (cur && !cur.poster && cur.article) {
        await fetchPosters([cur.article]);
        cur.poster = posterCache[cur.article] || null;
      }
      persistPool();
      renderAll();
    } catch (e) { /* stays sparse; still usable */ }
  }

  // Resolve movies for every source that has none cached yet.
  function ensureSources() {
    pool.forEach((src) => {
      if (src.type === 'film') return;
      if (srcCache[src.qid] || loadingSrcs.has(src.qid)) return;
      loadingSrcs.add(src.qid);
      resolveSource(src).then((films) => {
        loadingSrcs.delete(src.qid);
        if (films) { srcCache[src.qid] = films; persistCache(); }
        renderAll();
      });
    });
  }
  async function resolveSource(src) {
    try {
      let films = null;
      if (src.type === 'person') films = await fetchFilmography(src.qid);
      else if (src.type === 'saga') films = await fetchSaga(src.qid);
      else { // 'auto' (migrated): saga first, else filmography
        films = await fetchSaga(src.qid);
        if (!films.length) films = await fetchFilmography(src.qid);
      }
      await fetchPosters(films.map((f) => f.article));
      films.forEach((f) => { if (f.article) f.poster = posterCache[f.article] || null; });
      return films;
    } catch (e) { return null; }
  }
  function sourceFilms(src) {
    if (src.type === 'film') {
      return [{ qid: src.qid, title: src.name, year: src.year || null, ymd: src.ymd || null,
        poster: src.poster || null, article: src.article || null, role: '' }];
    }
    return srcCache[src.qid] || null;
  }

  // ---------------------------------------------------------------------------
  // Explore aggregation
  // ---------------------------------------------------------------------------
  function exploreMovies() {
    const map = new Map();
    pool.forEach((src) => {
      if (hiddenSrcs.has(src.qid)) return;
      const films = sourceFilms(src);
      if (!films) return;
      films.forEach((f) => {
        if (!map.has(f.qid)) map.set(f.qid, {
          qid: f.qid, title: f.title, year: f.year, ymd: f.ymd,
          poster: f.poster, article: f.article, role: f.role || '', srcs: [src],
        });
        else map.get(f.qid).srcs.push(src);
      });
    });
    return Array.from(map.values());
  }
  function cutoffInt() {
    const d = Math.min(cutoff.d, daysInMonth(cutoff.y, cutoff.m));
    return cutoff.y * 10000 + cutoff.m * 100 + d;
  }
  function filteredMovies() {
    const cut = cutoffInt();
    return exploreMovies().filter((m) => m.ymd == null || m.ymd <= cut);
  }
  function sortMovies(arr) {
    const a = arr.slice();
    const dir = sortBy === 'new' ? -1 : 1;
    a.sort((x, y) => {
      const xy = x.ymd == null ? 99999999 : x.ymd;
      const yy = y.ymd == null ? 99999999 : y.ymd;
      return (xy - yy) * dir || (x.title < y.title ? -1 : 1);
    });
    return a;
  }
  function nextUnwatched(arr) {
    const dir = sortBy;
    sortBy = 'old';
    const order = sortMovies(arr);
    sortBy = dir;
    return order.find((m) => !watched.has(m.qid)) || null;
  }
  function buildGroups(arr) {
    const map = new Map();
    arr.forEach((m) => {
      let key, title;
      if (groupBy === 'source') { const s = m.srcs[0]; key = s.qid; title = s.name; }
      else { const y = m.year || 0; key = 'y:' + y; title = y ? String(y) : 'Undated'; }
      if (!map.has(key)) map.set(key, { key: key, title: title, first: m.ymd || 99999999, movies: [] });
      const g = map.get(key);
      g.movies.push(m);
      if (m.ymd && m.ymd < g.first) g.first = m.ymd;
    });
    const groups = Array.from(map.values());
    const dir = sortBy === 'new' ? -1 : 1;
    groups.sort((a, b) => (a.first - b.first) * dir);
    return groups;
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  function render() {
    Array.prototype.forEach.call(tabsEl.querySelectorAll('.seg-btn'), (b) => {
      b.setAttribute('aria-selected', String(b.getAttribute('data-tab') === tab));
    });
    poolCount.textContent = String(pool.length);
    Object.keys(views).forEach((k) => { views[k].hidden = k !== tab; });
    renderPool();
    if (tab === 'explore') renderExplore();
    else renderSearch(tab === 'people' ? 'person' : 'film');
  }
  function renderAll() { renderPool(); if (tab === 'explore') renderExplore(); }

  function showStatus(u, icon, msg, actionLabel, actionFn) {
    u.status.hidden = false;
    u.status.querySelector('.status-icon').textContent = icon;
    u.msg.textContent = msg;
    if (actionLabel) { u.action.hidden = false; u.action.textContent = actionLabel; u.action.onclick = actionFn || null; }
    else { u.action.hidden = true; u.action.onclick = null; }
  }

  // ---- pool bar ----
  function renderPool() {
    poolCount.textContent = String(pool.length);
    if (!pool.length) {
      poolChips.innerHTML = '<span class="pool-empty">Empty — add people or movies and they become your marathon sources.</span>';
      return;
    }
    const solo = pool.length > 1 && pool.filter((s) => !hiddenSrcs.has(s.qid)).length === 1
      ? pool.find((s) => !hiddenSrcs.has(s.qid)).qid : null;
    poolChips.innerHTML = pool.map((s) => {
      const off = hiddenSrcs.has(s.qid);
      const img = s.type === 'person' ? s.img : s.poster;
      return '<span class="pool-chip' + (off ? ' off' : '') + (solo === s.qid ? ' solo' : '') + '" data-src="' + escapeHTML(s.qid) + '">'
        + '<span class="chip-ava' + (s.type === 'person' ? ' round' : '') + '">'
        + (img ? '<img src="' + escapeHTML(img) + '" alt="" loading="lazy" />' : SRC_ICON[s.type] || '🎬')
        + '</span>'
        + '<span class="chip-name">' + escapeHTML(s.name) + '</span>'
        + '<button class="chip-x" type="button" data-rm="' + escapeHTML(s.qid) + '" aria-label="Remove from pool">×</button>'
        + '</span>';
    }).join('');
  }

  // ---- search screens ----
  function renderSearch(kind) {
    const u = ui[kind];
    const st = search[kind];
    const term = u.input.value.trim();
    u.clear.hidden = !term;
    if (!term) {
      u.results.innerHTML = '';
      u.hint.hidden = false;
      u.status.hidden = true;
      return;
    }
    u.hint.hidden = true;
    if (!st.results.length) return; // status panel handles empty/loading
    u.status.hidden = true;
    u.results.innerHTML = st.results.map((m) => {
      const added = inPool(m.qid);
      if (kind === 'person') {
        return '<div class="rcard person" data-open="' + escapeHTML(m.qid) + '">'
          + '<div class="rposter round">' + posterHTML(m.poster, m.title, 'rposter-img', '👤') + '</div>'
          + '<div class="rmeta"><div class="rtitle">' + escapeHTML(m.title) + '</div>'
          + '<div class="rsub">' + escapeHTML(m.occText || 'Filmography') + '</div></div>'
          + '<button class="radd' + (added ? ' added' : '') + '" type="button" data-add="' + escapeHTML(m.qid) + '"'
          + ' aria-label="' + (added ? 'In the pool' : 'Add to Explore pool') + '">' + (added ? '✓' : '＋') + '</button>'
          + '</div>';
      }
      return '<div class="rcard" data-open="' + escapeHTML(m.qid) + '">'
        + '<div class="rposter">' + posterHTML(m.poster, m.title, 'rposter-img') + '</div>'
        + '<div class="rmeta"><div class="rtitle">' + escapeHTML(m.title) + '</div>'
        + '<div class="rsub">' + (m.year || '—') + '</div></div>'
        + '<button class="radd' + (added ? ' added' : '') + '" type="button" data-add="' + escapeHTML(m.qid) + '"'
        + ' aria-label="' + (added ? 'In the pool' : 'Add to Explore pool') + '">' + (added ? '✓' : '＋') + '</button>'
        + '</div>';
    }).join('');
  }

  const debounce = (fn, ms) => {
    let t = null;
    return function () { clearTimeout(t); t = setTimeout(fn, ms); };
  };

  async function runSearch(kind) {
    const u = ui[kind], st = search[kind];
    const term = u.input.value.trim();
    st.results = [];
    renderSearch(kind);
    if (!term) return;
    const seq = ++st.seq;
    if (st.abort) st.abort.abort();
    st.abort = new AbortController();
    showStatus(u, '🔎', kind === 'person' ? 'Searching film people…' : 'Searching every film ever made…', null);
    u.results.innerHTML = '';
    let found;
    try {
      found = await searchKind(term, kind, st.abort.signal);
    } catch (e) {
      if (e && e.name === 'AbortError') return;
      if (seq !== st.seq) return;
      showStatus(u, '📡', 'Couldn’t reach the database. Check your connection and retry.', 'Retry', () => runSearch(kind));
      return;
    }
    if (seq !== st.seq) return;
    if (!found.length) {
      showStatus(u, '🕵️', 'Nothing matched “' + term + '”. Try the original title or full name.', null);
      return;
    }
    st.results = found;
    renderSearch(kind);
    if (kind === 'film') {
      await fetchPosters(found.map((m) => m.article));
      if (seq !== st.seq) return;
      st.results.forEach((m) => {
        if (m.article && !m.poster) m.poster = posterCache[m.article] || null;
      });
      renderSearch(kind);
    }
  }

  // ---- filters ----
  function renderFilters() {
    const rows = srcSwitches.querySelectorAll('.col-switch');
    const sig = pool.map((s) => s.qid).join('|');
    if (srcSwitches.dataset.sig !== sig || rows.length !== pool.length) {
      srcSwitches.dataset.sig = sig;
      srcSwitches.innerHTML = '';
      pool.forEach((s) => {
        const row = document.createElement('label');
        row.className = 'switch col-switch';
        row.innerHTML =
          '<input type="checkbox" class="switch-input"' + (hiddenSrcs.has(s.qid) ? '' : ' checked') + ' />'
          + '<span class="switch-track" aria-hidden="true"></span>'
          + '<span class="switch-text">' + escapeHTML(s.name)
          + ' <span class="col-n" data-n="' + escapeHTML(s.qid) + '"></span></span>';
        row.querySelector('input').addEventListener('change', () => toggleSrc(s.qid));
        srcSwitches.appendChild(row);
      });
    } else {
      pool.forEach((s, i) => { rows[i].querySelector('input').checked = !hiddenSrcs.has(s.qid); });
    }
    pool.forEach((s) => {
      const n = srcSwitches.querySelector('[data-n="' + s.qid + '"]');
      if (!n) return;
      const films = sourceFilms(s);
      n.textContent = films ? String(films.length) : (loadingSrcs.has(s.qid) ? '…' : '?');
    });

    // Date sliders.
    const years = [];
    exploreMovies().forEach((m) => { if (m.year && years.indexOf(m.year) < 0) years.push(m.year); });
    years.sort((a, b) => a - b);
    const curY = new Date().getFullYear();
    const minY = years.length ? years[0] : curY;
    const maxY = Math.max(curY, years.length ? years[years.length - 1] : curY);
    yearRange = [];
    for (let y = minY; y <= maxY; y++) yearRange.push(y);
    cutoff.y = Math.min(Math.max(cutoff.y, minY), maxY);
    fYear.max = String(yearRange.length - 1);
    fYear.value = String(yearRange.indexOf(cutoff.y));
    yrValue.textContent = String(cutoff.y);
    cutoff.m = Math.min(Math.max(cutoff.m, 1), 12);
    fMonth.value = String(cutoff.m);
    moValue.textContent = MONTHS[cutoff.m - 1];
    cutoff.d = Math.min(Math.max(cutoff.d, 1), daysInMonth(cutoff.y, cutoff.m));
    fDay.value = String(cutoff.d);
    dyValue.textContent = String(cutoff.d);

    const shown = pool.filter((s) => !hiddenSrcs.has(s.qid)).length;
    const t = todayYMD();
    const isToday = cutoff.y === t.y && cutoff.m === t.m && cutoff.d === t.d;
    const upto = isToday ? 'today' : cutoff.d + ' ' + MONTHS[cutoff.m - 1] + ' ' + cutoff.y;
    fltSummary.textContent = shown + '/' + pool.length + ' sources · up to ' + upto;
    fltBody.hidden = !filtersOpen;
    fltToggle.setAttribute('aria-expanded', String(filtersOpen));
    fltToggle.classList.toggle('open', filtersOpen);
    showWatchedChk.checked = showWatched;
  }
  function toggleSrc(qid) {
    if (hiddenSrcs.has(qid)) hiddenSrcs.delete(qid); else hiddenSrcs.add(qid);
    save(LS.hideSrcs, Array.from(hiddenSrcs));
    renderPool();
    renderExplore();
  }
  function commitCutoff() { save(LS.cutoff, cutoff); renderExplore(); }

  // ---- Explore ----
  function renderExplore() {
    if (tab !== 'explore') return;
    if (!pool.length) {
      fltEl.hidden = true; exploreToolbar.hidden = true; progressEl.hidden = true; upnextEl.hidden = true;
      sectionsEl.innerHTML = '';
      showStatus({ status: xStatus, msg: xMsg, action: xAction }, '🍿',
        'The pool is empty. Add people or movies — they become the sources of your marathon.', 'Search movies', () => {
          tab = 'movies'; save(LS.tab, tab); render(); ui.film.input.focus();
        });
      return;
    }
    xStatus.hidden = true;
    fltEl.hidden = false;
    exploreToolbar.hidden = false;
    selSort.value = sortBy; selGroup.value = groupBy;
    renderFilters();

    const flt = filteredMovies();
    const total = flt.length;
    const done = flt.filter((m) => watched.has(m.qid)).length;
    progressEl.hidden = false;
    progressFill.style.width = total ? (done / total * 100) + '%' : '0%';
    progressText.textContent = done + ' / ' + total + ' watched';

    const next = nextUnwatched(flt);
    if (next) {
      upnextEl.hidden = false;
      upnextPoster.innerHTML = posterHTML(next.poster, next.title, 'upnext-img');
      upnextTitle.textContent = next.title;
      upnextSub.textContent = [next.year, next.srcs.map((s) => s.name).join(', ')].filter(Boolean).join(' · ') || '—';
      upnextEl.dataset.qid = next.qid;
    } else {
      upnextEl.hidden = true;
    }

    if (!total) {
      sectionsEl.innerHTML = '';
      if (loadingSrcs.size) {
        showStatus({ status: xStatus, msg: xMsg, action: xAction }, '⏳',
          'Fetching films for ' + loadingSrcs.size + ' source' + (loadingSrcs.size === 1 ? '' : 's') + '…', null);
      } else {
        showStatus({ status: xStatus, msg: xMsg, action: xAction }, '🔍',
          'Nothing matches the filters — sources switched off or released after the cutoff.', 'Reset filters', () => {
            cutoff = todayYMD(); save(LS.cutoff, cutoff);
            hiddenSrcs = new Set(); save(LS.hideSrcs, []);
            renderPool(); renderExplore();
          });
      }
      return;
    }
    xStatus.hidden = true;

    const ordered = sortMovies(flt);
    if (groupBy === 'none') {
      const shown = showWatched ? ordered : ordered.filter((m) => !watched.has(m.qid));
      sectionsEl.innerHTML = '<div class="mcards">' + shown.map((m) => cardHTML(m, next)).join('') + '</div>';
      return;
    }

    let groups = buildGroups(ordered).map((g) => ({
      key: g.key, title: g.title, first: g.first, total: g.movies.length,
      done: g.movies.filter((m) => watched.has(m.qid)).length,
      movies: showWatched ? g.movies : g.movies.filter((m) => !watched.has(m.qid)),
    }));
    if (!showWatched) groups = groups.filter((g) => g.movies.length);

    sectionsEl.innerHTML = groups.map((g) => {
      const open = !collapsed.has(g.key);
      const body = open
        ? '<div class="mcards">' + g.movies.map((m) => cardHTML(m, next)).join('') + '</div>'
        : '';
      const allDone = g.done === g.total;
      return '<div class="section' + (open ? ' open' : '') + '">'
        + '<div class="section-head">'
        + '<button class="section-toggle" type="button" data-key="' + escapeHTML(g.key) + '" aria-expanded="' + open + '">'
        + '<span class="section-chev" aria-hidden="true">▸</span>'
        + '<span class="section-title">' + escapeHTML(g.title) + '</span>'
        + '<span class="section-count">' + g.done + ' / ' + g.total + '</span>'
        + '</button>'
        + '<button class="section-markall' + (allDone ? ' done' : '') + '" type="button" data-markkey="' + escapeHTML(g.key) + '" title="Mark all watched">✓</button>'
        + '</div>' + body + '</div>';
    }).join('');
  }

  function cardHTML(m, next) {
    const isW = watched.has(m.qid);
    const isNext = next && next.qid === m.qid;
    const bits = [];
    if (m.year) bits.push(String(m.year));
    if (m.role) bits.push(escapeHTML(m.role));
    if (groupBy !== 'source') bits.push(escapeHTML(m.srcs.map((s) => s.name).join(', ')));
    return '<div class="mcard' + (isW ? ' watched' : '') + (isNext ? ' next' : '') + '" data-qid="' + escapeHTML(m.qid) + '">'
      + '<div class="mposter">' + posterHTML(m.poster, m.title, 'mposter-img')
      + (isNext ? '<span class="next-badge">Up next</span>' : '') + '</div>'
      + '<div class="mmeta"><div class="mtitle">' + escapeHTML(m.title) + '</div>'
      + '<div class="msub">' + bits.join(' · ') + '</div></div>'
      + '<div class="mact">'
      + '<button class="vcheck" type="button" data-act="toggle" data-qid="' + escapeHTML(m.qid) + '" aria-label="Toggle watched">✓</button>'
      + '</div></div>';
  }

  // ---------------------------------------------------------------------------
  // Detail modal — films
  // ---------------------------------------------------------------------------
  function resetModal() {
    detailFacts.innerHTML = ''; detailActions.innerHTML = ''; detailPlot.textContent = '';
    detailSaga.hidden = true; detailSaga.innerHTML = '';
    detailFilmo.hidden = true; detailFilmo.innerHTML = '';
    castHead.hidden = true; castGrid.innerHTML = '';
    detailLinks.innerHTML = '';
  }
  function openModal() {
    detailModal.hidden = false;
    detailCard.scrollTop = 0;
    document.body.classList.add('modal-open');
  }
  function closeDetail() {
    detail = null;
    detailModal.hidden = true;
    document.body.classList.remove('modal-open');
  }

  function openDetail(seed) {
    detail = {
      kind: 'film',
      qid: seed.qid, title: seed.title, year: seed.year || null, ymd: seed.ymd || null,
      poster: seed.poster || null, article: seed.article || null,
      seriesQ: seed.seriesQ || null, seriesName: seed.seriesName || null,
    };
    openModal();
    resetModal();
    detailPoster.innerHTML = posterHTML(detail.poster, detail.title, 'detail-img');
    detailTitle.textContent = detail.title;
    detailSub.textContent = detail.year ? String(detail.year) : '';
    detailPlot.textContent = 'Loading details…';
    renderDetailActions();
    hydrateDetail(detail.qid);
  }

  function renderDetailActions() {
    if (!detail) return;
    const added = inPool(detail.qid);
    const isW = watched.has(detail.qid);
    let html = added
      ? '<button class="btn small" type="button" data-dact="remove">✓ In pool · remove</button>'
      : '<button class="btn primary small" type="button" data-dact="add">＋ Add to Explore pool</button>';
    if (detail.kind === 'film') {
      html += '<button class="btn small' + (isW ? ' ghost' : '') + '" type="button" data-dact="watch">'
        + (isW ? 'Unmark watched' : '✓ Mark watched') + '</button>';
    }
    detailActions.innerHTML = html;
  }

  async function hydrateDetail(qid) {
    const mine = qid;
    let facts = null;
    try { facts = await fetchFilmFacts(qid); } catch (e) { facts = null; }
    if (!detail || detail.qid !== mine) return;

    if (facts) {
      if (facts.ymd && !detail.ymd) { detail.ymd = facts.ymd; detail.year = facts.year; }
      if (facts.seriesQ) { detail.seriesQ = facts.seriesQ; detail.seriesName = facts.seriesName; }
      if (facts.article && !detail.article) detail.article = facts.article;
    }

    const [cast, summary] = await Promise.all([
      fetchCast(qid).catch(() => []),
      fetchSummary(detail.article),
    ]);
    if (!detail || detail.qid !== mine) return;

    if (summary && !detail.poster) {
      const t = (summary.thumbnail && summary.thumbnail.source) || null;
      if (t) { detail.poster = t; if (detail.article) posterCache[detail.article] = t; }
    }

    detailPoster.innerHTML = posterHTML(detail.poster, detail.title, 'detail-img');
    detailSub.textContent = [detail.year, detail.seriesName].filter(Boolean).join(' · ') || '';

    const factBits = [];
    if (facts && facts.directors.length) factBits.push('<span class="fact"><b>Director</b> ' + escapeHTML(facts.directors.join(', ')) + '</span>');
    if (facts && facts.runtime) factBits.push('<span class="fact"><b>Runtime</b> ' + fmtRuntime(facts.runtime) + '</span>');
    if (facts && facts.genres.length) factBits.push('<span class="fact"><b>Genres</b> ' + escapeHTML(facts.genres.join(', ')) + '</span>');
    detailFacts.innerHTML = factBits.join('');

    detailPlot.textContent = (summary && summary.extract) || 'No summary available.';

    if (detail.seriesQ) {
      const sagaIn = inPool(detail.seriesQ);
      detailSaga.hidden = false;
      detailSaga.innerHTML = '<span class="saga-name">🎞 Part of <b>' + escapeHTML(detail.seriesName || 'a saga') + '</b></span>'
        + (sagaIn
          ? '<span class="filmo-done">✓ Saga in pool</span>'
          : '<button class="btn primary small" type="button" data-dact="saga">＋ Add saga to pool</button>');
    }

    if (cast.length) {
      castHead.hidden = false;
      castGrid.innerHTML = cast.map((c) =>
        '<div class="cast-card" data-pq="' + escapeHTML(c.qid) + '" data-pname="' + escapeHTML(c.name) + '"'
        + (c.img ? ' data-pimg="' + escapeHTML(c.img) + '"' : '') + '>'
        + (c.img ? '<img class="cast-img" loading="lazy" src="' + escapeHTML(c.img) + '" alt="" />'
                 : '<span class="cast-img cast-fallback" aria-hidden="true">' + escapeHTML((c.name[0] || '?').toUpperCase()) + '</span>')
        + '<span class="cast-name">' + escapeHTML(c.name) + '</span>'
        + (c.role ? '<span class="cast-role">' + escapeHTML(c.role) + '</span>' : '')
        + '</div>').join('');
    }

    const links = [];
    if (facts && facts.imdb) links.push('<a class="btn ghost small" href="https://www.imdb.com/title/' + escapeHTML(facts.imdb) + '/" target="_blank" rel="noopener">IMDb ↗</a>');
    if (detail.article) links.push('<a class="btn ghost small" href="https://en.wikipedia.org/wiki/' + escapeHTML(detail.article.replace(/ /g, '_')) + '" target="_blank" rel="noopener">Wikipedia ↗</a>');
    links.push('<a class="btn ghost small" href="https://www.wikidata.org/wiki/' + escapeHTML(qid) + '" target="_blank" rel="noopener">Wikidata ↗</a>');
    detailLinks.innerHTML = links.join('');

    renderDetailActions();
  }

  // ---------------------------------------------------------------------------
  // Detail modal — people
  // ---------------------------------------------------------------------------
  function openPerson(seed) {
    detail = {
      kind: 'person',
      qid: seed.qid, title: seed.title, poster: seed.poster || null,
      article: seed.article || null, occText: seed.occText || '',
      films: null,
    };
    openModal();
    resetModal();
    detailPoster.innerHTML = posterHTML(detail.poster, detail.title, 'detail-img', '👤');
    detailTitle.textContent = detail.title;
    detailSub.textContent = detail.occText;
    detailPlot.textContent = 'Loading filmography…';
    renderDetailActions();
    hydratePerson(detail.qid);
  }

  async function hydratePerson(qid) {
    const mine = qid;
    const [films, summary] = await Promise.all([
      (srcCache[qid] ? Promise.resolve(srcCache[qid]) : fetchFilmography(qid).catch(() => null)),
      fetchSummary(detail.article),
    ]);
    if (!detail || detail.qid !== mine || detail.kind !== 'person') return;

    if (summary) {
      if (!detail.poster && summary.thumbnail && summary.thumbnail.source) {
        detail.poster = summary.thumbnail.source;
        detailPoster.innerHTML = posterHTML(detail.poster, detail.title, 'detail-img', '👤');
      }
      if (summary.description && !detail.occText) detailSub.textContent = summary.description;
      detailPlot.textContent = summary.extract || '';
    } else {
      detailPlot.textContent = '';
    }

    if (!films) {
      detailFilmo.hidden = false;
      detailFilmo.innerHTML = '<div class="filmo-head"><span>Couldn’t load the filmography.</span>'
        + '<button class="btn small" type="button" data-dact="filmo-retry">Retry</button></div>';
      return;
    }
    detail.films = films;
    renderFilmo();

    const links = [];
    if (detail.article) links.push('<a class="btn ghost small" href="https://en.wikipedia.org/wiki/' + escapeHTML(detail.article.replace(/ /g, '_')) + '" target="_blank" rel="noopener">Wikipedia ↗</a>');
    links.push('<a class="btn ghost small" href="https://www.wikidata.org/wiki/' + escapeHTML(qid) + '" target="_blank" rel="noopener">Wikidata ↗</a>');
    detailLinks.innerHTML = links.join('');
  }

  function renderFilmo() {
    if (!detail || detail.kind !== 'person' || !detail.films) return;
    const films = detail.films;
    detailFilmo.hidden = false;
    detailFilmo.innerHTML =
      '<div class="filmo-head">'
      + '<span class="filmo-title-h">Filmography · ' + films.length + ' films</span>'
      + '</div>'
      + '<div class="filmo-rows">'
      + films.map((f) => {
        return '<div class="filmo-row" data-fqid="' + escapeHTML(f.qid) + '">'
          + '<span class="filmo-year">' + (f.year || '—') + '</span>'
          + '<span class="filmo-name">' + escapeHTML(f.title) + '</span>'
          + (f.role ? '<span class="filmo-role">' + escapeHTML(f.role) + '</span>' : '')
          + '</div>';
      }).join('')
      + '</div>';
  }

  // ---------------------------------------------------------------------------
  // Wiring
  // ---------------------------------------------------------------------------
  tabsEl.addEventListener('click', (e) => {
    const b = e.target.closest('.seg-btn'); if (!b) return;
    tab = b.getAttribute('data-tab'); save(LS.tab, tab); render();
  });

  // Pool chips: × removes; chip tap solos that source in Explore (tap again to unsolo).
  poolChips.addEventListener('click', (e) => {
    const rm = e.target.closest('[data-rm]');
    if (rm) { removeSource(rm.getAttribute('data-rm')); return; }
    const chip = e.target.closest('[data-src]');
    if (!chip) return;
    const qid = chip.getAttribute('data-src');
    const enabled = pool.filter((s) => !hiddenSrcs.has(s.qid));
    if (enabled.length === 1 && enabled[0].qid === qid) hiddenSrcs = new Set();
    else hiddenSrcs = new Set(pool.filter((s) => s.qid !== qid).map((s) => s.qid));
    save(LS.hideSrcs, Array.from(hiddenSrcs));
    tab = 'explore'; save(LS.tab, tab);
    render();
  });

  ['person', 'film'].forEach((kind) => {
    const u = ui[kind];
    u.input.addEventListener('input', debounce(() => runSearch(kind), 450));
    u.input.addEventListener('keydown', (e) => { if (e.key === 'Enter') runSearch(kind); });
    u.clear.addEventListener('click', () => {
      u.input.value = ''; search[kind].seq++; search[kind].results = [];
      renderSearch(kind); u.input.focus();
    });
    u.results.addEventListener('click', (e) => {
      const add = e.target.closest('[data-add]');
      if (add) {
        const m = search[kind].results.find((x) => x.qid === add.getAttribute('data-add'));
        if (m) {
          if (inPool(m.qid)) removeSource(m.qid);
          else if (kind === 'person') addPersonSource(m);
          else addFilmSource(m);
          renderSearch(kind);
        }
        return;
      }
      const card = e.target.closest('[data-open]');
      if (card) {
        const m = search[kind].results.find((x) => x.qid === card.getAttribute('data-open'));
        if (m) { if (kind === 'person') openPerson(m); else openDetail(m); }
      }
    });
  });

  fltToggle.addEventListener('click', () => {
    filtersOpen = !filtersOpen; save(LS.filtersOpen, filtersOpen);
    fltBody.hidden = !filtersOpen;
    fltToggle.setAttribute('aria-expanded', String(filtersOpen));
    fltToggle.classList.toggle('open', filtersOpen);
  });
  srcAllBtn.addEventListener('click', () => { hiddenSrcs = new Set(); save(LS.hideSrcs, []); renderPool(); renderExplore(); });
  srcNoneBtn.addEventListener('click', () => {
    hiddenSrcs = new Set(pool.map((s) => s.qid));
    save(LS.hideSrcs, Array.from(hiddenSrcs));
    renderPool(); renderExplore();
  });
  fltReset.addEventListener('click', () => { cutoff = todayYMD(); save(LS.cutoff, cutoff); renderExplore(); });
  clearWatchedBtn.addEventListener('click', () => { if (watched.size) { watched = new Set(); save(LS.watched, []); renderExplore(); } });
  showWatchedChk.addEventListener('change', () => { showWatched = showWatchedChk.checked; save(LS.showWatched, showWatched); renderExplore(); });

  fYear.addEventListener('input', () => {
    cutoff.y = yearRange[Number(fYear.value)] || cutoff.y;
    cutoff.d = Math.min(cutoff.d, daysInMonth(cutoff.y, cutoff.m));
    yrValue.textContent = String(cutoff.y); commitCutoff();
  });
  fMonth.addEventListener('input', () => {
    cutoff.m = Number(fMonth.value);
    cutoff.d = Math.min(cutoff.d, daysInMonth(cutoff.y, cutoff.m));
    moValue.textContent = MONTHS[cutoff.m - 1]; commitCutoff();
  });
  fDay.addEventListener('input', () => {
    cutoff.d = Math.min(Number(fDay.value), daysInMonth(cutoff.y, cutoff.m));
    dyValue.textContent = String(cutoff.d); commitCutoff();
  });

  selSort.addEventListener('change', () => { sortBy = selSort.value; save(LS.sort, sortBy); renderExplore(); });
  selGroup.addEventListener('change', () => { groupBy = selGroup.value; collapsed.clear(); save(LS.group, groupBy); renderExplore(); });

  upnextEl.addEventListener('click', () => {
    const m = exploreMovies().find((x) => x.qid === upnextEl.dataset.qid);
    if (m) openDetail(m);
  });

  sectionsEl.addEventListener('click', (e) => {
    const mark = e.target.closest('[data-markkey]');
    if (mark) {
      const key = mark.getAttribute('data-markkey');
      const g = buildGroups(sortMovies(filteredMovies())).find((x) => x.key === key);
      if (!g) return;
      const allW = g.movies.every((m) => watched.has(m.qid));
      g.movies.forEach((m) => { if (allW) watched.delete(m.qid); else watched.add(m.qid); });
      save(LS.watched, Array.from(watched));
      renderExplore();
      return;
    }
    const tog = e.target.closest('.section-toggle');
    if (tog) {
      const k = tog.getAttribute('data-key');
      if (collapsed.has(k)) collapsed.delete(k); else collapsed.add(k);
      renderExplore();
      return;
    }
    const act = e.target.closest('[data-act="toggle"]');
    if (act) {
      const qid = act.getAttribute('data-qid');
      if (watched.has(qid)) watched.delete(qid); else watched.add(qid);
      save(LS.watched, Array.from(watched));
      renderExplore();
      return;
    }
    const card = e.target.closest('.mcard');
    if (card) {
      const m = exploreMovies().find((x) => x.qid === card.getAttribute('data-qid'));
      if (m) openDetail(m);
    }
  });

  detailActions.addEventListener('click', (e) => {
    const b = e.target.closest('[data-dact]'); if (!b || !detail) return;
    const act = b.getAttribute('data-dact');
    if (act === 'add') {
      if (detail.kind === 'person') addPersonSource(detail);
      else addFilmSource(detail);
      renderDetailActions();
      if (tab !== 'explore') renderSearch(tab === 'people' ? 'person' : 'film');
    } else if (act === 'remove') {
      removeSource(detail.qid);
      renderDetailActions();
      if (tab !== 'explore') renderSearch(tab === 'people' ? 'person' : 'film');
    } else if (act === 'watch') {
      if (watched.has(detail.qid)) watched.delete(detail.qid); else watched.add(detail.qid);
      save(LS.watched, Array.from(watched));
      renderDetailActions();
      if (tab === 'explore') renderExplore();
    }
  });
  detailSaga.addEventListener('click', (e) => {
    if (!e.target.closest('[data-dact="saga"]') || !detail || !detail.seriesQ) return;
    addSagaSource(detail.seriesQ, detail.seriesName);
    detailSaga.querySelector('[data-dact="saga"]').outerHTML = '<span class="filmo-done">✓ Saga in pool</span>';
  });
  detailFilmo.addEventListener('click', (e) => {
    if (e.target.closest('[data-dact="filmo-retry"]')) { hydratePerson(detail.qid); return; }
    const row = e.target.closest('.filmo-row');
    if (row && detail && detail.films) {
      const f = detail.films.find((x) => x.qid === row.getAttribute('data-fqid'));
      if (f) openDetail(f);
    }
  });
  castGrid.addEventListener('click', (e) => {
    const c = e.target.closest('.cast-card');
    if (!c) return;
    openPerson({
      qid: c.getAttribute('data-pq'),
      title: c.getAttribute('data-pname') || '',
      poster: c.getAttribute('data-pimg') || null,
    });
  });
  detailClose.addEventListener('click', closeDetail);
  detailModal.addEventListener('click', (e) => { if (e.target === detailModal) closeDetail(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !detailModal.hidden) closeDetail(); });

  function quit() {
    if (window.self !== window.top) { try { window.parent.postMessage({ type: 'close-game' }, '*'); } catch (e) {} }
    else { location.href = '../../'; }
  }
  quitBtn.addEventListener('click', quit);

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------
  render();
  ensureSources();
  // Refresh posters for film sources that never got one (e.g. added offline).
  (async function refreshFilmPosters() {
    const missing = pool.filter((s) => s.type === 'film' && !s.poster && s.article);
    if (!missing.length) return;
    await fetchPosters(missing.map((s) => s.article));
    let changed = false;
    missing.forEach((s) => {
      const p = posterCache[s.article];
      if (p) { s.poster = p; changed = true; }
    });
    if (changed) { persistPool(); renderAll(); }
  })();

  (function hideLoading() {
    const loading = document.getElementById('app-loading');
    if (!loading) return;
    const navStart = (performance && performance.timeOrigin) || Date.now();
    const remaining = Math.max(0, 3000 - (Date.now() - navStart));
    setTimeout(() => { loading.classList.add('hidden'); setTimeout(() => loading.remove(), 500); }, remaining);
  })();
})();
