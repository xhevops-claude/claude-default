(function () {
  'use strict';

  const CDN = 'https://xhevops-claude.github.io/claude-default/cdn/youtube/';

  const LS = {
    selected: 'binge-selected',
    watched: 'binge-watched',
    showWatched: 'binge-showwatched',
    cutoff: 'binge-cutoff',
    view: 'binge-view',
    sort: 'binge-sort',
    group: 'binge-group',
    filtersOpen: 'binge-filters-open',
  };

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function load(key, fallback) {
    try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); }
    catch (e) { return fallback; }
  }
  function save(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {} }

  // ---- persisted state ----
  let selected = new Set();                       // channel slugs shown (default: all)
  let watched = new Set(load(LS.watched, []));
  let showWatched = load(LS.showWatched, true);
  const savedCut = load(LS.cutoff, null);
  let cutoff = (savedCut && typeof savedCut.y === 'number') ? savedCut : todayYMD();
  let view = load(LS.view, 'list');               // 'list' | 'grid'
  let sortBy = load(LS.sort, 'old');              // 'old' | 'new' | 'popular'
  let groupBy = load(LS.group, 'year');           // 'year' | 'channel'
  let filtersOpen = load(LS.filtersOpen, true);

  // ---- runtime state ----
  let available = [];        // [{slug,name,count,url}]
  let channelData = {};      // slug -> {name, videos:[...]}
  let currentId = null;
  const unavailable = new Set();
  const collapsed = new Set();   // collapsed section keys
  let yearRange = [];

  // ---- elements ----
  const $ = (id) => document.getElementById(id);
  const playerWrap = $('player-wrap');
  const veil = $('veil'), veilText = $('veil-text'), veilLink = $('veil-link');
  const nowTitle = $('now-title'), nowBy = $('now-by'), ytLink = $('yt-link');
  const watchedNextBtn = $('watched-next'), skipBtn = $('skip'), closePlayerBtn = $('close-player');
  const filtersEl = $('filters'), filtersToggle = $('filters-toggle'), filtersBody = $('filters-body'), filtersSummary = $('filters-summary');
  const chanSwitches = $('chan-switches'), chanAllBtn = $('chan-all'), chanNoneBtn = $('chan-none');
  const filtersReset = $('filters-reset'), showWatchedChk = $('show-watched'), clearWatchedBtn = $('clear-watched');
  const toolbar = $('toolbar'), segView = $('seg-view'), selSort = $('sel-sort'), selGroup = $('sel-group');
  const progressEl = $('progress'), progressFill = $('progress-fill'), progressText = $('progress-text');
  const resultsBar = $('results-bar'), resultsCount = $('results-count'), collapseAllBtn = $('collapse-all');
  const sectionsEl = $('sections');
  const statusPanel = $('status-panel'), statusMsg = $('status-msg'), statusAction = $('status-action');
  const quitBtn = $('quit');
  const fYear = $('f-year'), fMonth = $('f-month'), fDay = $('f-day');
  const yrValue = $('yr-value'), moValue = $('mo-value'), dyValue = $('dy-value');

  // ---------------------------------------------------------------------------
  // Data loading
  // ---------------------------------------------------------------------------
  async function loadIndex() {
    try {
      const res = await fetch(CDN + 'index.json', { cache: 'no-store' });
      if (!res.ok) throw new Error('index ' + res.status);
      available = ((await res.json()).channels || []).filter((c) => c && c.slug);
    } catch (e) { available = []; }
  }
  async function loadChannel(slug) {
    if (channelData[slug]) return;
    try {
      const res = await fetch(CDN + slug + '.json', { cache: 'no-store' });
      if (!res.ok) throw new Error(slug + ' ' + res.status);
      const data = await res.json();
      channelData[slug] = {
        name: data.name || slug,
        videos: (data.videos || []).map((v) => ({
          id: v.id, title: v.title, duration: v.duration, ts: v.ts, d: v.d, vc: v.vc, i: v.i,
          slug: slug, channelName: data.name || slug,
        })),
      };
    } catch (e) { /* leave unloaded; a later render picks it up */ }
  }
  async function loadAll() {
    await Promise.all(available.map((c) => loadChannel(c.slug)));
  }

  // ---------------------------------------------------------------------------
  // Dates / formatting
  // ---------------------------------------------------------------------------
  function vidDate(v) {
    if (v.d) {
      const s = String(v.d).padStart(8, '0');
      return { y: +s.slice(0, 4), m: +s.slice(4, 6), day: +s.slice(6, 8), precise: true };
    }
    if (v.ts) return { y: new Date(v.ts * 1000).getUTCFullYear(), m: null, day: null, precise: false };
    return { y: null, m: null, day: null, precise: false };
  }
  function sortEpoch(v) {
    const dt = vidDate(v);
    if (dt.precise) return Date.UTC(dt.y, dt.m - 1, dt.day) / 1000;
    return v.ts || 0;
  }
  function videoYMD(v) {
    const dt = vidDate(v);
    if (dt.precise) return dt.y * 10000 + dt.m * 100 + dt.day;
    if (dt.y) return dt.y * 10000 + 101;
    return 0;
  }
  function todayYMD() { const t = new Date(); return { y: t.getFullYear(), m: t.getMonth() + 1, d: t.getDate() }; }
  function daysInMonth(y, m) { return new Date(y, m, 0).getDate(); }
  function fmtDate(v) {
    const dt = vidDate(v);
    if (dt.precise) return dt.day + ' ' + MONTHS[dt.m - 1] + ' ' + dt.y;
    if (dt.y) return String(dt.y);
    return '';
  }
  function fmtDur(s) {
    if (!s && s !== 0) return '';
    s = Math.round(s);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    const mm = h ? String(m).padStart(2, '0') : String(m);
    return (h ? h + ':' : '') + mm + ':' + String(sec).padStart(2, '0');
  }
  function fmtViews(n) {
    if (!n && n !== 0) return '';
    if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M views';
    if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace(/\.0$/, '') + 'K views';
    return n + ' views';
  }
  function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ---------------------------------------------------------------------------
  // Selection / cutoff / sort / group
  // ---------------------------------------------------------------------------
  function anySelected() { return available.some((c) => selected.has(c.slug)); }
  function monthDayEnabled() { return baseVideosRaw().some((v) => v.d); }
  function cutoffInt() {
    if (!monthDayEnabled()) return cutoff.y * 10000 + 1231;
    const d = Math.min(cutoff.d, daysInMonth(cutoff.y, cutoff.m));
    return cutoff.y * 10000 + cutoff.m * 100 + d;
  }
  // All videos from selected channels (no date filter) — used for slider ranges.
  function baseVideosRaw() {
    const out = [];
    available.forEach((c) => {
      if (!selected.has(c.slug)) return;
      const cd = channelData[c.slug];
      if (cd) out.push.apply(out, cd.videos);
    });
    return out;
  }
  // Selected + within cutoff.
  function baseVideos() {
    const cut = cutoffInt();
    return baseVideosRaw().filter((v) => videoYMD(v) <= cut);
  }
  function sortVids(arr) {
    const a = arr.slice();
    if (sortBy === 'popular') a.sort((x, y) => (y.vc || 0) - (x.vc || 0) || sortEpoch(y) - sortEpoch(x));
    else if (sortBy === 'new') a.sort((x, y) => sortEpoch(y) - sortEpoch(x) || (x.id < y.id ? 1 : -1));
    else a.sort((x, y) => sortEpoch(x) - sortEpoch(y) || (x.id < y.id ? -1 : 1));
    return a;
  }
  // Ordered, filtered list that drives playback (ignores show-watched).
  function playbackList() { return sortVids(baseVideos()); }

  function availableYears() {
    const set = new Set();
    baseVideosRaw().forEach((v) => { const y = vidDate(v).y; if (y) set.add(y); });
    return Array.from(set).sort((a, b) => a - b);
  }

  function nextUnwatched(after) {
    const order = playbackList();
    let started = after == null;
    for (const v of order) {
      if (!started) { if (v.id === after) started = true; continue; }
      if (!watched.has(v.id) && !unavailable.has(v.id)) return v;
    }
    for (const v of order) {
      if (v.id === after) break;
      if (!watched.has(v.id) && !unavailable.has(v.id)) return v;
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  function render() {
    if (!available.length) {
      filtersEl.hidden = true; toolbar.hidden = true; hideResults();
      showStatus('🍿', 'No channel data yet. The scraper publishes to the CDN daily. Check back soon.', null);
      return;
    }

    filtersEl.hidden = false; toolbar.hidden = false;
    renderChannels(); renderFilters(); renderToolbar();

    if (!anySelected()) {
      hideResults();
      showStatus('📺', 'Select a channel above to start your binge.', null);
      return;
    }

    const list = sortVids(baseVideos());
    const total = list.length;
    const watchedCount = list.filter((v) => watched.has(v.id)).length;
    const remaining = total - watchedCount;

    progressEl.hidden = false;
    progressFill.style.width = total ? (watchedCount / total * 100) + '%' : '0%';
    progressText.textContent = watchedCount + ' / ' + total + ' watched';

    if (!total) {
      hideResults(true);
      showStatus('🔍', 'Nothing published on or before that date.', 'Reset to today', resetCutoff);
      return;
    }
    if (!showWatched && remaining === 0) {
      hideResults(true);
      showStatus('🎉', 'All caught up — everything up to this date is watched.', 'Show watched', () => {
        showWatched = true; showWatchedChk.checked = true; save(LS.showWatched, showWatched); render();
      });
      return;
    }

    statusPanel.hidden = true;
    resultsBar.hidden = false;
    resultsCount.textContent = showWatched
      ? total + (total === 1 ? ' video' : ' videos')
      : remaining + ' left';
    renderSections(list);
  }

  function hideResults(keepProgress) {
    if (!keepProgress) progressEl.hidden = true;
    resultsBar.hidden = true;
    sectionsEl.innerHTML = '';
  }
  function showStatus(icon, msg, actionLabel, actionFn) {
    statusPanel.hidden = false;
    statusPanel.querySelector('.status-icon').textContent = icon;
    statusMsg.textContent = msg;
    if (actionLabel) { statusAction.hidden = false; statusAction.textContent = actionLabel; statusAction.onclick = actionFn || null; }
    else { statusAction.hidden = true; statusAction.onclick = null; }
  }

  // ---- channels ----
  // Build the switch rows once; afterwards only sync the checked state. Not
  // rebuilding the DOM on every render keeps the control you're tapping stable,
  // so hammering the switches can't drop or double-fire a toggle.
  function renderChannels() {
    const inputs = chanSwitches.querySelectorAll('.chan-switch .switch-input');
    if (inputs.length !== available.length) {
      chanSwitches.innerHTML = '';
      available.forEach((c) => {
        const row = document.createElement('label');
        row.className = 'switch chan-switch';
        row.innerHTML =
          '<input type="checkbox" class="switch-input"' + (selected.has(c.slug) ? ' checked' : '') + ' />'
          + '<span class="switch-track" aria-hidden="true"></span>'
          + '<span class="switch-text">' + escapeHTML(c.name || c.slug)
          + ' <span class="chan-n">' + (c.count || 0) + '</span></span>';
        row.querySelector('input').addEventListener('change', () => toggleChannel(c.slug));
        chanSwitches.appendChild(row);
      });
    } else {
      available.forEach((c, i) => { inputs[i].checked = selected.has(c.slug); });
    }
  }
  // Pure state flip — all channel data is preloaded, so rapid toggling can't
  // race an in-flight fetch.
  function toggleChannel(slug) {
    if (selected.has(slug)) selected.delete(slug); else selected.add(slug);
    save(LS.selected, Array.from(selected));
    render();
  }
  function selectAllChannels() { selected = new Set(available.map((c) => c.slug)); save(LS.selected, Array.from(selected)); render(); }
  function clearAllChannels() { selected = new Set(); save(LS.selected, Array.from(selected)); render(); }

  // ---- filters (date cutoff) ----
  function renderFilters() {
    const hasPrecise = baseVideosRaw().some((v) => v.d);
    $('ds-month').hidden = !hasPrecise;
    $('ds-day').hidden = !hasPrecise;

    const years = availableYears();
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

    filtersSummary.textContent = filterSummaryText();
    filtersBody.hidden = !filtersOpen;
    filtersToggle.setAttribute('aria-expanded', String(filtersOpen));
    filtersToggle.classList.toggle('open', filtersOpen);
  }
  function filterSummaryText() {
    const sel = available.filter((c) => selected.has(c.slug)).length;
    const t = todayYMD();
    const isToday = cutoff.y === t.y && cutoff.m === t.m && cutoff.d === t.d;
    const d = Math.min(cutoff.d, daysInMonth(cutoff.y, cutoff.m));
    const upto = isToday ? 'today' : d + ' ' + MONTHS[cutoff.m - 1] + ' ' + cutoff.y;
    return sel + '/' + available.length + ' channels · up to ' + upto;
  }
  function resetCutoff() { cutoff = todayYMD(); save(LS.cutoff, cutoff); render(); }
  function commitCutoff() { save(LS.cutoff, cutoff); render(); }

  // ---- toolbar ----
  function renderToolbar() {
    Array.prototype.forEach.call(segView.querySelectorAll('.seg-btn'), (b) => {
      b.setAttribute('aria-selected', String(b.getAttribute('data-view') === view));
    });
    selSort.value = sortBy;
    selGroup.value = groupBy;
  }

  // ---- sections ----
  function buildGroups(list) {
    const map = new Map();
    list.forEach((v) => {
      let key, title;
      if (groupBy === 'channel') { key = 'c:' + v.slug; title = v.channelName; }
      else { const y = vidDate(v).y || 0; key = 'y:' + y; title = y ? String(y) : 'Undated'; }
      if (!map.has(key)) map.set(key, { key: key, title: title, vids: [] });
      map.get(key).vids.push(v);
    });
    let groups = Array.from(map.values());
    if (groupBy === 'year') {
      groups.sort((a, b) => Number(a.key.slice(2)) - Number(b.key.slice(2)));
      if (sortBy === 'new' || sortBy === 'popular') groups.reverse();
    } else {
      const order = available.map((c) => 'c:' + c.slug);
      groups.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
    }
    return groups;
  }

  function renderSections(list) {
    let groups = buildGroups(list);
    if (!showWatched) {
      groups = groups.filter((g) => g.vids.some((v) => !watched.has(v.id) || v.id === currentId));
    }
    updateCollapseAllLabel(groups);

    const html = groups.map((g) => {
      const open = !collapsed.has(g.key);
      const w = g.vids.filter((v) => watched.has(v.id)).length;
      const shown = showWatched ? g.vids : g.vids.filter((v) => !watched.has(v.id) || v.id === currentId);
      const body = open
        ? '<div class="vids ' + view + '">' + shown.map(cardHTML).join('') + '</div>'
        : '';
      const done = w === g.vids.length;
      return '<div class="section' + (open ? ' open' : '') + '">'
        + '<div class="section-head">'
        + '<button class="section-toggle" type="button" data-key="' + escapeHTML(g.key) + '" aria-expanded="' + open + '">'
        + '<span class="section-chev" aria-hidden="true">▸</span>'
        + '<span class="section-title">' + escapeHTML(g.title) + '</span>'
        + '<span class="section-count">' + w + ' / ' + g.vids.length + '</span>'
        + '</button>'
        + '<button class="section-markall' + (done ? ' done' : '') + '" type="button" data-markkey="' + escapeHTML(g.key) + '" title="Mark section watched">✓</button>'
        + '</div>' + body + '</div>';
    });
    sectionsEl.innerHTML = html.join('');
  }

  function cardHTML(v) {
    const isW = watched.has(v.id);
    const isP = v.id === currentId;
    const cls = 'vcard' + (isW ? ' watched' : '') + (isP ? ' playing' : '');
    const thumb = 'https://i.ytimg.com/vi/' + v.id + '/mqdefault.jpg';
    const bits = [];
    if (groupBy !== 'channel') bits.push(escapeHTML(v.channelName));
    if (v.vc) bits.push(fmtViews(v.vc));
    if (fmtDate(v)) bits.push(escapeHTML(fmtDate(v)));
    if (unavailable.has(v.id)) bits.push('<span class="v-badge">unavailable</span>');
    return '<div class="' + cls + '" data-id="' + escapeHTML(v.id) + '">'
      + '<div class="vthumb"><img loading="lazy" src="' + thumb + '" alt="" />'
      + (v.duration ? '<span class="vdur">' + fmtDur(v.duration) + '</span>' : '')
      + '</div>'
      + '<div class="vmeta"><div class="vtitle">' + escapeHTML(v.title) + '</div>'
      + '<div class="vsub">' + bits.join(' · ') + '</div></div>'
      + '<button class="vcheck" type="button" data-act="toggle" data-id="' + escapeHTML(v.id) + '" aria-label="Toggle watched">✓</button>'
      + '</div>';
  }

  function updateCollapseAllLabel(groups) {
    const allOpen = groups.length > 0 && groups.every((g) => !collapsed.has(g.key));
    collapseAllBtn.textContent = allOpen ? 'Collapse all' : 'Expand all';
    collapseAllBtn.dataset.allOpen = String(allOpen);
  }

  sectionsEl.addEventListener('click', (e) => {
    const mark = e.target.closest('[data-markkey]');
    if (mark) { markSectionWatched(mark.getAttribute('data-markkey')); return; }
    const tog = e.target.closest('.section-toggle');
    if (tog) {
      const k = tog.getAttribute('data-key');
      if (collapsed.has(k)) collapsed.delete(k); else collapsed.add(k);
      render();
      return;
    }
    const chk = e.target.closest('[data-act="toggle"]');
    if (chk) { e.stopPropagation(); toggleWatched(chk.getAttribute('data-id')); return; }
    const card = e.target.closest('.vcard');
    if (card) play(card.getAttribute('data-id'));
  });

  collapseAllBtn.addEventListener('click', () => {
    const groups = buildGroups(sortVids(baseVideos()));
    if (collapseAllBtn.dataset.allOpen === 'true') groups.forEach((g) => collapsed.add(g.key));
    else collapsed.clear();
    render();
  });

  // ---------------------------------------------------------------------------
  // Watched
  // ---------------------------------------------------------------------------
  function toggleWatched(id) {
    if (watched.has(id)) watched.delete(id); else watched.add(id);
    save(LS.watched, Array.from(watched));
    render();
  }
  function markWatched(id) { if (id) { watched.add(id); save(LS.watched, Array.from(watched)); } }
  function markSectionWatched(key) {
    const groups = buildGroups(sortVids(baseVideos()));
    const g = groups.find((x) => x.key === key);
    if (!g) return;
    const allW = g.vids.every((v) => watched.has(v.id));
    g.vids.forEach((v) => { if (allW) watched.delete(v.id); else watched.add(v.id); });
    save(LS.watched, Array.from(watched));
    render();
  }

  // ---------------------------------------------------------------------------
  // Playback (YouTube IFrame API)
  // ---------------------------------------------------------------------------
  let player = null, apiReady = false, pendingId = null;

  function findVideo(id) {
    for (const slug in channelData) {
      const hit = channelData[slug].videos.find((v) => v.id === id);
      if (hit) return hit;
    }
    return null;
  }
  function setVeil(state, text) {
    if (state === 'off') { veil.hidden = true; return; }
    veil.hidden = false;
    veilText.textContent = text || 'Loading…';
    veilLink.hidden = state !== 'lost';
  }
  function play(id) {
    const v = findVideo(id);
    if (!v) return;
    currentId = id;
    playerWrap.hidden = false;
    nowTitle.textContent = v.title;
    nowBy.textContent = v.channelName + ' · ' + fmtDate(v);
    const url = 'https://www.youtube.com/watch?v=' + id;
    ytLink.href = url; veilLink.href = url;
    setVeil('on', 'Loading…');
    render();
    try { playerWrap.scrollIntoView({ block: 'start', behavior: 'smooth' }); } catch (e) {}
    if (!apiReady) { pendingId = id; return; }
    if (!player) { startPlayer(id); return; }
    try { player.loadVideoById(id); } catch (e) { onPlayerError(); }
  }
  function startPlayer(id) {
    player = new YT.Player('player', {
      width: '100%', height: '100%',
      videoId: id,
      playerVars: { autoplay: 1, rel: 0, modestbranding: 1, playsinline: 1 },
      events: {
        onStateChange: function (e) {
          if (e.data === YT.PlayerState.PLAYING || e.data === YT.PlayerState.BUFFERING) setVeil('off');
          if (e.data === YT.PlayerState.ENDED) { markWatched(currentId); advance(); }
        },
        onError: function () { onPlayerError(); },
      },
    });
  }
  function closePlayer() {
    if (player) { try { player.stopVideo(); } catch (e) {} }
    currentId = null; playerWrap.hidden = true; setVeil('off'); render();
  }
  function advance() {
    const next = nextUnwatched(currentId);
    if (next) play(next.id); else closePlayer();
  }
  function onPlayerError() {
    if (currentId) unavailable.add(currentId);
    setVeil('lost', 'Can’t embed this one');
    render();
  }
  window.onYouTubeIframeAPIReady = function () {
    apiReady = true;
    if (pendingId != null) { const id = pendingId; pendingId = null; play(id); }
  };
  function loadYouTubeAPI() {
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(tag);
  }

  // ---------------------------------------------------------------------------
  // Wiring
  // ---------------------------------------------------------------------------
  filtersToggle.addEventListener('click', () => {
    filtersOpen = !filtersOpen; save(LS.filtersOpen, filtersOpen);
    filtersBody.hidden = !filtersOpen;
    filtersToggle.setAttribute('aria-expanded', String(filtersOpen));
    filtersToggle.classList.toggle('open', filtersOpen);
  });
  chanAllBtn.addEventListener('click', selectAllChannels);
  chanNoneBtn.addEventListener('click', clearAllChannels);
  filtersReset.addEventListener('click', resetCutoff);
  showWatchedChk.addEventListener('change', () => { showWatched = showWatchedChk.checked; save(LS.showWatched, showWatched); render(); });
  clearWatchedBtn.addEventListener('click', () => { if (watched.size) { watched = new Set(); save(LS.watched, []); render(); } });

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

  segView.addEventListener('click', (e) => {
    const b = e.target.closest('.seg-btn'); if (!b) return;
    view = b.getAttribute('data-view'); save(LS.view, view); render();
  });
  selSort.addEventListener('change', () => { sortBy = selSort.value; save(LS.sort, sortBy); render(); });
  selGroup.addEventListener('change', () => { groupBy = selGroup.value; collapsed.clear(); save(LS.group, groupBy); render(); });

  watchedNextBtn.addEventListener('click', () => { markWatched(currentId); advance(); });
  skipBtn.addEventListener('click', advance);
  closePlayerBtn.addEventListener('click', closePlayer);

  function quit() {
    if (player) { try { player.stopVideo(); } catch (e) {} }
    if (window.self !== window.top) { try { window.parent.postMessage({ type: 'close-game' }, '*'); } catch (e) {} }
    else { location.href = '../../'; }
  }
  quitBtn.addEventListener('click', quit);

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------
  (async function boot() {
    loadYouTubeAPI();
    await loadIndex();
    const savedSel = load(LS.selected, null);
    selected = new Set(
      (savedSel && Array.isArray(savedSel))
        ? savedSel.filter((s) => available.some((c) => c.slug === s))
        : available.map((c) => c.slug)   // default: all selected
    );
    showWatchedChk.checked = showWatched;
    await loadAll();
    render();
  })();

  (function hideLoading() {
    const loading = document.getElementById('app-loading');
    if (!loading) return;
    const navStart = (performance && performance.timeOrigin) || Date.now();
    const remaining = Math.max(0, 3000 - (Date.now() - navStart));
    setTimeout(() => { loading.classList.add('hidden'); setTimeout(() => loading.remove(), 500); }, remaining);
  })();
})();
