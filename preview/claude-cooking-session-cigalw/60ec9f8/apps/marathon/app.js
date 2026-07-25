(function () {
  'use strict';

  // Data comes live from open, keyless APIs:
  //  - Wikidata Query Service (SPARQL) for search, film facts, cast, sagas,
  //    people (actors / producers / directors) and their filmographies
  //  - Wikipedia for posters (pageimages) and plot summaries (REST)
  const SPARQL = 'https://query.wikidata.org/sparql';
  const WP_API = 'https://en.wikipedia.org/w/api.php';
  const WP_REST = 'https://en.wikipedia.org/api/rest_v1/page/summary/';

  const LS = {
    list: 'marathon-list',
    watched: 'marathon-watched',
    showWatched: 'marathon-showwatched',
    sort: 'marathon-sort',
    group: 'marathon-group',
    tab: 'marathon-tab',
    hideCols: 'marathon-hidecols',
    cutoff: 'marathon-cutoff',
    filtersOpen: 'marathon-filters-open',
  };

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function load(key, fallback) {
    try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); }
    catch (e) { return fallback; }
  }
  function save(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {} }

  // ---- persisted state ----
  // list entries: {qid, title, year, ymd, poster, article, colQ, colName, director}
  // colQ/colName = the "collection" a film was added under: a saga, a person,
  // or null for one-offs. Grouping and the collections filter both key off it.
  let list = load(LS.list, []).map((m) => (
    m.colQ !== undefined ? m : {
      qid: m.qid, title: m.title, year: m.year, ymd: m.ymd, poster: m.poster,
      article: m.article, colQ: m.seriesQ || null, colName: m.seriesName || null,
      director: m.director || null,
    }));
  let watched = new Set(load(LS.watched, []));
  let showWatched = load(LS.showWatched, true);
  let sortBy = load(LS.sort, 'old');       // 'old' | 'new'
  let groupBy = load(LS.group, 'none');    // 'none' | 'saga' | 'year'
  let tab = load(LS.tab, null) || (list.length ? 'list' : 'discover');
  let hiddenCols = new Set(load(LS.hideCols, []));   // deselected collection keys
  const savedCut = load(LS.cutoff, null);
  let cutoff = (savedCut && typeof savedCut.y === 'number') ? savedCut : todayYMD();
  let filtersOpen = load(LS.filtersOpen, false);

  // ---- runtime state ----
  let searchResults = [];
  let searchSeq = 0;
  let searchAbort = null;
  const collapsed = new Set();
  const posterCache = {};      // article title -> thumb url ('' = tried, none)
  let detail = null;           // open modal: {kind:'film'|'person', qid, ...}
  let yearRange = [];

  // ---- elements ----
  const $ = (id) => document.getElementById(id);
  const tabsEl = $('tabs'), tabCount = $('tab-count');
  const viewDiscover = $('view-discover'), viewList = $('view-list');
  const searchInput = $('search-input'), searchClear = $('search-clear'), searchHint = $('search-hint');
  const resultsEl = $('results');
  const discoverStatus = $('discover-status'), discoverMsg = $('discover-msg'), discoverAction = $('discover-action');
  const fltEl = $('flt'), fltToggle = $('flt-toggle'), fltBody = $('flt-body'), fltSummary = $('flt-summary');
  const colSwitches = $('col-switches'), colAllBtn = $('col-all'), colNoneBtn = $('col-none');
  const fltReset = $('flt-reset'), showWatchedChk = $('show-watched'), clearWatchedBtn = $('clear-watched');
  const fYear = $('f-year'), fMonth = $('f-month'), fDay = $('f-day');
  const yrValue = $('yr-value'), moValue = $('mo-value'), dyValue = $('dy-value');
  const selSort = $('sel-sort'), selGroup = $('sel-group');
  const progressEl = $('progress'), progressFill = $('progress-fill'), progressText = $('progress-text');
  const upnextEl = $('upnext'), upnextPoster = $('upnext-poster'), upnextTitle = $('upnext-title'), upnextSub = $('upnext-sub');
  const sectionsEl = $('sections');
  const listStatus = $('list-status'), listMsg = $('list-msg'), listAction = $('list-action');
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

  async function searchAll(term, signal) {
    const q =
      'SELECT ?item ?itemLabel ?kind ?date ?article ?img ?occ ?occLabel WHERE {\n' +
      '  SERVICE wikibase:mwapi {\n' +
      '    bd:serviceParam wikibase:endpoint "www.wikidata.org";\n' +
      '                    wikibase:api "EntitySearch";\n' +
      '                    mwapi:search ' + sparqlStr(term) + ';\n' +
      '                    mwapi:language "en";\n' +
      '                    mwapi:limit "30".\n' +
      '    ?item wikibase:apiOutputItem mwapi:item.\n' +
      '    ?num wikibase:apiOrdinal true.\n' +
      '  }\n' +
      '  { ?item wdt:P31/wdt:P279* wd:Q11424. BIND("film" AS ?kind) }\n' +
      '  UNION\n' +
      '  { ?item wdt:P31 wd:Q5. VALUES ?occ { ' + PERSON_OCCS + ' }\n' +
      '    ?item wdt:P106 ?occ. BIND("person" AS ?kind) }\n' +
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
      const kind = r.kind && r.kind.value;
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

  // ---------------------------------------------------------------------------
  // My list
  // ---------------------------------------------------------------------------
  function inList(qid) { return list.some((m) => m.qid === qid); }
  function persistList() { save(LS.list, list); tabCount.textContent = String(list.length); }
  function addMovie(m) {
    if (inList(m.qid)) return;
    list.push({
      qid: m.qid, title: m.title, year: m.year || null, ymd: m.ymd || null,
      poster: m.poster || null, article: m.article || null,
      colQ: m.colQ || m.seriesQ || null, colName: m.colName || m.seriesName || null,
      director: m.director || null,
    });
    persistList();
    if (!m.colQ && (!m.seriesQ || !m.ymd)) backfill(m.qid);
    renderList();
  }
  function removeMovie(qid) {
    list = list.filter((m) => m.qid !== qid);
    persistList();
    renderList();
  }
  // Fill saga/date/poster for entries added straight from search results.
  async function backfill(qid) {
    if (!list.some((x) => x.qid === qid)) return;
    try {
      const f = await fetchFilmFacts(qid);
      const cur = list.find((x) => x.qid === qid);
      if (!cur) return;
      if (f.seriesQ && !cur.colQ) { cur.colQ = f.seriesQ; cur.colName = f.seriesName; }
      if (f.ymd && !cur.ymd) { cur.ymd = f.ymd; cur.year = f.year; }
      if (f.directors.length && !cur.director) cur.director = f.directors[0];
      if (!cur.article && f.article) cur.article = f.article;
      if (!cur.poster && cur.article) {
        await fetchPosters([cur.article]);
        cur.poster = posterCache[cur.article] || null;
      }
      persistList();
      renderList();
    } catch (e) { /* stays sparse; still usable */ }
  }

  // ---- collections / cutoff / filtering ----
  function colKey(m) { return m.colQ || 'solo'; }
  function collections() {
    const map = new Map();
    list.forEach((m) => {
      const k = colKey(m);
      if (!map.has(k)) map.set(k, { key: k, name: m.colName || 'One-offs', count: 0 });
      map.get(k).count++;
    });
    const cols = Array.from(map.values());
    cols.sort((a, b) => {
      if (a.key === 'solo') return 1;
      if (b.key === 'solo') return -1;
      return a.name < b.name ? -1 : 1;
    });
    return cols;
  }
  function cutoffInt() {
    const d = Math.min(cutoff.d, daysInMonth(cutoff.y, cutoff.m));
    return cutoff.y * 10000 + cutoff.m * 100 + d;
  }
  function filteredList() {
    const cut = cutoffInt();
    return list.filter((m) => !hiddenCols.has(colKey(m)) && (m.ymd == null || m.ymd <= cut));
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
  function nextUnwatched() {
    const dir = sortBy;
    sortBy = 'old';
    const order = sortMovies(filteredList());
    sortBy = dir;
    return order.find((m) => !watched.has(m.qid)) || null;
  }

  function buildGroups(arr) {
    const map = new Map();
    arr.forEach((m) => {
      let key, title;
      if (groupBy === 'saga') { key = colKey(m); title = m.colName || 'One-offs'; }
      else { const y = m.year || 0; key = 'y:' + y; title = y ? String(y) : 'Undated'; }
      if (!map.has(key)) map.set(key, { key: key, title: title, first: m.ymd || 99999999, movies: [] });
      const g = map.get(key);
      g.movies.push(m);
      if (m.ymd && m.ymd < g.first) g.first = m.ymd;
    });
    const groups = Array.from(map.values());
    const dir = sortBy === 'new' ? -1 : 1;
    groups.sort((a, b) => {
      if (a.key === 'solo') return 1;
      if (b.key === 'solo') return -1;
      return (a.first - b.first) * dir;
    });
    return groups;
  }

  // ---------------------------------------------------------------------------
  // Render — tabs
  // ---------------------------------------------------------------------------
  function render() {
    Array.prototype.forEach.call(tabsEl.querySelectorAll('.seg-btn'), (b) => {
      b.setAttribute('aria-selected', String(b.getAttribute('data-tab') === tab));
    });
    tabCount.textContent = String(list.length);
    viewDiscover.hidden = tab !== 'discover';
    viewList.hidden = tab !== 'list';
    if (tab === 'discover') renderDiscover(); else renderList();
  }

  function showStatus(panel, msgEl, actionEl, icon, msg, actionLabel, actionFn) {
    panel.hidden = false;
    panel.querySelector('.status-icon').textContent = icon;
    msgEl.textContent = msg;
    if (actionLabel) { actionEl.hidden = false; actionEl.textContent = actionLabel; actionEl.onclick = actionFn || null; }
    else { actionEl.hidden = true; actionEl.onclick = null; }
  }

  // ---- Discover ----
  function renderDiscover() {
    const term = searchInput.value.trim();
    searchClear.hidden = !term;
    if (!term) {
      resultsEl.innerHTML = '';
      searchHint.hidden = false;
      discoverStatus.hidden = true;
      return;
    }
    searchHint.hidden = true;
    if (!searchResults.length) return; // status panel handles empty/loading
    discoverStatus.hidden = true;
    resultsEl.innerHTML = searchResults.map((m) => {
      if (m.kind === 'person') {
        return '<div class="rcard person" data-person="' + escapeHTML(m.qid) + '">'
          + '<div class="rposter round">' + posterHTML(m.poster, m.title, 'rposter-img', '👤') + '</div>'
          + '<div class="rmeta"><div class="rtitle">' + escapeHTML(m.title) + '</div>'
          + '<div class="rsub">' + escapeHTML(m.occText || 'Filmography') + '</div></div>'
          + '</div>';
      }
      const added = inList(m.qid);
      return '<div class="rcard" data-qid="' + escapeHTML(m.qid) + '">'
        + '<div class="rposter">' + posterHTML(m.poster, m.title, 'rposter-img') + '</div>'
        + '<div class="rmeta"><div class="rtitle">' + escapeHTML(m.title) + '</div>'
        + '<div class="rsub">' + (m.year || '—') + '</div></div>'
        + '<button class="radd' + (added ? ' added' : '') + '" type="button" data-add="' + escapeHTML(m.qid) + '"'
        + ' aria-label="' + (added ? 'In your marathon' : 'Add to marathon') + '">' + (added ? '✓' : '＋') + '</button>'
        + '</div>';
    }).join('');
  }

  const debounce = (fn, ms) => {
    let t = null;
    return function () { clearTimeout(t); t = setTimeout(fn, ms); };
  };

  async function runSearch() {
    const term = searchInput.value.trim();
    searchResults = [];
    renderDiscover();
    if (!term) return;
    const seq = ++searchSeq;
    if (searchAbort) searchAbort.abort();
    searchAbort = new AbortController();
    showStatus(discoverStatus, discoverMsg, discoverAction, '🔎', 'Searching films and film people…', null);
    resultsEl.innerHTML = '';
    let found;
    try {
      found = await searchAll(term, searchAbort.signal);
    } catch (e) {
      if (e && e.name === 'AbortError') return;
      if (seq !== searchSeq) return;
      showStatus(discoverStatus, discoverMsg, discoverAction, '📡',
        'Couldn’t reach the movie database. Check your connection and retry.', 'Retry', runSearch);
      return;
    }
    if (seq !== searchSeq) return;
    if (!found.length) {
      showStatus(discoverStatus, discoverMsg, discoverAction, '🕵️',
        'Nothing matched “' + term + '”. Try the original title or full name.', null);
      return;
    }
    searchResults = found;
    renderDiscover();
    await fetchPosters(found.filter((m) => m.kind === 'film').map((m) => m.article));
    if (seq !== searchSeq) return;
    searchResults.forEach((m) => {
      if (m.kind === 'film' && m.article && !m.poster) m.poster = posterCache[m.article] || null;
    });
    renderDiscover();
  }

  // ---- Filters (collections + date cutoff) ----
  function renderFilters() {
    // Collections switches — rebuild only when the set changes, else sync.
    const cols = collections();
    const rows = colSwitches.querySelectorAll('.col-switch');
    const sig = cols.map((c) => c.key + ':' + c.count).join('|');
    if (colSwitches.dataset.sig !== sig || rows.length !== cols.length) {
      colSwitches.dataset.sig = sig;
      colSwitches.innerHTML = '';
      cols.forEach((c) => {
        const row = document.createElement('label');
        row.className = 'switch col-switch';
        row.innerHTML =
          '<input type="checkbox" class="switch-input"' + (hiddenCols.has(c.key) ? '' : ' checked') + ' />'
          + '<span class="switch-track" aria-hidden="true"></span>'
          + '<span class="switch-text">' + escapeHTML(c.name)
          + ' <span class="col-n">' + c.count + '</span></span>';
        row.querySelector('input').addEventListener('change', () => toggleCol(c.key));
        colSwitches.appendChild(row);
      });
    } else {
      cols.forEach((c, i) => { rows[i].querySelector('input').checked = !hiddenCols.has(c.key); });
    }

    // Date sliders.
    const years = [];
    list.forEach((m) => { if (m.year && years.indexOf(m.year) < 0) years.push(m.year); });
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

    const shown = cols.filter((c) => !hiddenCols.has(c.key)).length;
    const t = todayYMD();
    const isToday = cutoff.y === t.y && cutoff.m === t.m && cutoff.d === t.d;
    const upto = isToday ? 'today' : cutoff.d + ' ' + MONTHS[cutoff.m - 1] + ' ' + cutoff.y;
    fltSummary.textContent = shown + '/' + cols.length + ' collections · up to ' + upto;
    fltBody.hidden = !filtersOpen;
    fltToggle.setAttribute('aria-expanded', String(filtersOpen));
    fltToggle.classList.toggle('open', filtersOpen);
    showWatchedChk.checked = showWatched;
  }
  function toggleCol(key) {
    if (hiddenCols.has(key)) hiddenCols.delete(key); else hiddenCols.add(key);
    save(LS.hideCols, Array.from(hiddenCols));
    renderList();
  }
  function commitCutoff() { save(LS.cutoff, cutoff); renderList(); }

  // ---- My Marathon ----
  function renderList() {
    if (tab !== 'list') return;
    tabCount.textContent = String(list.length);
    if (!list.length) {
      fltEl.hidden = true; $('list-toolbar').hidden = true; progressEl.hidden = true; upnextEl.hidden = true;
      sectionsEl.innerHTML = '';
      showStatus(listStatus, listMsg, listAction, '🍿',
        'Your marathon is empty. Find a movie, an actor or a producer — and add their films.', 'Discover', () => {
          tab = 'discover'; save(LS.tab, tab); render(); searchInput.focus();
        });
      return;
    }
    listStatus.hidden = true;
    fltEl.hidden = false;
    $('list-toolbar').hidden = false;
    selSort.value = sortBy; selGroup.value = groupBy;
    renderFilters();

    const flt = filteredList();
    const total = flt.length;
    const done = flt.filter((m) => watched.has(m.qid)).length;
    progressEl.hidden = false;
    progressFill.style.width = total ? (done / total * 100) + '%' : '0%';
    progressText.textContent = done + ' / ' + total + ' watched';

    const next = nextUnwatched();
    if (next) {
      upnextEl.hidden = false;
      upnextPoster.innerHTML = posterHTML(next.poster, next.title, 'upnext-img');
      upnextTitle.textContent = next.title;
      upnextSub.textContent = [next.year, next.colName].filter(Boolean).join(' · ') || '—';
      upnextEl.dataset.qid = next.qid;
    } else {
      upnextEl.hidden = true;
    }

    if (!total) {
      sectionsEl.innerHTML = '';
      showStatus(listStatus, listMsg, listAction, '🔍',
        'Nothing matches the filters — released after the cutoff or collection switched off.', 'Reset filters', () => {
          cutoff = todayYMD(); save(LS.cutoff, cutoff);
          hiddenCols = new Set(); save(LS.hideCols, []);
          renderList();
        });
      return;
    }

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
    if (m.director) bits.push(escapeHTML(m.director));
    if (groupBy !== 'saga' && m.colName) bits.push(escapeHTML(m.colName));
    return '<div class="mcard' + (isW ? ' watched' : '') + (isNext ? ' next' : '') + '" data-qid="' + escapeHTML(m.qid) + '">'
      + '<div class="mposter">' + posterHTML(m.poster, m.title, 'mposter-img')
      + (isNext ? '<span class="next-badge">Up next</span>' : '') + '</div>'
      + '<div class="mmeta"><div class="mtitle">' + escapeHTML(m.title) + '</div>'
      + '<div class="msub">' + bits.join(' · ') + '</div></div>'
      + '<div class="mact">'
      + '<button class="vcheck" type="button" data-act="toggle" data-qid="' + escapeHTML(m.qid) + '" aria-label="Toggle watched">✓</button>'
      + '<button class="mremove" type="button" data-act="remove" data-qid="' + escapeHTML(m.qid) + '" aria-label="Remove">✕</button>'
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
      colQ: seed.colQ || null, colName: seed.colName || null,
      director: seed.director || null,
    };
    openModal();
    resetModal();
    detailPoster.innerHTML = posterHTML(detail.poster, detail.title, 'detail-img');
    detailTitle.textContent = detail.title;
    detailSub.textContent = [detail.year, detail.seriesName || detail.colName].filter(Boolean).join(' · ') || '';
    detailPlot.textContent = 'Loading details…';
    renderDetailActions();
    hydrateDetail(detail.qid);
  }

  function renderDetailActions() {
    if (!detail || detail.kind !== 'film') return;
    const added = inList(detail.qid);
    const isW = watched.has(detail.qid);
    let html = added
      ? '<button class="btn small" type="button" data-dact="remove">✓ In marathon · remove</button>'
      : '<button class="btn primary small" type="button" data-dact="add">＋ Add to marathon</button>';
    if (added) {
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
      if (facts.directors.length) detail.director = facts.directors[0];
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
      detailSaga.hidden = false;
      detailSaga.innerHTML = '<span class="saga-name">🎞 Part of <b>' + escapeHTML(detail.seriesName || 'a saga') + '</b></span>'
        + '<button class="btn primary small" type="button" data-dact="saga">＋ Add whole saga</button>';
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

  async function addSaga() {
    if (!detail || !detail.seriesQ) return;
    const seriesQ = detail.seriesQ, seriesName = detail.seriesName;
    const btn = detailSaga.querySelector('[data-dact="saga"]');
    if (btn) { btn.disabled = true; btn.textContent = 'Adding saga…'; }
    let films;
    try { films = await fetchSaga(seriesQ); }
    catch (e) {
      if (btn) { btn.disabled = false; btn.textContent = 'Retry adding saga'; }
      return;
    }
    await fetchPosters(films.map((f) => f.article));
    films.forEach((f) => {
      if (inList(f.qid)) return;
      list.push({
        qid: f.qid, title: f.title, year: f.year, ymd: f.ymd,
        poster: (f.article && posterCache[f.article]) || null, article: f.article,
        colQ: seriesQ, colName: seriesName, director: null,
      });
    });
    persistList();
    if (btn) { btn.textContent = '✓ Saga added (' + films.length + ' films)'; }
    renderDetailActions();
    renderList();
  }

  // ---------------------------------------------------------------------------
  // Detail modal — people (actors / producers / directors)
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
    hydratePerson(detail.qid);
  }

  async function hydratePerson(qid) {
    const mine = qid;
    const [films, summary] = await Promise.all([
      fetchFilmography(qid).catch(() => null),
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
    const left = films.filter((f) => !inList(f.qid)).length;
    detailFilmo.hidden = false;
    detailFilmo.innerHTML =
      '<div class="filmo-head">'
      + '<span class="filmo-title-h">Filmography · ' + films.length + ' films</span>'
      + (left
        ? '<button class="btn primary small" type="button" data-dact="filmo-all">＋ Add all (' + left + ')</button>'
        : '<span class="filmo-done">✓ All in marathon</span>')
      + '</div>'
      + '<div class="filmo-rows">'
      + films.map((f) => {
        const added = inList(f.qid);
        return '<div class="filmo-row" data-fqid="' + escapeHTML(f.qid) + '">'
          + '<span class="filmo-year">' + (f.year || '—') + '</span>'
          + '<span class="filmo-name">' + escapeHTML(f.title) + '</span>'
          + (f.role ? '<span class="filmo-role">' + escapeHTML(f.role) + '</span>' : '')
          + '<button class="radd' + (added ? ' added' : '') + '" type="button" data-fadd="' + escapeHTML(f.qid) + '"'
          + ' aria-label="' + (added ? 'In your marathon' : 'Add to marathon') + '">' + (added ? '✓' : '＋') + '</button>'
          + '</div>';
      }).join('')
      + '</div>';
  }

  async function addPersonFilm(qid) {
    if (!detail || detail.kind !== 'person' || !detail.films) return;
    const f = detail.films.find((x) => x.qid === qid);
    if (!f) return;
    if (inList(qid)) { removeMovie(qid); renderFilmo(); return; }
    if (f.article && posterCache[f.article] === undefined) await fetchPosters([f.article]);
    addMovie({
      qid: f.qid, title: f.title, year: f.year, ymd: f.ymd, article: f.article,
      poster: (f.article && posterCache[f.article]) || null,
      colQ: detail.qid, colName: detail.title,
    });
    renderFilmo();
  }

  async function addAllPersonFilms() {
    if (!detail || detail.kind !== 'person' || !detail.films) return;
    const person = detail.qid, personName = detail.title;
    const films = detail.films;
    const btn = detailFilmo.querySelector('[data-dact="filmo-all"]');
    if (btn) { btn.disabled = true; btn.textContent = 'Adding…'; }
    await fetchPosters(films.map((f) => f.article));
    if (!detail || detail.qid !== person) return;
    films.forEach((f) => {
      if (inList(f.qid)) return;
      list.push({
        qid: f.qid, title: f.title, year: f.year, ymd: f.ymd,
        poster: (f.article && posterCache[f.article]) || null, article: f.article,
        colQ: person, colName: personName, director: null,
      });
    });
    persistList();
    renderFilmo();
    renderList();
  }

  // ---------------------------------------------------------------------------
  // Wiring
  // ---------------------------------------------------------------------------
  tabsEl.addEventListener('click', (e) => {
    const b = e.target.closest('.seg-btn'); if (!b) return;
    tab = b.getAttribute('data-tab'); save(LS.tab, tab); render();
  });

  searchInput.addEventListener('input', debounce(runSearch, 450));
  searchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') runSearch(); });
  searchClear.addEventListener('click', () => { searchInput.value = ''; searchSeq++; searchResults = []; renderDiscover(); searchInput.focus(); });

  resultsEl.addEventListener('click', (e) => {
    const add = e.target.closest('[data-add]');
    if (add) {
      const m = searchResults.find((x) => x.qid === add.getAttribute('data-add'));
      if (m) { if (inList(m.qid)) removeMovie(m.qid); else addMovie(m); renderDiscover(); }
      return;
    }
    const pcard = e.target.closest('[data-person]');
    if (pcard) {
      const p = searchResults.find((x) => x.qid === pcard.getAttribute('data-person'));
      if (p) openPerson(p);
      return;
    }
    const card = e.target.closest('.rcard');
    if (card) {
      const m = searchResults.find((x) => x.qid === card.getAttribute('data-qid'));
      if (m) openDetail(m);
    }
  });

  fltToggle.addEventListener('click', () => {
    filtersOpen = !filtersOpen; save(LS.filtersOpen, filtersOpen);
    fltBody.hidden = !filtersOpen;
    fltToggle.setAttribute('aria-expanded', String(filtersOpen));
    fltToggle.classList.toggle('open', filtersOpen);
  });
  colAllBtn.addEventListener('click', () => { hiddenCols = new Set(); save(LS.hideCols, []); renderList(); });
  colNoneBtn.addEventListener('click', () => {
    hiddenCols = new Set(collections().map((c) => c.key));
    save(LS.hideCols, Array.from(hiddenCols));
    renderList();
  });
  fltReset.addEventListener('click', () => { cutoff = todayYMD(); save(LS.cutoff, cutoff); renderList(); });
  clearWatchedBtn.addEventListener('click', () => { if (watched.size) { watched = new Set(); save(LS.watched, []); renderList(); } });
  showWatchedChk.addEventListener('change', () => { showWatched = showWatchedChk.checked; save(LS.showWatched, showWatched); renderList(); });

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

  selSort.addEventListener('change', () => { sortBy = selSort.value; save(LS.sort, sortBy); renderList(); });
  selGroup.addEventListener('change', () => { groupBy = selGroup.value; collapsed.clear(); save(LS.group, groupBy); renderList(); });

  upnextEl.addEventListener('click', () => {
    const m = list.find((x) => x.qid === upnextEl.dataset.qid);
    if (m) openDetail(m);
  });

  sectionsEl.addEventListener('click', (e) => {
    const mark = e.target.closest('[data-markkey]');
    if (mark) {
      const key = mark.getAttribute('data-markkey');
      const g = buildGroups(sortMovies(filteredList())).find((x) => x.key === key);
      if (!g) return;
      const allW = g.movies.every((m) => watched.has(m.qid));
      g.movies.forEach((m) => { if (allW) watched.delete(m.qid); else watched.add(m.qid); });
      save(LS.watched, Array.from(watched));
      renderList();
      return;
    }
    const tog = e.target.closest('.section-toggle');
    if (tog) {
      const k = tog.getAttribute('data-key');
      if (collapsed.has(k)) collapsed.delete(k); else collapsed.add(k);
      renderList();
      return;
    }
    const act = e.target.closest('[data-act]');
    if (act) {
      const qid = act.getAttribute('data-qid');
      if (act.getAttribute('data-act') === 'remove') { removeMovie(qid); return; }
      if (watched.has(qid)) watched.delete(qid); else watched.add(qid);
      save(LS.watched, Array.from(watched));
      renderList();
      return;
    }
    const card = e.target.closest('.mcard');
    if (card) {
      const m = list.find((x) => x.qid === card.getAttribute('data-qid'));
      if (m) openDetail(m);
    }
  });

  detailActions.addEventListener('click', (e) => {
    const b = e.target.closest('[data-dact]'); if (!b || !detail) return;
    const act = b.getAttribute('data-dact');
    if (act === 'add') { addMovie(detail); renderDetailActions(); renderDiscover(); }
    else if (act === 'remove') { removeMovie(detail.qid); renderDetailActions(); renderDiscover(); }
    else if (act === 'watch') {
      if (watched.has(detail.qid)) watched.delete(detail.qid); else watched.add(detail.qid);
      save(LS.watched, Array.from(watched));
      renderDetailActions(); renderList();
    }
  });
  detailSaga.addEventListener('click', (e) => {
    if (e.target.closest('[data-dact="saga"]')) addSaga();
  });
  detailFilmo.addEventListener('click', (e) => {
    if (e.target.closest('[data-dact="filmo-all"]')) { addAllPersonFilms(); return; }
    if (e.target.closest('[data-dact="filmo-retry"]')) { hydratePerson(detail.qid); return; }
    const add = e.target.closest('[data-fadd]');
    if (add) { addPersonFilm(add.getAttribute('data-fadd')); return; }
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
  // Refresh posters for list entries that never got one (e.g. added offline).
  (async function refreshListPosters() {
    const missing = list.filter((m) => !m.poster && m.article);
    if (!missing.length) return;
    await fetchPosters(missing.map((m) => m.article));
    let changed = false;
    missing.forEach((m) => {
      const p = posterCache[m.article];
      if (p) { m.poster = p; changed = true; }
    });
    if (changed) { persistList(); renderList(); }
  })();

  (function hideLoading() {
    const loading = document.getElementById('app-loading');
    if (!loading) return;
    const navStart = (performance && performance.timeOrigin) || Date.now();
    const remaining = Math.max(0, 3000 - (Date.now() - navStart));
    setTimeout(() => { loading.classList.add('hidden'); setTimeout(() => loading.remove(), 500); }, remaining);
  })();
})();
