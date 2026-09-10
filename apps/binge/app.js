(function () {
  'use strict';

  const CDN = 'https://xhevops-claude.github.io/claude-default/cdn/youtube/';

  const LS = {
    selected: 'binge-selected',
    watched: 'binge-watched',            // legacy: array of video ids (migrated on load)
    watchedTo: 'binge-watchedto',        // { slug: yyyymmdd } — watched up to this date, inclusive
    showWatched: 'binge-showwatched',
    cutoff: 'binge-cutoff',
    view: 'binge-view',
    sort: 'binge-sort',
    group: 'binge-group',
    tab: 'binge-tab',                    // active group id ('all' or a groups.json id)
    tabs: 'binge-tabs',                  // { groupId: { off:[slug], cutoff:{y,m,d}, showWatched } } — per-tab filters
  };

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function load(key, fallback) {
    try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); }
    catch (e) { return fallback; }
  }
  function save(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {} }
  // A stored pref that isn't one of the allowed values falls back to the default.
  function pick(key, allowed, fallback) { const v = load(key, fallback); return allowed.indexOf(v) >= 0 ? v : fallback; }
  const VIEWS = ['list', 'grid'], SORTS = ['old', 'new', 'popular'], GROUPS = ['year', 'bundle', 'channel'];

  // ---- persisted state ----
  let selected = new Set();                       // channel slugs shown — derived from the active group minus its exclusions
  let activeTab = load(LS.tab, 'all');            // active group id
  let tabs = load(LS.tabs, {});                   // groupId -> { off, cutoff, showWatched } — each tab owns its filters
  let watchedTo = load(LS.watchedTo, {});         // slug -> yyyymmdd cursor
  let showWatched = true;                         // mirrors the active tab's setting
  let cutoff = todayYMD();                        // mirrors the active tab's cutoff
  let view = pick(LS.view, VIEWS, 'list');
  let sortBy = pick(LS.sort, SORTS, 'old');
  let groupBy = pick(LS.group, GROUPS, 'year');
  let filtersOpen = false;                        // panel is tucked away until the funnel is tapped

  // ---- runtime state ----
  let available = [];        // [{slug,name,count,url}]
  let groups = [];           // [{id,name,channels:[slug]}] from groups.json (a slug may sit in several)
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
  const filtersEl = $('filters'), filtersToggle = $('filters-toggle');
  const groupTabs = $('group-tabs'), chanLabel = $('chan-label');
  const chanSwitches = $('chan-switches'), chanAllBtn = $('chan-all'), chanNoneBtn = $('chan-none');
  const filtersReset = $('filters-reset'), showWatchedChk = $('show-watched'), clearWatchedBtn = $('clear-watched');
  const toolbar = $('toolbar');
  const progressEl = $('progress'), progressFill = $('progress-fill'), progressText = $('progress-text');
  const resultsBar = $('results-bar'), resultsCount = $('results-count'), collapseAllBtn = $('collapse-all');
  const sectionsEl = $('sections');
  const statusPanel = $('status-panel'), statusMsg = $('status-msg'), statusAction = $('status-action');
  const quitBtn = $('quit');
  const toastEl = $('toast'), toastMsg = $('toast-msg'), toastUndo = $('toast-undo');
  const syncOpenBtn = $('sync-open'), syncModal = $('sync-modal'), syncClose = $('sync-close');
  const syncCopyBtn = $('sync-copy'), syncPaste = $('sync-paste'), syncApplyBtn = $('sync-apply'), syncNote = $('sync-note');
  const yrValue = $('yr-value'), moValue = $('mo-value'), dyValue = $('dy-value');

  // ---------------------------------------------------------------------------
  // Slotted slider — the track is divided into `n` equal slots and the knob is
  // one slot wide. While dragging the knob follows the pointer freely (and
  // `onPreview` reports the slot it hovers); on release it snaps to the
  // nearest slot and `onChange` fires with that index. A tap on the track
  // grabs the knob under the pointer, so the same gesture covers both.
  // ---------------------------------------------------------------------------
  function slotSlider(el, opts) {
    const knob = el.querySelector('.slot-knob');
    let n = 1, idx = 0, drag = null;

    function slotW() { return el.clientWidth / n; }
    function clampPx(px) { return Math.min(Math.max(px, 0), el.clientWidth - slotW()); }
    function nearest(px) { return Math.min(n - 1, Math.max(0, Math.round(px / slotW()))); }
    function paint() {
      el.style.setProperty('--n', String(n));
      el.style.setProperty('--i', String(idx));
      el.setAttribute('aria-valuemax', String(n - 1));
      el.setAttribute('aria-valuenow', String(idx));
      if (opts.valueText) el.setAttribute('aria-valuetext', opts.valueText(idx));
    }
    function commit(i) {
      knob.style.left = '';
      if (i === idx) { paint(); return; }
      idx = i; paint();
      opts.onChange(idx);
    }

    el.addEventListener('pointerdown', (e) => {
      if (e.button != null && e.button !== 0) return;
      const rect = el.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const kl = idx * slotW(), kw = slotW();
      // Grab the knob where it was hit; anywhere else, centre it under the finger.
      const off = (px >= kl && px <= kl + kw) ? px - kl : kw / 2;
      drag = { id: e.pointerId, left: rect.left, off: off };
      el.classList.add('dragging');
      try { el.setPointerCapture(e.pointerId); } catch (err) {}
      moveTo(e.clientX);
      e.preventDefault();
    });
    function moveTo(clientX) {
      const px = clampPx(clientX - drag.left - drag.off);
      knob.style.left = px + 'px';
      if (opts.onPreview) opts.onPreview(nearest(px));
    }
    el.addEventListener('pointermove', (e) => { if (drag && e.pointerId === drag.id) moveTo(e.clientX); });
    function release(e) {
      if (!drag || e.pointerId !== drag.id) return;
      const px = clampPx(e.clientX - drag.left - drag.off);
      drag = null;
      el.classList.remove('dragging');
      commit(nearest(px));
    }
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);

    el.addEventListener('keydown', (e) => {
      let next = null;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = idx - 1;
      else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = idx + 1;
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = n - 1;
      if (next == null) return;
      e.preventDefault();
      commit(Math.min(n - 1, Math.max(0, next)));
    });

    return {
      set: function (count, index) {
        n = Math.max(1, count | 0);
        idx = Math.min(n - 1, Math.max(0, index | 0));
        if (!drag) knob.style.left = '';
        paint();
      },
    };
  }

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
  async function loadGroups() {
    try {
      const res = await fetch('groups.json', { cache: 'no-store' });
      if (!res.ok) throw new Error('groups ' + res.status);
      groups = ((await res.json()).groups || [])
        .filter((g) => g && g.id && g.name && Array.isArray(g.channels))
        .map((g) => ({ id: String(g.id), name: String(g.name), channels: g.channels.map(String) }));
    } catch (e) { groups = []; }
  }

  // ---------------------------------------------------------------------------
  // Groups — a tab per group from groups.json plus a synthetic "All". The
  // active tab decides which channels are in play; within a tab every channel
  // starts on and the ones you switch off are remembered per tab, so
  // "Steve" always means all of Steve unless you've trimmed it.
  // ---------------------------------------------------------------------------
  function allGroups() {
    const out = [{ id: 'all', name: 'All', channels: available.map((c) => c.slug) }];
    groups.forEach((g) => {
      const chans = g.channels.filter((s) => available.some((c) => c.slug === s));
      if (chans.length) out.push({ id: g.id, name: g.name, channels: chans });
    });
    return out;
  }
  function currentGroup() {
    const all = allGroups();
    return all.find((g) => g.id === activeTab) || all[0];
  }
  function tabState(id) { const t = tabs[id]; return (t && typeof t === 'object') ? t : {}; }
  function setTabPref(id, key, val) {
    tabs[id] = Object.assign({}, tabState(id));
    if (val == null) delete tabs[id][key]; else tabs[id][key] = val;
    if (!Object.keys(tabs[id]).length) delete tabs[id];
    save(LS.tabs, tabs);
  }
  function offSet(id) { const off = tabState(id).off; return new Set(Array.isArray(off) ? off : []); }
  function setOff(id, slugs) { setTabPref(id, 'off', slugs.length ? slugs : null); }
  function tabCutoff(id) {
    const c = tabState(id).cutoff;
    if (c && typeof c.y === 'number') return { y: c.y, m: c.m || 1, d: c.d || 1 };
    // Tabs without their own cutoff yet inherit the pre-groups global one.
    const legacy = load(LS.cutoff, null);
    return (legacy && typeof legacy.y === 'number') ? { y: legacy.y, m: legacy.m || 1, d: legacy.d || 1 } : todayYMD();
  }
  function tabShowWatched(id) {
    const s = tabState(id).showWatched;
    return typeof s === 'boolean' ? s : load(LS.showWatched, true);
  }
  // Pull the active tab's filters into the runtime vars the renderer reads.
  function recomputeSelected() {
    const g = currentGroup();
    activeTab = g.id;
    const off = offSet(g.id);
    selected = new Set(g.channels.filter((s) => !off.has(s)));
    cutoff = tabCutoff(g.id);
    showWatched = tabShowWatched(g.id);
    showWatchedChk.checked = showWatched;
  }
  function saveCutoff() { setTabPref(activeTab, 'cutoff', { y: cutoff.y, m: cutoff.m, d: cutoff.d }); }
  function saveShowWatched() { setTabPref(activeTab, 'showWatched', showWatched); }

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

  // Earliest dated upload among the selected channels (0 if nothing is dated).
  function firstUploadYMD() {
    let first = 0;
    baseVideosRaw().forEach((v) => { const y = videoYMD(v); if (y && (!first || y < first)) first = y; });
    return first;
  }
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
      if (!isWatched(v) && !unavailable.has(v.id)) return v;
    }
    for (const v of order) {
      if (v.id === after) break;
      if (!isWatched(v) && !unavailable.has(v.id)) return v;
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  function render() {
    if (!available.length) {
      groupTabs.hidden = true; toolbar.hidden = true; filtersEl.hidden = true; hideResults();
      showStatus('🍿', 'No channel data yet. The scraper publishes to the CDN daily. Check back soon.', null);
      return;
    }

    groupTabs.hidden = false; toolbar.hidden = false;
    renderTabs(); renderChannels(); renderFilters(); renderToolbar();

    if (!anySelected()) {
      hideResults();
      showStatus('📺', 'Select a channel above to start your binge.', null);
      return;
    }

    const list = sortVids(baseVideos());
    const total = list.length;
    const watchedCount = list.filter(isWatched).length;
    const remaining = total - watchedCount;

    progressEl.hidden = false;
    progressFill.style.width = total ? (watchedCount / total * 100) + '%' : '0%';
    progressText.textContent = watchedCount + ' / ' + total;
    resultsCount.textContent = (showWatched
      ? total + (total === 1 ? ' video' : ' videos')
      : remaining + ' left') + ' · up to ' + cutoffLabel();

    if (!total) {
      hideResults(true);
      showStatus('🔍', 'Nothing published on or before that date.', 'Reset to today', resetCutoff);
      return;
    }
    if (!showWatched && remaining === 0) {
      hideResults(true);
      showStatus('🎉', 'All caught up — everything up to this date is watched.', 'Show watched', () => {
        showWatched = true; showWatchedChk.checked = true; saveShowWatched(); render();
      });
      return;
    }

    statusPanel.hidden = true;
    resultsBar.hidden = false;
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

  // ---- group tabs ----
  // Same build-once/sync-after discipline as the switches: the pills are only
  // rebuilt when the set of groups changes, otherwise just the selected state.
  function renderTabs() {
    const all = allGroups();
    const key = all.map((g) => g.id + ':' + g.channels.length).join('|');
    if (groupTabs.dataset.key !== key) {
      groupTabs.dataset.key = key;
      const tabHtml = (g) =>
        '<button class="tab" type="button" role="tab" data-tab="' + escapeHTML(g.id) + '" aria-selected="false">'
        + '<span class="tab-name">' + escapeHTML(g.name) + '</span><span class="tab-n"></span></button>';
      // "All" stays put on the left; the bundles scroll sideways next to it.
      groupTabs.innerHTML = tabHtml(all[0]) + '<div class="tabs-scroll">' + all.slice(1).map(tabHtml).join('') + '</div>';
    }
    // Each tab carries its own cutoff date under the name, so the per-tab dates read at a glance.
    Array.prototype.forEach.call(groupTabs.querySelectorAll('.tab'), (b) => {
      const id = b.getAttribute('data-tab');
      b.setAttribute('aria-selected', String(id === activeTab));
      b.querySelector('.tab-n').textContent = cutoffText(tabCutoff(id));
    });
  }
  groupTabs.addEventListener('click', (e) => {
    const b = e.target.closest('.tab'); if (!b) return;
    selectTab(b.getAttribute('data-tab'));
  });
  function selectTab(id) {
    if (id === activeTab) return;
    activeTab = id; save(LS.tab, activeTab);
    recomputeSelected();
    render();
    try { groupTabs.querySelector('[aria-selected="true"]').scrollIntoView({ inline: 'nearest', block: 'nearest' }); } catch (e) {}
  }

  // ---- channels ----
  // Build the switch rows once per tab; afterwards only sync the checked
  // state. Not rebuilding the DOM on every render keeps the control you're
  // tapping stable, so hammering the switches can't drop or double-fire a
  // toggle.
  function renderChannels() {
    const g = currentGroup();
    const chans = g.channels.map((s) => available.find((c) => c.slug === s)).filter(Boolean);
    chanLabel.textContent = g.id === 'all' ? 'All channels' : g.name + ' channels';
    const key = chans.map((c) => c.slug).join('|');
    if (chanSwitches.dataset.key !== key) {
      chanSwitches.dataset.key = key;
      chanSwitches.innerHTML = '';
      chans.forEach((c) => {
        const row = document.createElement('label');
        row.className = 'switch chan-switch';
        row.innerHTML =
          '<input type="checkbox" class="switch-input"' + (selected.has(c.slug) ? ' checked' : '') + ' />'
          + '<span class="switch-track" aria-hidden="true"></span>'
          + '<span class="switch-text"><span class="chan-name">' + escapeHTML(c.name || c.slug) + '</span>'
          + '<span class="chan-upto">' + escapeHTML(cursorLabel(c.slug)) + '</span>'
          + '<span class="chan-n">' + (c.count || 0) + '</span></span>';
        row.querySelector('input').addEventListener('change', () => toggleChannel(c.slug));
        chanSwitches.appendChild(row);
      });
    } else {
      const inputs = chanSwitches.querySelectorAll('.chan-switch .switch-input');
      const uptos = chanSwitches.querySelectorAll('.chan-switch .chan-upto');
      chans.forEach((c, i) => {
        inputs[i].checked = selected.has(c.slug);
        uptos[i].textContent = cursorLabel(c.slug);
      });
    }
  }
  function cursorLabel(slug) {
    const cur = cursorOf(slug);
    return cur ? 'up to ' + fmtYMDInt(cur) : '';
  }
  // Pure state flip — all channel data is preloaded, so rapid toggling can't
  // race an in-flight fetch.
  function toggleChannel(slug) {
    const g = currentGroup();
    const off = offSet(g.id);
    if (off.has(slug)) off.delete(slug); else off.add(slug);
    setOff(g.id, g.channels.filter((s) => off.has(s)));
    recomputeSelected();
    render();
  }
  function selectAllChannels() { const g = currentGroup(); setOff(g.id, []); recomputeSelected(); render(); }
  function clearAllChannels() { const g = currentGroup(); setOff(g.id, g.channels.slice()); recomputeSelected(); render(); }

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
    cutoff.m = Math.min(Math.max(cutoff.m, 1), 12);
    cutoff.d = Math.min(Math.max(cutoff.d, 1), daysInMonth(cutoff.y, cutoff.m));

    // Never earlier than the first upload across the tab's channels: a cutoff
    // before that shows nothing, so the sliders floor at that exact date.
    const first = firstUploadYMD();
    if (first && cutoffInt() < first) {
      cutoff = { y: Math.floor(first / 10000), m: Math.floor(first / 100) % 100 || 1, d: first % 100 || 1 };
      saveCutoff();
    }

    yearSlider.set(yearRange.length, yearRange.indexOf(cutoff.y));
    yrValue.textContent = String(cutoff.y);
    monthSlider.set(12, cutoff.m - 1);
    moValue.textContent = MONTHS[cutoff.m - 1];
    daySlider.set(daysInMonth(cutoff.y, cutoff.m), cutoff.d - 1);
    dyValue.textContent = String(cutoff.d);

    filtersEl.hidden = !filtersOpen;
    filtersToggle.setAttribute('aria-expanded', String(filtersOpen));
    filtersToggle.classList.toggle('on', filtersEngaged());
  }
  // True when the active tab strays from "everything, up to today, watched shown".
  function filtersEngaged() {
    const g = currentGroup();
    const t = todayYMD();
    const isToday = cutoff.y === t.y && cutoff.m === t.m && cutoff.d === t.d;
    return offSet(g.id).size > 0 || !isToday || !showWatched;
  }
  function cutoffLabel() { return cutoffText(cutoff); }
  // A cutoff as text: "today", or yyyy MON d.
  function cutoffText(c) {
    const t = todayYMD();
    const isToday = c.y === t.y && c.m === t.m && c.d === t.d;
    const d = Math.min(c.d, daysInMonth(c.y, c.m));
    return isToday ? 'today' : fmtYMD(c.y, c.m, d);
  }
  // "up to" dates read as yyyy MON d, e.g. 2023 JUL 1.
  function fmtYMD(y, m, d) {
    return y + ' ' + MONTHS[m - 1].toUpperCase() + ' ' + d;
  }
  function resetCutoff() { cutoff = todayYMD(); saveCutoff(); render(); }
  function commitCutoff() { saveCutoff(); render(); }

  // ---- toolbar (view · sort · filters) + results bar (group by) ----
  function renderToolbar() {
    Array.prototype.forEach.call(document.querySelectorAll('.toolbar .seg-btn, .results-bar .seg-btn'), (b) => {
      const on = b.hasAttribute('data-view') ? b.getAttribute('data-view') === view
        : b.hasAttribute('data-sort') ? b.getAttribute('data-sort') === sortBy
          : b.getAttribute('data-group') === groupBy;
      b.setAttribute('aria-selected', String(on));
    });
  }

  // ---- sections ----
  function buildGroups(list) {
    // By bundle: one section per groups.json entry, in file order. A channel
    // that sits in several bundles shows up under each; channels in none
    // fall into "Other".
    if (groupBy === 'bundle') {
      const out = [], seen = new Set();
      groups.forEach((g) => {
        const vids = list.filter((v) => g.channels.indexOf(v.slug) >= 0);
        if (!vids.length) return;
        out.push({ key: 'b:' + g.id, title: g.name, vids: vids });
        vids.forEach((v) => seen.add(v.id));
      });
      const rest = list.filter((v) => !seen.has(v.id));
      if (rest.length) out.push({ key: 'b:_other', title: 'Other', vids: rest });
      return out;
    }
    const map = new Map();
    list.forEach((v) => {
      let key, title;
      if (groupBy === 'channel') { key = 'c:' + v.slug; title = v.channelName; }
      else { const y = vidDate(v).y || 0; key = 'y:' + y; title = y ? String(y) : 'Undated'; }
      if (!map.has(key)) map.set(key, { key: key, title: title, vids: [] });
      map.get(key).vids.push(v);
    });
    const out = Array.from(map.values());
    if (groupBy === 'year') {
      out.sort((a, b) => Number(a.key.slice(2)) - Number(b.key.slice(2)));
      if (sortBy === 'new' || sortBy === 'popular') out.reverse();
    } else {
      const order = available.map((c) => 'c:' + c.slug);
      out.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
    }
    return out;
  }

  function renderSections(list) {
    let groups = buildGroups(list);
    if (!showWatched) {
      groups = groups.filter((g) => g.vids.some((v) => !isWatched(v) || v.id === currentId));
    }
    updateCollapseAllLabel(groups);

    const html = groups.map((g) => {
      const open = !collapsed.has(g.key);
      const w = g.vids.filter(isWatched).length;
      const shown = showWatched ? g.vids : g.vids.filter((v) => !isWatched(v) || v.id === currentId);
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
    disarm();
    sectionsEl.innerHTML = html.join('');
  }

  function cardHTML(v) {
    const isW = isWatched(v);
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
    if (mark) { armOrFire(mark, () => withUndo(() => markSectionWatched(mark.getAttribute('data-markkey')))); return; }
    const tog = e.target.closest('.section-toggle');
    if (tog) {
      const k = tog.getAttribute('data-key');
      if (collapsed.has(k)) collapsed.delete(k); else collapsed.add(k);
      render();
      return;
    }
    const chk = e.target.closest('[data-act="toggle"]');
    if (chk) { e.stopPropagation(); armOrFire(chk, () => withUndo(() => toggleWatched(chk.getAttribute('data-id')))); return; }
    const card = e.target.closest('.vcard');
    if (card) play(card.getAttribute('data-id'));
  });

  // Marking watched moves a channel's date cursor (everything before it
  // counts as watched too), so a stray tap is costly. The first tap arms the
  // button ("Tap again"); a second tap within ARM_MS performs the action. Any
  // other tap, a timeout, or a re-render disarms it.
  const ARM_MS = 3000;
  let armed = null;   // { el, timer }
  function disarm() {
    if (!armed) return;
    clearTimeout(armed.timer);
    const el = armed.el; armed = null;
    if (el.isConnected) { el.classList.remove('arm'); el.textContent = '\u2713'; }
  }
  function armOrFire(el, fn) {
    if (armed && armed.el === el) { disarm(); fn(); return; }
    disarm();
    el.classList.add('arm'); el.textContent = 'Tap again';
    armed = { el: el, timer: setTimeout(disarm, ARM_MS) };
  }
  document.addEventListener('click', (e) => { if (armed && !armed.el.contains(e.target)) disarm(); }, true);

  // Undo: the change is applied at once, and a toast offers to put the
  // watched cursors back exactly as they were for UNDO_MS.
  const UNDO_MS = 5000;
  let undo = null;   // { before, timer }
  function hideToast() {
    if (undo) clearTimeout(undo.timer);
    undo = null; toastEl.hidden = true;
  }
  function withUndo(fn) {
    const before = JSON.stringify(watchedTo);
    fn();
    const after = JSON.stringify(watchedTo);
    if (after === before) return;
    hideToast();
    toastMsg.textContent = watchedDelta(JSON.parse(before), watchedTo);
    toastEl.hidden = false;
    undo = { before: before, timer: setTimeout(hideToast, UNDO_MS) };
  }
  // "N marked watched" / "N marked unwatched" — counted across the active list.
  function watchedDelta(prev, next) {
    let more = 0, less = 0;
    baseVideos().forEach((v) => {
      const y = videoYMD(v), was = y <= (prev[v.slug] || 0), now = y <= (next[v.slug] || 0);
      if (now && !was) more++; else if (was && !now) less++;
    });
    const n = more || less, what = more ? 'watched' : 'unwatched';
    return n + (n === 1 ? ' video' : ' videos') + ' marked ' + what;
  }
  toastUndo.addEventListener('click', () => {
    if (!undo) return;
    watchedTo = JSON.parse(undo.before);
    save(LS.watchedTo, watchedTo);
    hideToast();
    render();
  });

  // Section keys are namespaced per group-by mode (y:, b:, c:), so one set
  // holds every mode's open/closed state at once and switching modes brings
  // back whatever was left there. Expand all only touches the current mode.
  collapseAllBtn.addEventListener('click', () => {
    const groups = buildGroups(sortVids(baseVideos()));
    if (collapseAllBtn.dataset.allOpen === 'true') groups.forEach((g) => collapsed.add(g.key));
    else groups.forEach((g) => collapsed.delete(g.key));
    render();
  });

  // ---------------------------------------------------------------------------
  // Watched — per-channel date cursor. A video is watched when its date is on
  // or before its channel's cursor; marking a video watched advances the
  // cursor to that date (never backwards), unmarking pulls the cursor to the
  // channel's latest date strictly before it.
  // ---------------------------------------------------------------------------
  function cursorOf(slug) { return watchedTo[slug] || 0; }
  function isWatched(v) { return videoYMD(v) <= cursorOf(v.slug); }
  function setCursor(slug, ymd) {
    if (ymd > 0) watchedTo[slug] = ymd; else delete watchedTo[slug];
    save(LS.watchedTo, watchedTo);
  }
  // Latest date in the channel strictly before `ymd` (0 if none) — the cursor
  // value that unmarks everything from `ymd` onwards.
  function prevDateBefore(slug, ymd) {
    let prev = 0;
    const cd = channelData[slug];
    if (cd) cd.videos.forEach((v) => { const y = videoYMD(v); if (y < ymd && y > prev) prev = y; });
    return prev;
  }
  function fmtYMDInt(ymd) {
    const y = Math.floor(ymd / 10000), m = Math.floor(ymd / 100) % 100, d = ymd % 100;
    return fmtYMD(y, m, d);
  }
  function toggleWatched(id) {
    const v = findVideo(id);
    if (!v) return;
    if (isWatched(v)) setCursor(v.slug, prevDateBefore(v.slug, videoYMD(v)));
    else setCursor(v.slug, Math.max(cursorOf(v.slug), videoYMD(v)));
    render();
  }
  function markWatched(id) {
    const v = id && findVideo(id);
    if (v) setCursor(v.slug, Math.max(cursorOf(v.slug), videoYMD(v)));
  }
  function markSectionWatched(key) {
    const groups = buildGroups(sortVids(baseVideos()));
    const g = groups.find((x) => x.key === key);
    if (!g) return;
    const allW = g.vids.every(isWatched);
    const perChan = new Map();   // slug -> {min, max} ymd within this section
    g.vids.forEach((v) => {
      const y = videoYMD(v);
      const r = perChan.get(v.slug) || { min: y, max: y };
      r.min = Math.min(r.min, y); r.max = Math.max(r.max, y);
      perChan.set(v.slug, r);
    });
    perChan.forEach((r, slug) => {
      if (allW) { if (cursorOf(slug) >= r.min) setCursor(slug, prevDateBefore(slug, r.min)); }
      else setCursor(slug, Math.max(cursorOf(slug), r.max));
    });
    render();
  }

  // ---------------------------------------------------------------------------
  // Playback (YouTube IFrame API)
  // ---------------------------------------------------------------------------
  let player = null, apiReady = false, pendingId = null;
  let veilState = '', veilTimer = null;

  function findVideo(id) {
    for (const slug in channelData) {
      const hit = channelData[slug].videos.find((v) => v.id === id);
      if (hit) return hit;
    }
    return null;
  }
  function setVeil(state, text) {
    veilState = state;
    if (veilTimer) { clearTimeout(veilTimer); veilTimer = null; }
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
    // Safety net: if the embed can't autoplay (the click gesture doesn't cross
    // into the YouTube iframe), the PLAYING event never fires — so reveal the
    // player anyway after a moment instead of leaving the overlay stuck.
    veilTimer = setTimeout(function () { if (veilState === 'on') setVeil('off'); }, 2500);
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
        onReady: function () { setVeil('off'); },
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
    filtersOpen = !filtersOpen;
    filtersEl.hidden = !filtersOpen;
    filtersToggle.setAttribute('aria-expanded', String(filtersOpen));
  });
  chanAllBtn.addEventListener('click', selectAllChannels);
  chanNoneBtn.addEventListener('click', clearAllChannels);
  filtersReset.addEventListener('click', resetCutoff);
  showWatchedChk.addEventListener('change', () => { showWatched = showWatchedChk.checked; saveShowWatched(); render(); });
  clearWatchedBtn.addEventListener('click', () => {
    if (Object.keys(watchedTo).length) { watchedTo = {}; save(LS.watchedTo, watchedTo); render(); }
  });

  // Year: one slot per year between the oldest video and today. Month: 12
  // slots. Day: one slot per day of the selected month (28–31), so the day
  // slider re-divides itself whenever the year or month changes.
  const yearSlider = slotSlider($('f-year'), {
    valueText: (i) => String(yearRange[i]),
    onPreview: (i) => { yrValue.textContent = String(yearRange[i] || cutoff.y); },
    onChange: (i) => {
      cutoff.y = yearRange[i] || cutoff.y;
      cutoff.d = Math.min(cutoff.d, daysInMonth(cutoff.y, cutoff.m));
      commitCutoff();
    },
  });
  const monthSlider = slotSlider($('f-month'), {
    valueText: (i) => MONTHS[i],
    onPreview: (i) => { moValue.textContent = MONTHS[i]; },
    onChange: (i) => {
      cutoff.m = i + 1;
      cutoff.d = Math.min(cutoff.d, daysInMonth(cutoff.y, cutoff.m));
      commitCutoff();
    },
  });
  const daySlider = slotSlider($('f-day'), {
    valueText: (i) => String(i + 1),
    onPreview: (i) => { dyValue.textContent = String(i + 1); },
    onChange: (i) => {
      cutoff.d = Math.min(i + 1, daysInMonth(cutoff.y, cutoff.m));
      commitCutoff();
    },
  });

  function onSegClick(e) {
    const b = e.target.closest('.seg-btn'); if (!b) return;
    if (b.hasAttribute('data-view')) { view = b.getAttribute('data-view'); save(LS.view, view); }
    else if (b.hasAttribute('data-sort')) { sortBy = b.getAttribute('data-sort'); save(LS.sort, sortBy); }
    else if (b.hasAttribute('data-group')) { groupBy = b.getAttribute('data-group'); save(LS.group, groupBy); }
    else return;   // the funnel button has its own handler
    render();
  }
  toolbar.addEventListener('click', onSegClick);
  resultsBar.addEventListener('click', onSegClick);

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
  // Cross-device sync — no backend. A committed db.json is the shared
  // baseline; localStorage layers on top. Watched cursors merge by taking the
  // later date per channel (never loses progress); per-device prefs fill only
  // when this device hasn't set them. Cutoff stays local (defaults to today).
  // ---------------------------------------------------------------------------
  const SYNC_FILL = [LS.selected, LS.showWatched, LS.cutoff, LS.view, LS.sort, LS.group, LS.tab, LS.tabs];

  async function loadDB() {
    try {
      const res = await fetch('db.json', { cache: 'no-store' });
      if (res.ok) return await res.json();
    } catch (e) {}
    return {};
  }
  function mergeDB(db) {
    if (!db || typeof db !== 'object') return;
    const baseC = (db[LS.watchedTo] && typeof db[LS.watchedTo] === 'object') ? db[LS.watchedTo] : {};
    const localC = load(LS.watchedTo, {});
    const merged = Object.assign({}, localC);
    Object.keys(baseC).forEach((slug) => {
      const y = Number(baseC[slug]) || 0;
      if (y > (merged[slug] || 0)) merged[slug] = y;
    });
    save(LS.watchedTo, merged);
    // Legacy per-video id lists still union; migrateLegacy() converts them to
    // cursors once channel data is loaded.
    const baseW = Array.isArray(db[LS.watched]) ? db[LS.watched] : [];
    const localW = load(LS.watched, []);
    const unionW = Array.from(new Set(baseW.concat(localW)));
    if (unionW.length) save(LS.watched, unionW);
    SYNC_FILL.forEach((k) => {
      if (localStorage.getItem(k) == null && db[k] !== undefined) {
        try { localStorage.setItem(k, JSON.stringify(db[k])); } catch (e) {}
      }
    });
  }
  // Fold any legacy watched-id list into the per-channel cursors: each
  // channel's cursor becomes its latest watched video's date. Requires
  // channel data (id -> date), so runs after loadAll(). Idempotent.
  function migrateLegacy() {
    const ids = load(LS.watched, []);
    if (!Array.isArray(ids) || !ids.length) return;
    const idset = new Set(ids);
    for (const slug in channelData) {
      let max = cursorOf(slug);
      channelData[slug].videos.forEach((v) => {
        if (idset.has(v.id)) { const y = videoYMD(v); if (y > max) max = y; }
      });
      if (max > 0) watchedTo[slug] = max;
    }
    save(LS.watchedTo, watchedTo);
    try { localStorage.removeItem(LS.watched); } catch (e) {}
  }
  // Re-read runtime state from (possibly just-merged) localStorage.
  function reloadState() {
    watchedTo = load(LS.watchedTo, {});
    view = pick(LS.view, VIEWS, 'list');
    sortBy = pick(LS.sort, SORTS, 'old');
    groupBy = pick(LS.group, GROUPS, 'year');
    activeTab = String(load(LS.tab, 'all'));
    const t = load(LS.tabs, {});
    tabs = (t && typeof t === 'object' && !Array.isArray(t)) ? t : {};
    // One-time migration from the pre-groups flat channel selection: the
    // channels that were switched off become the "All" tab's exclusions.
    const savedSel = load(LS.selected, null);
    if (!Array.isArray(tabState('all').off) && Array.isArray(savedSel)) {
      const off = available.map((c) => c.slug).filter((s) => savedSel.indexOf(s) < 0);
      if (off.length) setOff('all', off);
    }
    recomputeSelected();
  }

  function syncNoteMsg(m) { syncNote.textContent = m || ''; }
  function exportData() {
    const out = {};
    Object.values(LS).forEach((k) => {
      const v = localStorage.getItem(k);
      if (v != null) { try { out[k] = JSON.parse(v); } catch (e) {} }
    });
    const text = JSON.stringify(out);
    syncPaste.value = text;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        () => syncNoteMsg('Copied to clipboard — paste it to Claude to save it.'),
        () => { syncPaste.select(); syncNoteMsg('Couldn’t auto-copy — select the text above and copy it.'); }
      );
    } else { syncPaste.select(); syncNoteMsg('Select the text above and copy it.'); }
  }
  function applyPaste() {
    let obj;
    try { obj = JSON.parse(syncPaste.value); } catch (e) { syncNoteMsg('That doesn’t look like valid sync data.'); return; }
    mergeDB(obj);
    reloadState();
    migrateLegacy();
    render();
    syncNoteMsg('Merged. Watched progress and settings updated on this device.');
  }
  syncOpenBtn.addEventListener('click', () => { syncNoteMsg(''); syncPaste.value = ''; syncModal.hidden = false; });
  syncClose.addEventListener('click', () => { syncModal.hidden = true; });
  syncModal.addEventListener('click', (e) => { if (e.target === syncModal) syncModal.hidden = true; });
  syncCopyBtn.addEventListener('click', exportData);
  syncApplyBtn.addEventListener('click', applyPaste);

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------
  (async function boot() {
    loadYouTubeAPI();
    const [db] = await Promise.all([loadDB(), loadIndex(), loadGroups()]);
    mergeDB(db);
    reloadState();
    await loadAll();
    migrateLegacy();
    render();
  })();

  (function hideLoading() {
    const loading = document.getElementById('app-loading');
    if (!loading) return;
    loading.classList.add('hidden'); setTimeout(() => loading.remove(), 500);
  })();
})();
