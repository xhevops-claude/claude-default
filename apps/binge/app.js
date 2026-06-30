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
  };

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

  // ---- runtime state ----
  let available = [];        // [{slug,name,count,url}] from index.json
  let channelData = {};      // slug -> {name, videos:[{id,title,duration,ts,i, slug, channelName}]}
  let currentId = null;      // playing video id
  const unavailable = new Set(); // ids the player refused this session

  // ---- elements ----
  const $ = (id) => document.getElementById(id);
  const playerWrap = $('player-wrap');
  const veil = $('veil'), veilText = $('veil-text'), veilLink = $('veil-link');
  const nowTitle = $('now-title'), nowBy = $('now-by'), ytLink = $('yt-link');
  const watchedNextBtn = $('watched-next'), skipBtn = $('skip');
  const modeTimeline = $('mode-timeline'), modeChannel = $('mode-channel');
  const hideWatchedChk = $('hide-watched');
  const chanStrip = $('chan-strip');
  const progressEl = $('progress'), progressFill = $('progress-fill'), progressText = $('progress-text');
  const queueEl = $('queue');
  const statusPanel = $('status-panel'), statusMsg = $('status-msg'), statusAction = $('status-action');
  const channelsBtn = $('channels-btn');
  const drawer = $('drawer'), drawerClose = $('drawer-close'), drawerSub = $('drawer-sub');
  const chanList = $('chan-list'), clearWatchedBtn = $('clear-watched');
  const quitBtn = $('quit');

  // ---------------------------------------------------------------------------
  // Data loading
  // ---------------------------------------------------------------------------
  async function loadIndex() {
    try {
      const res = await fetch(CDN + 'index.json', { cache: 'no-store' });
      if (!res.ok) throw new Error('index ' + res.status);
      const data = await res.json();
      available = (data.channels || []).filter((c) => c && c.slug);
    } catch (e) {
      available = [];
    }
  }

  async function loadChannel(slug) {
    if (channelData[slug]) return channelData[slug];
    const res = await fetch(CDN + slug + '.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(slug + ' ' + res.status);
    const data = await res.json();
    const videos = (data.videos || []).map((v) => ({
      id: v.id, title: v.title, duration: v.duration, ts: v.ts, i: v.i,
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
  // Ordering
  // ---------------------------------------------------------------------------
  function followedVideos() {
    const out = [];
    available.forEach((c) => {
      if (!follows.has(c.slug)) return;
      const cd = channelData[c.slug];
      if (cd) out.push.apply(out, cd.videos);
    });
    return out;
  }

  // Merged timeline. Sort by real upload time when every video has one;
  // otherwise interleave fairly by each video's normalized position within
  // its own channel (early uploads of all channels first).
  function timelineOrder() {
    const vids = followedVideos();
    if (!vids.length) return [];
    const allTs = vids.every((v) => v.ts);
    if (allTs) return vids.slice().sort((a, b) => a.ts - b.ts);
    const len = {};
    vids.forEach((v) => { len[v.slug] = Math.max(len[v.slug] || 0, v.i + 1); });
    return vids.slice().sort((a, b) => {
      const na = a.i / Math.max(1, (len[a.slug] - 1));
      const nb = b.i / Math.max(1, (len[b.slug] - 1));
      if (na !== nb) return na - nb;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : a.i - b.i;
    });
  }

  function channelOrder() {
    const cd = channelData[activeChannel];
    if (!cd) return [];
    return cd.videos.slice().sort((a, b) => a.i - b.i);
  }

  function currentOrder() {
    return mode === 'channel' ? channelOrder() : timelineOrder();
  }

  function visibleQueue() {
    let q = currentOrder();
    if (hideWatched) q = q.filter((v) => !watched.has(v.id) || v.id === currentId);
    return q;
  }

  function nextUnwatched(after) {
    const order = currentOrder();
    let started = after == null;
    for (const v of order) {
      if (!started) { if (v.id === after) started = true; continue; }
      if (!watched.has(v.id) && !unavailable.has(v.id)) return v;
    }
    // wrap from the top if nothing after the cursor
    for (const v of order) {
      if (v.id === after) break;
      if (!watched.has(v.id) && !unavailable.has(v.id)) return v;
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Rendering
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

  function render() {
    // mode tabs
    modeTimeline.setAttribute('aria-selected', String(mode === 'timeline'));
    modeChannel.setAttribute('aria-selected', String(mode === 'channel'));
    hideWatchedChk.checked = hideWatched;

    const anyFollowed = available.some((c) => follows.has(c.slug));

    // channel strip (only in channel mode)
    if (mode === 'channel' && anyFollowed) {
      chanStrip.hidden = false;
      renderChanStrip();
    } else {
      chanStrip.hidden = true;
    }

    // empty states
    if (!available.length) {
      showStatus('🍿', 'No channel data yet. The scraper publishes channels to the CDN on a daily schedule (and right after the list changes). Check back in a few minutes.', null);
      hideQueueChrome();
      return;
    }
    if (!anyFollowed) {
      showStatus('📺', 'Follow a channel to start your binge.', 'Open channels', openDrawer);
      hideQueueChrome();
      return;
    }

    const order = currentOrder();
    const q = visibleQueue();
    const total = order.length;
    const watchedCount = order.filter((v) => watched.has(v.id)).length;

    // progress
    progressEl.hidden = false;
    progressFill.style.width = total ? (watchedCount / total * 100) + '%' : '0%';
    progressText.textContent = watchedCount + ' / ' + total + ' watched';

    if (!q.length) {
      queueEl.innerHTML = '';
      showStatus('🎉', total ? 'All caught up here — nothing left to watch.' : 'This channel has no videos yet.', null);
      return;
    }
    statusPanel.hidden = true;
    renderQueue(q);
  }

  function hideQueueChrome() {
    progressEl.hidden = true;
    queueEl.innerHTML = '';
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

  function renderQueue(q) {
    const rows = q.map((v) => {
      const isWatched = watched.has(v.id);
      const isPlaying = v.id === currentId;
      const cls = 'q-item' + (isWatched ? ' watched' : '') + (isPlaying ? ' playing' : '');
      const sub = [];
      if (mode === 'timeline') sub.push('<span>' + escapeHTML(v.channelName) + '</span>');
      if (v.duration) sub.push('<span>' + fmtDur(v.duration) + '</span>');
      if (unavailable.has(v.id)) sub.push('<span class="q-badge">unavailable</span>');
      return '<div class="' + cls + '" data-id="' + escapeHTML(v.id) + '">'
        + '<button class="q-check" data-act="toggle" data-id="' + escapeHTML(v.id) + '" aria-label="Toggle watched">✓</button>'
        + '<div class="q-body">'
        + '<div class="q-title">' + escapeHTML(v.title) + '</div>'
        + '<div class="q-sub">' + sub.join('') + '</div>'
        + '</div></div>';
    });
    queueEl.innerHTML = rows.join('');
  }

  // delegated queue clicks
  queueEl.addEventListener('click', (e) => {
    const toggle = e.target.closest('[data-act="toggle"]');
    if (toggle) { e.stopPropagation(); toggleWatched(toggle.getAttribute('data-id')); return; }
    const item = e.target.closest('.q-item');
    if (item) play(item.getAttribute('data-id'));
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

  // ---------------------------------------------------------------------------
  // Playback (YouTube IFrame API)
  // ---------------------------------------------------------------------------
  let player = null, playerReady = false, pendingId = null;

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
    nowBy.textContent = v.channelName;
    const url = 'https://www.youtube.com/watch?v=' + id;
    ytLink.href = url; veilLink.href = url;
    setVeil('on', 'Loading…');
    render();
    try { playerWrap.scrollIntoView({ block: 'start', behavior: 'smooth' }); } catch (e) {}
    if (!playerReady) { pendingId = id; return; }
    try { player.loadVideoById(id); } catch (e) { onPlayerError(); }
  }

  function advance() {
    const next = nextUnwatched(currentId);
    if (next) play(next.id);
    else { currentId = null; render(); }
  }

  function onPlayerError() {
    if (currentId) unavailable.add(currentId);
    setVeil('lost', 'Can’t embed this one');
    render();
  }

  window.onYouTubeIframeAPIReady = function () {
    player = new YT.Player('player', {
      width: '100%', height: '100%',
      playerVars: { autoplay: 1, rel: 0, modestbranding: 1, playsinline: 1 },
      events: {
        onReady: function () {
          playerReady = true;
          if (pendingId) { const id = pendingId; pendingId = null; play(id); }
        },
        onStateChange: function (e) {
          if (e.data === YT.PlayerState.PLAYING || e.data === YT.PlayerState.BUFFERING) setVeil('off');
          if (e.data === YT.PlayerState.ENDED) { markWatched(currentId); advance(); }
        },
        onError: function () { onPlayerError(); },
      },
    });
  };

  function loadYouTubeAPI() {
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(tag);
  }

  // ---------------------------------------------------------------------------
  // Drawer (channel follow management)
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
    if (follows.has(slug)) {
      follows.delete(slug);
    } else {
      follows.add(slug);
      try { await loadChannel(slug); } catch (e) { /* surfaced as 0 videos */ }
    }
    save(LS.follows, Array.from(follows));
    renderDrawer();
    render();
  }

  function openDrawer() { renderDrawer(); drawer.hidden = false; }
  function closeDrawer() { drawer.hidden = true; }

  // ---------------------------------------------------------------------------
  // Wiring
  // ---------------------------------------------------------------------------
  modeTimeline.addEventListener('click', () => { mode = 'timeline'; save(LS.mode, mode); render(); });
  modeChannel.addEventListener('click', () => { mode = 'channel'; save(LS.mode, mode); render(); });
  hideWatchedChk.addEventListener('change', () => { hideWatched = hideWatchedChk.checked; save(LS.hide, hideWatched); render(); });

  watchedNextBtn.addEventListener('click', () => { markWatched(currentId); advance(); });
  skipBtn.addEventListener('click', advance);

  channelsBtn.addEventListener('click', openDrawer);
  drawerClose.addEventListener('click', closeDrawer);
  clearWatchedBtn.addEventListener('click', () => {
    if (!watched.size) return;
    watched = new Set();
    save(LS.watched, []);
    renderDrawer(); render();
  });

  function quit() {
    if (player && playerReady) { try { player.stopVideo(); } catch (e) {} }
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
