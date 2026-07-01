(function () {
  'use strict';

  // Channel data is published, decoupled from this app, by the
  // youtube-refresh workflow to the live CDN. We always read the
  // production path (works in preview deploys and local dev too).
  const CDN = 'https://xhevops-claude.github.io/claude-default/cdn/youtube/';

  const LS = {
    follows: 'binge-follows',
    watched: 'binge-watched',
    mode: 'binge-mode',
    hide: 'binge-hidewatched',
    chan: 'binge-active-channel',
    filter: 'binge-filter',
    filtersOpen: 'binge-filters-open',
  };

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // ---- persisted state ----
  function load(key, fallback) {
    try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); }
    catch (e) { return fallback; }
  }
  function save(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {} }

  let follows = new Set(load(LS.follows, []));
  let watched = new Set(load(LS.watched, []));
  let mode = load(LS.mode, 'timeline');           // 'timeline' | 'channel'
  let hideWatched = load(LS.hide, false);
  let activeChannel = load(LS.chan, null);        // slug for 'channel' mode
  let filter = load(LS.filter, { year: 'any', month: 'any', day: 'any' });
  let filtersOpen = load(LS.filtersOpen, true);   // whole filter section

  // ---- runtime state ----
  let available = [];        // [{slug,name,count,url}] from index.json
  let channelData = {};      // slug -> {name, videos:[...] }
  let currentId = null;      // playing video id
  const unavailable = new Set();
  const expandedYears = new Set();  // which year groups are open

  // ---- elements ----
  const $ = (id) => document.getElementById(id);
  const playerWrap = $('player-wrap');
  const veil = $('veil'), veilText = $('veil-text'), veilLink = $('veil-link');
  const nowTitle = $('now-title'), nowBy = $('now-by'), ytLink = $('yt-link');
  const watchedNextBtn = $('watched-next'), skipBtn = $('skip'), closePlayerBtn = $('close-player');
  const modeTimeline = $('mode-timeline'), modeChannel = $('mode-channel');
  const hideWatchedChk = $('hide-watched');
  const chanStrip = $('chan-strip');
  const filtersEl = $('filters'), filtersReset = $('filters-reset');
  const filtersToggle = $('filters-toggle'), filtersBody = $('filters-body'), filtersSummary = $('filters-summary');
  const progressEl = $('progress'), progressFill = $('progress-fill'), progressText = $('progress-text');
  const resultsBar = $('results-bar'), resultsCount = $('results-count'), collapseAllBtn = $('collapse-all');
  const yearsEl = $('years');
  const statusPanel = $('status-panel'), statusMsg = $('status-msg'), statusAction = $('status-action');
  const channelsBtn = $('channels-btn');
  const drawer = $('drawer'), drawerClose = $('drawer-close'), drawerSub = $('drawer-sub');
  const chanList = $('chan-list'), clearWatchedBtn = $('clear-watched');
  const quitBtn = $('quit');
  // sliders
  const fYear = $('f-year'), fMonth = $('f-month'), fDay = $('f-day');
  const yrValue = $('yr-value'), moValue = $('mo-value'), dyValue = $('dy-value');

  // ---------------------------------------------------------------------------
  // Data loading
  // ---------------------------------------------------------------------------
  async function loadIndex() {
    try {
      const res = await fetch(CDN + 'index.json', { cache: 'no-store' });
      if (!res.ok) throw new Error('index ' + res.status);
      const data = await res.json();
      available = (data.channels || []).filter((c) => c && c.slug);
    } catch (e) { available = []; }
  }

  async function loadChannel(slug) {
    if (channelData[slug]) return channelData[slug];
    const res = await fetch(CDN + slug + '.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(slug + ' ' + res.status);
    const data = await res.json();
    const videos = (data.videos || []).map((v) => ({
      id: v.id, title: v.title, duration: v.duration, ts: v.ts, d: v.d, i: v.i,
      slug: slug, channelName: data.name || slug,
    }));
    channelData[slug] = { name: data.name || slug, videos: videos };
    return channelData[slug];
  }

  async function loadFollowed() {
    const slugs = available.map((c) => c.slug).filter((s) => follows.has(s));
    await Promise.all(slugs.map((s) => loadChannel(s).catch(() => null)));
  }

  // ---------------------------------------------------------------------------
  // Dates
  // ---------------------------------------------------------------------------
  // Precise date (`d` = YYYYMMDD) when we have it; else derive the year from
  // the approximate listing timestamp (`ts`), leaving month/day unknown.
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
  function fmtDate(v) {
    const dt = vidDate(v);
    if (dt.precise) return dt.day + ' ' + MONTHS[dt.m - 1] + ' ' + dt.y;
    if (dt.y) return String(dt.y);
    return '—';
  }

  // ---------------------------------------------------------------------------
  // Ordering + filtering
  // ---------------------------------------------------------------------------
  function modeVideos() {
    if (mode === 'channel') {
      const cd = channelData[activeChannel];
      return cd ? cd.videos.slice() : [];
    }
    const out = [];
    available.forEach((c) => {
      if (!follows.has(c.slug)) return;
      const cd = channelData[c.slug];
      if (cd) out.push.apply(out, cd.videos);
    });
    return out;
  }

  // Chronological, oldest first.
  function orderedVideos() {
    return modeVideos().sort((a, b) => sortEpoch(a) - sortEpoch(b) || a.i - b.i);
  }

  function passesDate(v) {
    const dt = vidDate(v);
    if (filter.year !== 'any' && dt.y !== filter.year) return false;
    if (filter.month !== 'any' && dt.m !== filter.month) return false;
    if (filter.day !== 'any' && dt.day !== filter.day) return false;
    return true;
  }

  // Videos matching the date filter, chronological. Drives playback order.
  function filteredVideos() {
    return orderedVideos().filter(passesDate);
  }

  function availableYears() {
    const set = new Set();
    orderedVideos().forEach((v) => { const y = vidDate(v).y; if (y) set.add(y); });
    return Array.from(set).sort((a, b) => a - b);
  }

  function nextUnwatched(after) {
    const order = filteredVideos();
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
  // Helpers
  // ---------------------------------------------------------------------------
  function fmtDur(s) {
    if (!s && s !== 0) return '';
    s = Math.round(s);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    const mm = h ? String(m).padStart(2, '0') : String(m);
    return (h ? h + ':' : '') + mm + ':' + String(sec).padStart(2, '0');
  }
  function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------
  function render() {
    modeTimeline.setAttribute('aria-selected', String(mode === 'timeline'));
    modeChannel.setAttribute('aria-selected', String(mode === 'channel'));
    hideWatchedChk.checked = hideWatched;

    const anyFollowed = available.some((c) => follows.has(c.slug));

    if (mode === 'channel' && anyFollowed) { chanStrip.hidden = false; renderChanStrip(); }
    else chanStrip.hidden = true;

    if (!available.length) {
      showStatus('🍿', 'No channel data yet. The scraper publishes channels to the CDN daily (and right after the list changes). Check back in a few minutes.', null);
      hideBrowse();
      return;
    }
    if (!anyFollowed) {
      showStatus('📺', 'Follow a channel to start your binge.', 'Open channels', openDrawer);
      hideBrowse();
      return;
    }

    filtersEl.hidden = false;
    renderFilters();

    const filtered = filteredVideos();
    const total = filtered.length;
    const watchedCount = filtered.filter((v) => watched.has(v.id)).length;

    progressEl.hidden = false;
    progressFill.style.width = total ? (watchedCount / total * 100) + '%' : '0%';
    progressText.textContent = watchedCount + ' / ' + total + ' watched';

    if (!total) {
      resultsBar.hidden = true;
      yearsEl.innerHTML = '';
      showStatus('🔍', 'Nothing matches this date filter.', 'Reset filter', resetFilter);
      return;
    }
    statusPanel.hidden = true;
    resultsBar.hidden = false;
    resultsCount.textContent = total + (total === 1 ? ' video' : ' videos');
    renderAccordion(filtered);
  }

  function hideBrowse() {
    filtersEl.hidden = true;
    progressEl.hidden = true;
    resultsBar.hidden = true;
    yearsEl.innerHTML = '';
  }

  function showStatus(icon, msg, actionLabel, actionFn) {
    statusPanel.hidden = false;
    statusPanel.querySelector('.status-icon').textContent = icon;
    statusMsg.textContent = msg;
    if (actionLabel) {
      statusAction.hidden = false;
      statusAction.textContent = actionLabel;
      statusAction.onclick = actionFn || null;
    } else {
      statusAction.hidden = true;
      statusAction.onclick = null;
    }
  }

  // ---- filters / sliders ----
  function renderFilters() {
    // Month/Day filtering needs exact dates. Those only exist when the
    // scraper runs with an authenticated session (YT_COOKIES); otherwise we
    // have year-level data only, so hide the finer sliders rather than show
    // dead controls. They reappear automatically once exact dates arrive.
    const hasPrecise = orderedVideos().some((v) => v.d);
    document.getElementById('ds-month').hidden = !hasPrecise;
    document.getElementById('ds-day').hidden = !hasPrecise;
    if (!hasPrecise && (filter.month !== 'any' || filter.day !== 'any')) {
      filter.month = 'any'; filter.day = 'any'; save(LS.filter, filter);
    }

    const years = availableYears();

    // Year slider maps index 0 -> Any, 1..n -> years[n-1].
    fYear.max = String(years.length);
    let yIdx = 0;
    if (filter.year !== 'any') {
      const at = years.indexOf(filter.year);
      if (at === -1) { filter.year = 'any'; } else { yIdx = at + 1; }
    }
    fYear.value = String(yIdx);
    yrValue.textContent = filter.year === 'any' ? 'Any' : String(filter.year);

    fMonth.value = String(filter.month === 'any' ? 0 : filter.month);
    moValue.textContent = filter.month === 'any' ? 'Any' : MONTHS[filter.month - 1];

    fDay.value = String(filter.day === 'any' ? 0 : filter.day);
    dyValue.textContent = filter.day === 'any' ? 'Any' : String(filter.day);

    filtersSummary.textContent = filterSummaryText();
    applyFiltersOpen();
  }
  function filterSummaryText() {
    if (filter.year === 'any' && filter.month === 'any' && filter.day === 'any') return 'All dates';
    const parts = [filter.year === 'any' ? 'Any year' : String(filter.year)];
    if (filter.month !== 'any') parts.push(MONTHS[filter.month - 1]);
    if (filter.day !== 'any') parts.push('Day ' + filter.day);
    return parts.join(' · ');
  }
  function applyFiltersOpen() {
    filtersBody.hidden = !filtersOpen;
    filtersToggle.setAttribute('aria-expanded', String(filtersOpen));
    filtersToggle.classList.toggle('open', filtersOpen);
  }
  function commitFilter() {
    save(LS.filter, filter);
    // auto-expand the year that's now in focus so results are visible
    if (filter.year !== 'any') expandedYears.add(filter.year);
    render();
  }
  function resetFilter() {
    filter = { year: 'any', month: 'any', day: 'any' };
    save(LS.filter, filter);
    render();
  }

  function renderChanStrip() {
    const followed = available.filter((c) => follows.has(c.slug));
    if (!activeChannel || !follows.has(activeChannel)) {
      activeChannel = followed.length ? followed[0].slug : null;
      save(LS.chan, activeChannel);
    }
    chanStrip.innerHTML = '';
    followed.forEach((c) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chan-chip';
      b.setAttribute('aria-pressed', String(c.slug === activeChannel));
      b.textContent = (channelData[c.slug] && channelData[c.slug].name) || c.name || c.slug;
      b.addEventListener('click', () => { activeChannel = c.slug; save(LS.chan, activeChannel); render(); });
      chanStrip.appendChild(b);
    });
  }

  // ---- accordion ----
  function renderAccordion(filtered) {
    // group by year (descending years unusual for binge; keep oldest first)
    const groups = new Map();
    filtered.forEach((v) => {
      const y = vidDate(v).y || 0;
      if (!groups.has(y)) groups.set(y, []);
      groups.get(y).push(v);
    });
    const years = Array.from(groups.keys()).sort((a, b) => a - b);

    // If nothing is explicitly expanded and there's just one year, open it.
    if (!expandedYears.size && years.length === 1) expandedYears.add(years[0]);
    updateCollapseAllLabel(years);

    const html = years.map((y) => {
      const vids = groups.get(y);
      const open = expandedYears.has(y);
      const w = vids.filter((v) => watched.has(v.id)).length;
      const shown = hideWatched ? vids.filter((v) => !watched.has(v.id) || v.id === currentId) : vids;
      const body = open
        ? '<div class="year-videos">' + shown.map(itemHTML).join('') + '</div>'
        : '';
      const allWatched = w === vids.length;
      return '<div class="year-group' + (open ? ' open' : '') + '">'
        + '<div class="year-head">'
        + '<button class="year-toggle" type="button" data-year="' + y + '" aria-expanded="' + open + '">'
        + '<span class="year-chev" aria-hidden="true">▸</span>'
        + '<span class="year-label">' + (y || 'Undated') + '</span>'
        + '<span class="year-count">' + w + ' / ' + vids.length + '</span>'
        + '</button>'
        + '<button class="year-markall' + (allWatched ? ' done' : '') + '" type="button" data-markyear="' + y + '" '
        + 'title="Mark this whole year watched" aria-label="Mark ' + (y || 'undated') + ' watched">✓ year</button>'
        + '</div>' + body + '</div>';
    });
    yearsEl.innerHTML = html.join('');
  }

  function itemHTML(v) {
    const isWatched = watched.has(v.id);
    const isPlaying = v.id === currentId;
    const cls = 'q-item' + (isWatched ? ' watched' : '') + (isPlaying ? ' playing' : '');
    const sub = ['<span class="q-date">' + escapeHTML(fmtDate(v)) + '</span>'];
    if (mode === 'timeline') sub.push('<span>' + escapeHTML(v.channelName) + '</span>');
    if (v.duration) sub.push('<span>' + fmtDur(v.duration) + '</span>');
    if (unavailable.has(v.id)) sub.push('<span class="q-badge">unavailable</span>');
    return '<div class="' + cls + '" data-id="' + escapeHTML(v.id) + '">'
      + '<button class="q-check" data-act="toggle" data-id="' + escapeHTML(v.id) + '" aria-label="Toggle watched">✓</button>'
      + '<div class="q-body">'
      + '<div class="q-title">' + escapeHTML(v.title) + '</div>'
      + '<div class="q-sub">' + sub.join('') + '</div>'
      + '</div></div>';
  }

  function updateCollapseAllLabel(years) {
    const allOpen = years.length > 0 && years.every((y) => expandedYears.has(y));
    collapseAllBtn.textContent = allOpen ? 'Collapse all' : 'Expand all';
    collapseAllBtn.dataset.allOpen = String(allOpen);
  }

  // ---- delegated clicks ----
  yearsEl.addEventListener('click', (e) => {
    const markYear = e.target.closest('[data-markyear]');
    if (markYear) { markYearWatched(Number(markYear.getAttribute('data-markyear'))); return; }
    const ytoggle = e.target.closest('.year-toggle');
    if (ytoggle) {
      const y = Number(ytoggle.getAttribute('data-year'));
      if (expandedYears.has(y)) expandedYears.delete(y); else expandedYears.add(y);
      render();
      return;
    }
    const toggle = e.target.closest('[data-act="toggle"]');
    if (toggle) { e.stopPropagation(); toggleWatched(toggle.getAttribute('data-id')); return; }
    const item = e.target.closest('.q-item');
    if (item) play(item.getAttribute('data-id'));
  });

  collapseAllBtn.addEventListener('click', () => {
    if (collapseAllBtn.dataset.allOpen === 'true') expandedYears.clear();
    else { const shown = new Set(filteredVideos().map((v) => vidDate(v).y || 0)); shown.forEach((y) => expandedYears.add(y)); }
    render();
  });

  // ---------------------------------------------------------------------------
  // Watched tracking
  // ---------------------------------------------------------------------------
  function toggleWatched(id) {
    if (watched.has(id)) watched.delete(id); else watched.add(id);
    save(LS.watched, Array.from(watched));
    render();
  }
  function markWatched(id) {
    if (!id) return;
    watched.add(id);
    save(LS.watched, Array.from(watched));
  }
  // Mark (or, if already fully watched, un-mark) every video in a year.
  function markYearWatched(y) {
    const vids = modeVideos().filter((v) => (vidDate(v).y || 0) === y);
    if (!vids.length) return;
    const allWatched = vids.every((v) => watched.has(v.id));
    vids.forEach((v) => { if (allWatched) watched.delete(v.id); else watched.add(v.id); });
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
    if (!player) { startPlayer(id); return; }  // build once, in the now-visible container
    try { player.loadVideoById(id); } catch (e) { onPlayerError(); }
  }
  // Create the player the first time we actually play something, so it's
  // built inside a visible container (autoplay is unreliable otherwise).
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
    currentId = null;
    playerWrap.hidden = true;
    setVeil('off');
    render();
  }
  function advance() {
    const next = nextUnwatched(currentId);
    if (next) play(next.id);
    else { closePlayer(); }
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
  // Drawer
  // ---------------------------------------------------------------------------
  function renderDrawer() {
    drawerSub.textContent = available.length
      ? 'Follow channels to add them to your binge.'
      : 'No channels published yet — the scraper runs daily.';
    chanList.innerHTML = '';
    available.forEach((c) => {
      const li = document.createElement('li');
      li.className = 'chan-row';
      const followed = follows.has(c.slug);
      li.innerHTML =
        '<div class="chan-row-body">'
        + '<div class="chan-row-name">' + escapeHTML(c.name || c.slug) + '</div>'
        + '<div class="chan-row-meta">' + (c.count || 0) + ' videos</div>'
        + '</div>'
        + '<button type="button" class="follow-btn" aria-pressed="' + followed + '">'
        + (followed ? 'Following' : 'Follow') + '</button>';
      li.querySelector('.follow-btn').addEventListener('click', () => toggleFollow(c.slug));
      chanList.appendChild(li);
    });
  }
  async function toggleFollow(slug) {
    if (follows.has(slug)) follows.delete(slug);
    else { follows.add(slug); try { await loadChannel(slug); } catch (e) {} }
    save(LS.follows, Array.from(follows));
    renderDrawer(); render();
  }
  function openDrawer() { renderDrawer(); drawer.hidden = false; }
  function closeDrawer() { drawer.hidden = true; }

  // ---------------------------------------------------------------------------
  // Wiring
  // ---------------------------------------------------------------------------
  modeTimeline.addEventListener('click', () => { mode = 'timeline'; save(LS.mode, mode); expandedYears.clear(); render(); });
  modeChannel.addEventListener('click', () => { mode = 'channel'; save(LS.mode, mode); expandedYears.clear(); render(); });
  hideWatchedChk.addEventListener('change', () => { hideWatched = hideWatchedChk.checked; save(LS.hide, hideWatched); render(); });
  filtersReset.addEventListener('click', resetFilter);

  // whole filter section collapses/expands
  filtersToggle.addEventListener('click', () => {
    filtersOpen = !filtersOpen; save(LS.filtersOpen, filtersOpen); applyFiltersOpen();
  });

  fYear.addEventListener('input', () => {
    const years = availableYears();
    const idx = Number(fYear.value);
    filter.year = idx === 0 ? 'any' : years[idx - 1];
    yrValue.textContent = filter.year === 'any' ? 'Any' : String(filter.year);
    commitFilter();
  });
  fMonth.addEventListener('input', () => {
    const m = Number(fMonth.value);
    filter.month = m === 0 ? 'any' : m;
    moValue.textContent = filter.month === 'any' ? 'Any' : MONTHS[filter.month - 1];
    commitFilter();
  });
  fDay.addEventListener('input', () => {
    const d = Number(fDay.value);
    filter.day = d === 0 ? 'any' : d;
    dyValue.textContent = filter.day === 'any' ? 'Any' : String(filter.day);
    commitFilter();
  });

  watchedNextBtn.addEventListener('click', () => { markWatched(currentId); advance(); });
  skipBtn.addEventListener('click', advance);
  closePlayerBtn.addEventListener('click', closePlayer);

  channelsBtn.addEventListener('click', openDrawer);
  drawerClose.addEventListener('click', closeDrawer);
  clearWatchedBtn.addEventListener('click', () => {
    if (!watched.size) return;
    watched = new Set();
    save(LS.watched, []);
    renderDrawer(); render();
  });

  function quit() {
    if (player) { try { player.stopVideo(); } catch (e) {} }
    if (window.self !== window.top) {
      try { window.parent.postMessage({ type: 'close-game' }, '*'); } catch (e) {}
    } else { location.href = '../../'; }
  }
  quitBtn.addEventListener('click', quit);

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------
  (async function boot() {
    loadYouTubeAPI();
    await loadIndex();
    await loadFollowed();
    render();
  })();

  (function hideLoading() {
    const loading = document.getElementById('app-loading');
    if (!loading) return;
    const navStart = (performance && performance.timeOrigin) || Date.now();
    const elapsed = Date.now() - navStart;
    const remaining = Math.max(0, 3000 - elapsed); // mandatory ≥3s splash
    setTimeout(() => {
      loading.classList.add('hidden');
      setTimeout(() => loading.remove(), 500);
    }, remaining);
  })();
})();
