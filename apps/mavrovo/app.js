(function () {
  'use strict';

  // ---------------- Constants ----------------
  const MIN_SPLASH_MS = 3000;   // repo-mandated splash minimum
  const SPLASH_HARD_CAP_MS = 8000; // hide even if fetches hang
  const THEME_KEY = 'mavrovo-theme';
  const LANG_KEY = 'mavrovo-lang';
  const TAB_KEY = 'mavrovo-tab';
  const WX_KEY = 'mavrovo-wx';

  const PMTILES_URL =
    'https://xhevops-claude.github.io/claude-default/cdn/maps/pmtiles/north-macedonia.pmtiles';
  const MAPLIBRE_JS = 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js';
  const MAPLIBRE_CSS = 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css';
  const PMTILES_JS = 'https://unpkg.com/pmtiles@3.2.1/dist/pmtiles.js';

  const MAP_CENTER = [20.72, 41.64];
  const MAP_ZOOM = 10;
  const MAP_MIN_ZOOM = 7;
  const TEXT_FONT = ['Noto Sans Regular'];

  // Sun position reference point (park centre-ish).
  const SUN_LAT = 41.66;
  const SUN_LON = 20.74;

  const WX_POINTS = [
    { key: 'valley', lat: 41.655, lon: 20.740, elev: 1240, labelKey: 'wx.valley' },
    { key: 'ridge', lat: 41.615, lon: 20.669, elev: 2163, labelKey: 'wx.ridge' },
  ];

  // WMO weather code → emoji.
  const WMO_EMOJI = {
    0: '☀️', 1: '🌤️', 2: '⛅', 3: '☁️',
    45: '🌫️', 48: '🌫️',
    51: '🌦️', 53: '🌦️', 55: '🌧️', 56: '🌧️', 57: '🌧️',
    61: '🌦️', 63: '🌧️', 65: '🌧️', 66: '🌧️', 67: '🌧️',
    71: '🌨️', 73: '🌨️', 75: '❄️', 77: '❄️',
    80: '🌦️', 81: '🌧️', 82: '⛈️',
    85: '🌨️', 86: '❄️',
    95: '⛈️', 96: '⛈️', 99: '⛈️',
  };

  const DIFF_COLORS = {
    easy: '#3fae7c',
    moderate: '#d9a94a',
    hard: '#e0564a',
    alpine: '#9d7bde',
  };

  // Tiny inline SVG glyphs for JS-rendered chrome (no emoji clutter).
  const SVG_WARN = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex:0 0 auto;margin-top:2px"><path d="M12 3.6 L21.6 20 H2.4 Z"></path><path d="M12 9.6v4.6"></path><circle cx="12" cy="17" r="0.5" fill="currentColor"></circle></svg>';
  const SUN_ICONS = {
    sunrise: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 17h16M8.2 13.4a4 4 0 0 1 7.6 0"></path><path d="M12 4.6v3.2M5.6 8.4l1.8 1.6M18.4 8.4l-1.8 1.6"></path><path d="M10 2.8l2-2.1 2 2.1" transform="translate(0 3)"></path></svg>',
    sunset: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 17h16M8.2 13.4a4 4 0 0 1 7.6 0"></path><path d="M12 3.4v3.4M5.6 8.4l1.8 1.6M18.4 8.4l-1.8 1.6"></path></svg>',
    daylight: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"></circle><path d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6"></path></svg>',
  };

  const OSM_KIND_ICONS = { spring: '💧', drinking_water: '🚰', shelter: '⛺' };

  const TABS = ['today', 'map', 'trails', 'places', 'info'];

  // ---------------- State ----------------
  let lang = document.documentElement.lang === 'mk' ? 'mk' : 'en';
  let theme = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
  let dict = null;
  const data = { park: null, pois: null, trails: null, events: null, status: null };
  const failed = {}; // sectionKey -> true when its fetch failed
  const geo = { boundary: null, trails: null, osmPois: null };
  let wxState = null; // { ts, valley, ridge, cached } | { error: true }
  let activeTab = 'today';
  let openTrailId = null;
  let openPlaceId = null;
  const filters = { diff: 'all', kids: false };

  // Map state
  let mapInstance = null;
  let mapLoaded = false;
  let mapErrorShown = false;
  let tilesLoaded = 0;
  let overlaysRequested = false;
  let overlaysSettled = false;
  let retryInFlight = false;
  let pendingMapAction = null;
  let pinMarker = null;
  let osmVisible = true;
  let pillState = null; // { state, key, raw }

  // Geolocation state
  let watchId = null;
  let geoWatchdog = null;
  let lastFix = null; // { lon, lat, accuracy, ts }
  let geoSuspended = false;

  // ---------------- Tiny helpers ----------------
  function $(id) { return document.getElementById(id); }

  function escapeHTML(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  function t(key) {
    if (dict && dict[key]) {
      return dict[key][lang] || dict[key].en || key;
    }
    return key;
  }

  function pick(obj) {
    // { mk, en } → current language, with fallback.
    if (obj == null) return '';
    if (typeof obj === 'string') return obj;
    return obj[lang] || obj.en || obj.mk || '';
  }

  function locale() { return lang === 'mk' ? 'mk-MK' : 'en-GB'; }

  function fmtNum(n, digits) {
    if (n == null || isNaN(n)) return '—';
    let s = Number(n).toFixed(digits || 0);
    if (lang === 'mk') s = s.replace('.', ',');
    return s;
  }

  function safeUrl(u) {
    // Only http(s) URLs may reach href attributes (JSON is data, not code).
    try {
      const p = new URL(u, location.href);
      return (p.protocol === 'https:' || p.protocol === 'http:') ? p.href : '';
    } catch (_) { return ''; }
  }

  function fetchJSON(url) {
    return fetch(url, { cache: 'no-cache' }).then((r) => {
      if (!r.ok) return Promise.reject(new Error('HTTP ' + r.status + ' ' + url));
      return r.json();
    });
  }

  function sectionErrorHTML() {
    return '<div class="error-strip">' + SVG_WARN + '<span>' +
      escapeHTML(t('common.sectionError')) + '</span></div>';
  }

  // ---------------- i18n ----------------
  function applyStatic() {
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      if (dict && dict[key]) el.textContent = t(key);
    });
    document.querySelectorAll('[data-i18n-aria]').forEach((el) => {
      const key = el.getAttribute('data-i18n-aria');
      if (dict && dict[key]) el.setAttribute('aria-label', t(key));
    });
  }

  function setLang(next, persist) {
    if (next !== 'mk' && next !== 'en') return;
    lang = next;
    document.documentElement.lang = next;
    if (persist !== false) {
      try { localStorage.setItem(LANG_KEY, next); } catch (_) {}
    }
    syncLangButtons();
    applyStatic();
    renderDynamic();
    refreshMapLang();
  }

  function syncLangButtons() {
    $('lang-mk').setAttribute('aria-pressed', lang === 'mk' ? 'true' : 'false');
    $('lang-en').setAttribute('aria-pressed', lang === 'en' ? 'true' : 'false');
  }

  // ---------------- Theme ----------------
  function setTheme(next, persist) {
    theme = next === 'light' ? 'light' : 'dark';
    document.documentElement.dataset.theme = theme;
    if (persist !== false) {
      try { localStorage.setItem(THEME_KEY, theme); } catch (_) {}
    }
    if (mapInstance && typeof maplibregl !== 'undefined') {
      mapInstance.setStyle(buildStyle(theme), { diff: false });
    }
  }

  // ---------------- Tabs ----------------
  function switchTab(name, persist) {
    if (TABS.indexOf(name) === -1) name = 'today';
    activeTab = name;
    TABS.forEach((tab) => {
      const panel = $('panel-' + tab);
      const btn = $('tab-' + tab);
      const on = tab === name;
      if (panel) panel.hidden = !on;
      if (btn) btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    if (persist !== false) {
      try { localStorage.setItem(TAB_KEY, name); } catch (_) {}
    }
    if (name === 'map') {
      ensureMap();
      if (mapInstance) {
        requestAnimationFrame(() => { try { mapInstance.resize(); } catch (_) {} });
        runPendingMapAction();
      }
    }
  }

  // ---------------- Boot data ----------------
  const CORE_FILES = [
    ['i18n', 'data/i18n.json'],
    ['park', 'data/park.json'],
    ['pois', 'data/pois.json'],
    ['trails', 'data/trails.json'],
    ['events', 'data/events.json'],
    ['status', 'data/status.json'],
  ];

  function loadCore() {
    Promise.allSettled(CORE_FILES.map((f) => fetchJSON(f[1]))).then((results) => {
      results.forEach((res, i) => {
        const key = CORE_FILES[i][0];
        if (res.status === 'fulfilled') {
          if (key === 'i18n') dict = res.value;
          else data[key] = res.value;
        } else {
          failed[key] = true;
          console.warn('Failed to load', key, res.reason);
        }
      });
      applyStatic();
      syncLangButtons();
      renderDynamic();
      // The map may have finished loading before core data arrived (persisted
      // 'map' tab boots it in parallel) — refresh icons, sources and styling.
      if (mapInstance && mapLoaded) {
        registerMapIcons();
        addOverlays();
        try {
          if (mapInstance.getLayer('park-trails-line')) {
            mapInstance.setPaintProperty('park-trails-line', 'line-color', trailColorExpr());
          }
          if (mapInstance.getSource('park-pois')) {
            mapInstance.getSource('park-pois').setData(parkPoiFC());
          }
        } catch (_) {}
        runPendingMapAction();
      }
      splashWhenReady();
    });
  }

  // ---------------- Splash ----------------
  let splashHidden = false;
  function hideSplash() {
    if (splashHidden) return;
    splashHidden = true;
    const el = $('app-loading');
    if (!el) return;
    el.classList.add('hidden');
    setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 550);
  }
  function splashWhenReady() {
    const navStart = (window.performance && performance.timeOrigin) || Date.now();
    const elapsed = Date.now() - navStart;
    setTimeout(hideSplash, Math.max(0, MIN_SPLASH_MS - elapsed));
  }
  setTimeout(hideSplash, SPLASH_HARD_CAP_MS);

  // ---------------- Rendering: dynamic sections ----------------
  function renderDynamic() {
    renderTodayHead();
    renderNotices();
    renderWeather();
    renderSun();
    renderSki();
    renderUpcomingEvents();
    renderTrailFilters();
    if (openTrailId) renderTrailDetail(openTrailId); else renderTrailList();
    if (openPlaceId) renderPlaceDetail(openPlaceId); else renderPlaceGrid();
    renderInfo();
    renderMapPill();
  }

  // ---- Today: date + season ----
  function currentSeason() {
    const m = new Date().getMonth() + 1;
    if (m === 12 || m <= 3) return 'winter';
    if (m >= 6 && m <= 9) return 'summer';
    return 'shoulder';
  }

  function renderTodayHead() {
    let dateStr = '';
    try {
      dateStr = new Date().toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long' });
    } catch (_) {
      dateStr = new Date().toDateString();
    }
    $('today-date').textContent = dateStr;
    const season = currentSeason();
    const emoji = season === 'winter' ? '❄️' : season === 'summer' ? '☀️' : '🍂';
    const chip = $('season-chip');
    chip.textContent = '';
    const em = document.createElement('span');
    em.setAttribute('aria-hidden', 'true');
    em.textContent = emoji;
    chip.appendChild(em);
    chip.appendChild(document.createTextNode(t('season.' + season)));
  }

  // ---- Today: notices ----
  function renderNotices() {
    const host = $('today-notices');
    if (failed.status) { host.innerHTML = sectionErrorHTML(); return; }
    if (!data.status) { host.innerHTML = ''; return; }
    // Notice dates are park-local — compare against today in Europe/Skopje,
    // not UTC (en-CA yields YYYY-MM-DD, keeping the lexicographic compare valid).
    let today;
    try {
      today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Skopje' }).format(new Date());
    } catch (_) {
      const d = new Date();
      today = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') +
        '-' + String(d.getDate()).padStart(2, '0');
    }
    const active = (data.status.notices || []).filter((n) =>
      (!n.from || n.from <= today) && (!n.until || n.until >= today));
    let html = '';
    active.forEach((n) => {
      const warn = n.level === 'warn';
      html += '<div class="notice' + (warn ? ' notice-warn' : '') + '">' +
        '<span>' + escapeHTML(pick(n.text)) + '</span></div>';
    });
    if (active.length && data.status.updated) {
      html += '<p class="notices-stamp">' + escapeHTML(t('today.notices')) + ' · ' +
        escapeHTML(t('common.updated')) + ' ' + escapeHTML(fmtDate(data.status.updated)) + '</p>';
    }
    host.innerHTML = html;
  }

  function fmtDate(iso) {
    try {
      const d = new Date(iso + 'T00:00:00');
      return d.toLocaleDateString(locale(), { day: 'numeric', month: 'long' });
    } catch (_) { return iso; }
  }

  // ---- Today: weather ----
  function wxUrl(p) {
    return 'https://api.open-meteo.com/v1/forecast' +
      '?latitude=' + p.lat + '&longitude=' + p.lon + '&elevation=' + p.elev +
      '&timezone=Europe%2FSkopje&forecast_days=7' +
      '&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,snow_depth' +
      '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,snowfall_sum';
  }

  function loadWeather() {
    Promise.allSettled(WX_POINTS.map((p) => fetchJSON(wxUrl(p)))).then((res) => {
      // Cache shape: { ts, data: { valley, ridge } }. Each point is handled
      // independently — a fresh half is shown (and persisted) even when the
      // other request failed; the failed half falls back to the saved cache.
      let saved = null;
      try { saved = JSON.parse(localStorage.getItem(WX_KEY)); } catch (_) {}
      const savedData = (saved && saved.data) || null;
      const next = { ts: Date.now(), cached: false };
      let anyFresh = false;
      let anyStale = false;
      WX_POINTS.forEach((p, i) => {
        if (res[i].status === 'fulfilled') {
          next[p.key] = res[i].value;
          anyFresh = true;
        } else if (savedData && savedData[p.key]) {
          next[p.key] = savedData[p.key];
          anyStale = true;
        }
      });
      if (!anyFresh && !anyStale) {
        wxState = { error: true };
      } else {
        if (anyStale) {
          next.cached = true;
          if (saved && saved.ts) next.ts = saved.ts;
        }
        wxState = next;
        if (anyFresh) {
          try {
            localStorage.setItem(WX_KEY, JSON.stringify({
              ts: next.ts,
              data: { valley: next.valley || null, ridge: next.ridge || null },
            }));
          } catch (_) {}
        }
      }
      renderWeather();
    });
  }

  function wmoEmoji(code) {
    return WMO_EMOJI[code] || '🌡️';
  }

  function renderWeather() {
    const body = $('wx-body');
    const stamp = $('wx-stamp');
    stamp.textContent = '';
    if (!wxState) {
      body.innerHTML = '<p class="wx-loading">' + escapeHTML(t('wx.loading')) + '</p>';
      return;
    }
    if (wxState.error) {
      body.innerHTML = '<p class="wx-offline"><span aria-hidden="true">📡</span><span>' +
        escapeHTML(t('wx.offline')) + '</span></p>';
      return;
    }
    if (wxState.cached && wxState.ts) {
      let when = '';
      try {
        when = new Date(wxState.ts).toLocaleString(locale(), {
          day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
        });
      } catch (_) { when = String(new Date(wxState.ts)); }
      stamp.textContent = t('wx.cachedAt') + ' ' + when;
    }
    let html = '';
    WX_POINTS.forEach((p) => {
      const d = wxState[p.key];
      if (!d) return;
      html += wxPointHTML(p, d);
    });
    body.innerHTML = html;
  }

  function wxPointHTML(p, d) {
    const cur = d.current || {};
    const daily = d.daily || {};
    const emoji = wmoEmoji(cur.weather_code);
    const snowCm = cur.snow_depth != null ? Math.round(cur.snow_depth * 100) : null;
    let now = '<div class="wx-now">' +
      '<span class="wx-now-icon" aria-hidden="true">' + emoji + '</span>' +
      '<span class="wx-now-temp">' + fmtNum(cur.temperature_2m) + '°</span>' +
      '<span class="wx-now-meta">' +
      escapeHTML(t('wx.feels')) + ' ' + fmtNum(cur.apparent_temperature) + '° · ' +
      escapeHTML(t('wx.wind')) + ' ' + fmtNum(cur.wind_speed_10m) + ' ' + escapeHTML(t('unit.kmh'));
    if (snowCm != null && snowCm > 0) {
      now += '<br><span class="wx-snow-chip">❄️ ' + escapeHTML(t('wx.snowDepth')) + ' ' +
        fmtNum(snowCm) + ' ' + escapeHTML(t('unit.cm')) + '</span>';
    }
    now += '</span></div>';

    let days = '<div class="wx-days">';
    const n = (daily.time || []).length;
    for (let i = 0; i < n; i++) {
      let dow = '';
      try {
        dow = new Date(daily.time[i] + 'T12:00:00').toLocaleDateString(locale(), { weekday: 'short' });
      } catch (_) { dow = daily.time[i]; }
      const precip = daily.precipitation_sum && daily.precipitation_sum[i];
      const snow = daily.snowfall_sum && daily.snowfall_sum[i];
      let extra = '';
      if (snow != null && snow > 0) extra = '❄️' + fmtNum(snow, 1) + ' ' + escapeHTML(t('unit.cm'));
      else if (precip != null && precip > 0) extra = '💧' + fmtNum(precip, 1) + ' ' + escapeHTML(t('unit.mm'));
      days += '<div class="wx-day">' +
        '<div class="wx-day-name">' + escapeHTML(dow) + '</div>' +
        '<div class="wx-day-icon" aria-hidden="true">' + wmoEmoji(daily.weather_code && daily.weather_code[i]) + '</div>' +
        '<div class="wx-day-max">' + fmtNum(daily.temperature_2m_max && daily.temperature_2m_max[i]) + '°</div>' +
        '<div class="wx-day-min">' + fmtNum(daily.temperature_2m_min && daily.temperature_2m_min[i]) + '°</div>' +
        '<div class="wx-day-extra">' + extra + '</div>' +
        '</div>';
    }
    days += '</div>';

    return '<div class="wx-point">' +
      '<div><div class="wx-point-label">' + escapeHTML(t(p.labelKey)) + '</div>' + now + '</div>' +
      days + '</div>';
  }

  // ---- Today: sun (client-side NOAA calc — works fully offline) ----
  function sunTimesUTC(date, lat, lon) {
    const rad = Math.PI / 180;
    const start = Date.UTC(date.getUTCFullYear(), 0, 0);
    const dayOfYear = Math.floor((date.getTime() - start) / 86400000);
    function calc(rising) {
      const lngHour = lon / 15;
      const approx = dayOfYear + (((rising ? 6 : 18) - lngHour) / 24);
      const M = (0.9856 * approx) - 3.289;
      let L = M + (1.916 * Math.sin(M * rad)) + (0.020 * Math.sin(2 * M * rad)) + 282.634;
      L = ((L % 360) + 360) % 360;
      let RA = Math.atan(0.91764 * Math.tan(L * rad)) / rad;
      RA = ((RA % 360) + 360) % 360;
      RA += (Math.floor(L / 90) * 90) - (Math.floor(RA / 90) * 90);
      RA /= 15;
      const sinDec = 0.39782 * Math.sin(L * rad);
      const cosDec = Math.cos(Math.asin(sinDec));
      const cosH = (Math.cos(90.833 * rad) - (sinDec * Math.sin(lat * rad))) /
        (cosDec * Math.cos(lat * rad));
      if (cosH > 1 || cosH < -1) return null; // polar day/night — not here
      let H = rising ? 360 - (Math.acos(cosH) / rad) : Math.acos(cosH) / rad;
      H /= 15;
      const T = H + RA - (0.06571 * approx) - 6.622;
      let UT = T - lngHour;
      UT = ((UT % 24) + 24) % 24;
      const out = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
      out.setUTCMinutes(Math.round(UT * 60));
      return out;
    }
    return { sunrise: calc(true), sunset: calc(false) };
  }

  function fmtClock(d) {
    if (!d) return '—';
    try {
      return d.toLocaleTimeString(locale(), {
        hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/Skopje',
      });
    } catch (_) {
      return d.toISOString().slice(11, 16);
    }
  }

  function renderSun() {
    const host = $('sun-row');
    const sun = sunTimesUTC(new Date(), SUN_LAT, SUN_LON);
    let daylight = '—';
    if (sun.sunrise && sun.sunset) {
      const mins = Math.round((sun.sunset - sun.sunrise) / 60000);
      daylight = fmtNum(Math.floor(mins / 60)) + ' ' + t('unit.h') + ' ' +
        fmtNum(mins % 60) + ' ' + t('unit.min');
    }
    host.innerHTML =
      sunCellHTML(SUN_ICONS.sunrise, t('today.sunrise'), fmtClock(sun.sunrise)) +
      sunCellHTML(SUN_ICONS.sunset, t('today.sunset'), fmtClock(sun.sunset)) +
      sunCellHTML(SUN_ICONS.daylight, t('today.daylight'), daylight);
  }

  function sunCellHTML(iconSvg, label, value) {
    return '<div class="sun-cell">' +
      '<div class="sun-cell-label">' + escapeHTML(label) + '</div>' +
      '<div class="sun-cell-icon" aria-hidden="true">' + iconSvg + '</div>' +
      '<div class="sun-cell-value">' + escapeHTML(value) + '</div></div>';
  }

  // ---- Today: ski card (winter only) ----
  function renderSki() {
    $('card-ski').hidden = currentSeason() !== 'winter';
  }

  // ---- Today: upcoming events ----
  function renderUpcomingEvents() {
    const host = $('today-events');
    if (failed.events) { host.innerHTML = sectionErrorHTML(); return; }
    if (!data.events) { host.innerHTML = ''; return; }
    const nowMonth = new Date().getMonth() + 1;
    const sorted = (data.events.events || []).slice().sort((a, b) =>
      (((a.month - nowMonth) + 12) % 12) - (((b.month - nowMonth) + 12) % 12));
    host.innerHTML = sorted.slice(0, 3).map(eventRowHTML).join('');
  }

  function monthShort(m) {
    try {
      return new Date(2026, m - 1, 1).toLocaleDateString(locale(), { month: 'short' });
    } catch (_) { return String(m); }
  }

  function eventRowHTML(ev, withDesc) {
    return '<div class="event-row">' +
      '<span class="event-month">' + escapeHTML(monthShort(ev.month)) + '</span>' +
      '<div><span class="event-name">' + escapeHTML(pick(ev.name)) + '</span><br>' +
      '<span class="event-when">' + escapeHTML(pick(ev.when)) + '</span>' +
      (withDesc === true ? '<p class="event-desc">' + escapeHTML(pick(ev.desc)) + '</p>' : '') +
      '</div></div>';
  }

  // ---------------- Trails ----------------
  const DIFF_ORDER = ['all', 'easy', 'moderate', 'hard', 'alpine'];

  function renderTrailFilters() {
    const host = $('trail-filters');
    let html = '';
    DIFF_ORDER.forEach((d) => {
      const label = d === 'all' ? t('trails.filter.all') : t('difficulty.' + d);
      html += '<button type="button" class="chip" data-diff="' + d + '" aria-pressed="' +
        (filters.diff === d ? 'true' : 'false') + '">' + escapeHTML(label) + '</button>';
    });
    html += '<button type="button" class="chip chip-kids" data-kids="1" aria-pressed="' +
      (filters.kids ? 'true' : 'false') + '">👧 ' + escapeHTML(t('trails.filter.kids')) + '</button>';
    host.innerHTML = html;
    host.querySelectorAll('[data-diff]').forEach((btn) => {
      btn.addEventListener('click', () => {
        filters.diff = btn.dataset.diff;
        renderTrailFilters();
        renderTrailList();
      });
    });
    const kidsBtn = host.querySelector('[data-kids]');
    if (kidsBtn) {
      kidsBtn.addEventListener('click', () => {
        filters.kids = !filters.kids;
        renderTrailFilters();
        renderTrailList();
      });
    }
  }

  function trailStatChips(tr) {
    let html = '<span class="stat-chip">' +
      fmtNum(tr.distanceKm, tr.distanceKm % 1 ? 1 : 0) + ' ' + escapeHTML(t('unit.km')) + '</span>' +
      '<span class="stat-chip">↗ ' + fmtNum(tr.ascentM) + ' ' + escapeHTML(t('unit.m')) + '</span>' +
      '<span class="stat-chip">⏱ ' + escapeHTML(tr.time) + '</span>';
    if (tr.hasGeometry) html += '<span class="stat-chip">⤓ GPX</span>';
    return html;
  }

  function diffPillHTML(d) {
    return '<span class="diff-pill diff-' + escapeHTML(d) + '">' +
      escapeHTML(t('difficulty.' + d)) + '</span>';
  }

  function renderTrailList() {
    openTrailId = null;
    $('trail-detail').hidden = true;
    $('trails-list-view').hidden = false;
    const host = $('trail-list');
    if (failed.trails) { host.innerHTML = sectionErrorHTML(); return; }
    if (!data.trails) { host.innerHTML = ''; return; }
    const list = (data.trails.trails || []).filter((tr) =>
      (filters.diff === 'all' || tr.difficulty === filters.diff) &&
      (!filters.kids || tr.kidFriendly));
    if (!list.length) {
      host.innerHTML = '<p class="trail-card-season">' + escapeHTML(t('trails.empty')) + '</p>';
      return;
    }
    host.innerHTML = list.map((tr) => {
      const kid = tr.kidFriendly ? '<span class="trail-badges"><span class="trail-badge" aria-hidden="true">👧</span></span>' : '';
      return '<button type="button" class="trail-card" data-trail="' + escapeHTML(tr.id) + '">' +
        '<div class="trail-card-top"><span class="trail-card-name">' +
        '<span class="trail-card-icon" aria-hidden="true">🥾 </span>' + escapeHTML(pick(tr.name)) + kid + '</span>' +
        diffPillHTML(tr.difficulty) + '</div>' +
        '<div class="stat-chips">' + trailStatChips(tr) + '</div>' +
        '<div class="trail-card-season">🗓 ' + escapeHTML(pick(tr.season)) + '</div>' +
        '</button>';
    }).join('');
    host.querySelectorAll('[data-trail]').forEach((btn) => {
      btn.addEventListener('click', () => renderTrailDetail(btn.dataset.trail));
    });
  }

  function getTrail(id) {
    if (!data.trails) return null;
    return (data.trails.trails || []).find((x) => x.id === id) || null;
  }

  function renderTrailDetail(id) {
    const tr = getTrail(id);
    if (!tr) { renderTrailList(); return; }
    openTrailId = id;
    $('trails-list-view').hidden = true;
    const host = $('trail-detail');
    host.hidden = false;

    let html = '<button type="button" class="detail-back" data-back="1">‹ ' +
      escapeHTML(t('common.back')) + '</button>' +
      '<div class="trail-detail-head">' +
      '<h2 class="trail-detail-name">' + escapeHTML(pick(tr.name)) + '</h2>' +
      '<div class="trail-detail-meta">' + diffPillHTML(tr.difficulty) + trailStatChips(tr) +
      (tr.kidFriendly ? '<span class="stat-chip">👧 ' + escapeHTML(t('trails.filter.kids')) + '</span>' : '') +
      '</div></div>' +
      '<p class="detail-body">' + escapeHTML(pick(tr.description)) + '</p>';

    if (tr.warnings && tr.warnings.length) {
      html += '<div class="detail-section"><div class="detail-section-title">' +
        escapeHTML(t('trails.warnings')) + '</div><div class="warn-block">' +
        tr.warnings.map((w) => '<div class="warn-item">' + SVG_WARN + '<span>' +
          escapeHTML(pick(w)) + '</span></div>').join('') +
        '</div></div>';
    }

    html += '<div class="detail-section"><div class="detail-section-title">' +
      escapeHTML(t('trails.season')) + '</div><p class="detail-body">' +
      escapeHTML(pick(tr.season)) + '</p></div>';

    if (tr.start && tr.start.name) {
      html += '<div class="detail-section"><div class="detail-section-title">' +
        escapeHTML(t('trails.start')) + '</div><p class="detail-body">📍 ' +
        escapeHTML(pick(tr.start.name)) + '</p></div>';
    }

    html += '<div class="detail-actions">' +
      '<button type="button" class="btn btn-primary" data-show-map="1">🗺️ ' +
      escapeHTML(t('common.showOnMap')) + '</button>';
    const gpxHref = tr.hasGeometry && tr.gpx ? safeUrl(tr.gpx) : '';
    const officialHref = !gpxHref && tr.officialGpxUrl ? safeUrl(tr.officialGpxUrl) : '';
    if (gpxHref) {
      html += '<a class="btn btn-secondary" href="' + escapeHTML(gpxHref) + '" download>⤓ ' +
        escapeHTML(t('trails.gpxDownload')) + '</a>';
    } else if (officialHref) {
      html += '<a class="btn btn-secondary" href="' + escapeHTML(officialHref) +
        '" target="_blank" rel="noopener">' + escapeHTML(t('trails.gpxOfficial')) + ' ↗</a>';
    }
    html += '</div>';
    if (tr.hasGeometry) {
      html += '<p class="gpx-hint">' + escapeHTML(t('trails.gpxHint')) + '</p>';
    }

    host.innerHTML = html;
    host.querySelector('[data-back]').addEventListener('click', () => {
      renderTrailList();
      $('panel-trails').scrollTop = 0;
    });
    host.querySelector('[data-show-map]').addEventListener('click', () => {
      pendingMapAction = { type: 'trail', id: tr.id };
      switchTab('map');
    });
    $('panel-trails').scrollTop = 0;
  }

  // ---------------- Places ----------------
  function getPoi(id) {
    if (!data.pois) return null;
    return (data.pois.pois || []).find((x) => x.id === id) || null;
  }

  function renderPlaceGrid() {
    openPlaceId = null;
    $('place-detail').hidden = true;
    $('places-list-view').hidden = false;
    const host = $('place-grid');
    if (failed.pois) { host.innerHTML = sectionErrorHTML(); return; }
    if (!data.pois) { host.innerHTML = ''; return; }
    host.innerHTML = (data.pois.pois || []).map((p) =>
      '<button type="button" class="place-card" data-place="' + escapeHTML(p.id) + '">' +
      '<span class="place-card-icon" aria-hidden="true">' + escapeHTML(p.icon || '📍') + '</span>' +
      '<span class="place-card-name">' + escapeHTML(pick(p.name)) + '</span>' +
      '<span class="place-card-type">' + escapeHTML(t('poi.type.' + p.type)) + '</span>' +
      '</button>').join('');
    host.querySelectorAll('[data-place]').forEach((btn) => {
      btn.addEventListener('click', () => renderPlaceDetail(btn.dataset.place));
    });
  }

  function renderPlaceDetail(id) {
    const p = getPoi(id);
    if (!p) { renderPlaceGrid(); return; }
    openPlaceId = id;
    $('places-list-view').hidden = true;
    const host = $('place-detail');
    host.hidden = false;

    let html = '<button type="button" class="detail-back" data-back="1">‹ ' +
      escapeHTML(t('common.back')) + '</button>' +
      '<div class="place-detail-head">' +
      '<span class="place-detail-icon" aria-hidden="true">' + escapeHTML(p.icon || '📍') + '</span>' +
      '<div><h2 class="place-detail-name">' + escapeHTML(pick(p.name)) + '</h2>' +
      '<div class="place-detail-type">' + escapeHTML(t('poi.type.' + p.type)) +
      (p.elevation != null ? ' · ' + fmtNum(p.elevation) + ' ' + escapeHTML(t('unit.m')) : '') +
      '</div></div></div>' +
      '<p class="detail-body">' + escapeHTML(pick(p.body)) + '</p>';

    if (p.practical) {
      html += '<div class="detail-section"><div class="detail-section-title">' +
        escapeHTML(t('places.practical')) + '</div>' +
        '<div class="info-strip"><span>' +
        escapeHTML(pick(p.practical)) + '</span></div></div>';
    }
    if (p.seasonal) {
      html += '<div class="detail-section"><div class="detail-section-title">' +
        escapeHTML(t('places.seasonal')) + '</div>' +
        '<div class="info-strip"><span aria-hidden="true">🍂</span><span>' +
        escapeHTML(pick(p.seasonal)) + '</span></div></div>';
    }
    html += '<div class="detail-actions">' +
      '<button type="button" class="btn btn-primary" data-show-map="1">🗺️ ' +
      escapeHTML(t('common.showOnMap')) + '</button></div>';

    host.innerHTML = html;
    host.querySelector('[data-back]').addEventListener('click', () => {
      renderPlaceGrid();
      $('panel-places').scrollTop = 0;
    });
    host.querySelector('[data-show-map]').addEventListener('click', () => {
      pendingMapAction = { type: 'poi', id: p.id };
      switchTab('map');
    });
    $('panel-places').scrollTop = 0;
  }

  // ---------------- Info ----------------
  function renderInfo() {
    const host = $('info-body');
    let html = '';
    if (failed.park) html += sectionErrorHTML();
    const park = data.park;

    if (park && park.gettingThere) {
      html += '<section class="card"><h2 class="card-title">' + escapeHTML(t('info.gettingThere')) + '</h2>' +
        '<div class="getting-block"><div class="getting-title">🚗 ' + escapeHTML(t('info.byCar')) + '</div>' +
        '<p class="getting-body">' + escapeHTML(pick(park.gettingThere.car)) + '</p></div>' +
        '<div class="getting-block"><div class="getting-title">🚌 ' + escapeHTML(t('info.byBus')) + '</div>' +
        '<p class="getting-body">' + escapeHTML(pick(park.gettingThere.bus)) + '</p></div></section>';
    }

    if (park && park.fees && park.fees.length) {
      html += '<section class="card"><h2 class="card-title">' + escapeHTML(t('info.fees')) + '</h2>' +
        park.fees.map((f) =>
          '<div class="info-row"><div class="info-row-label">' + escapeHTML(pick(f.label)) + '</div>' +
          '<div class="info-row-value">' + escapeHTML(pick(f.value)) + '</div>' +
          (f.lastVerified ? '<span class="verified-stamp">✓ ' + escapeHTML(t('info.lastVerified')) +
            ' ' + escapeHTML(f.lastVerified) + '</span>' : '') +
          '</div>').join('') +
        '</section>';
    }

    if (park && park.money) {
      html += '<section class="card"><h2 class="card-title">' + escapeHTML(t('info.money')) + '</h2>' +
        '<div class="info-strip"><span aria-hidden="true">💳</span><span>' +
        escapeHTML(pick(park.money)) + '</span></div></section>';
    }

    if (park && park.contacts && park.contacts.length) {
      html += '<section class="card"><h2 class="card-title">' + escapeHTML(t('info.contacts')) + '</h2>' +
        park.contacts.map((c) => {
          let actions = '';
          if (c.phone) {
            actions += '<a class="contact-btn" href="tel:' + escapeHTML(String(c.phone).replace(/[^+\d]/g, '')) +
              '">📞 ' + escapeHTML(c.phone) + '</a>';
          }
          if (c.email) actions += '<a class="contact-btn" href="mailto:' + escapeHTML(c.email) + '">✉️</a>';
          const cUrl = c.url ? safeUrl(c.url) : '';
          if (cUrl) actions += '<a class="contact-btn" href="' + escapeHTML(cUrl) + '" target="_blank" rel="noopener">↗</a>';
          return '<div class="contact-row"><span class="contact-label">' + escapeHTML(pick(c.label)) +
            '</span><span class="contact-actions">' + actions + '</span></div>';
        }).join('') +
        '</section>';
    }

    if (failed.events) {
      html += '<section class="card"><h2 class="card-title">' + escapeHTML(t('info.events')) + '</h2>' +
        sectionErrorHTML() + '</section>';
    } else if (data.events && (data.events.events || []).length) {
      html += '<section class="card"><h2 class="card-title">' + escapeHTML(t('info.events')) + '</h2>' +
        (data.events.events || []).slice().sort((a, b) => a.month - b.month)
          .map((ev) => eventRowHTML(ev, true)).join('') +
        '</section>';
    }

    if (park && park.facts && park.facts.length) {
      html += '<section class="card"><h2 class="card-title">' + escapeHTML(t('info.facts')) + '</h2>' +
        park.facts.map((f) =>
          '<div class="info-row"><div class="info-row-label">' + escapeHTML(pick(f.label)) + '</div>' +
          '<div class="info-row-value">' + escapeHTML(pick(f.value)) + '</div></div>').join('') +
        '</section>';
    }

    if (park && park.links && park.links.length) {
      html += '<section class="card"><h2 class="card-title">' + escapeHTML(t('info.links')) + '</h2>' +
        park.links.map((l) => {
          const lUrl = safeUrl(l.url);
          if (!lUrl) return '';
          return '<a class="link-row" href="' + escapeHTML(lUrl) + '" target="_blank" rel="noopener">' +
            '<span>' + escapeHTML(pick(l.label)) + '</span><span class="link-row-arrow" aria-hidden="true">↗</span></a>';
        }).join('') +
        '</section>';
    }

    html += '<section class="card"><h2 class="card-title">' + escapeHTML(t('info.about')) + '</h2>' +
      '<p class="about-body">' + escapeHTML(t('info.aboutBody')) + '</p>' +
      '<p class="disclaimer">' + escapeHTML(t('info.disclaimer')) + '</p></section>';

    host.innerHTML = html;
  }

  // ---------------- Map ----------------
  function libsMissing() {
    return typeof maplibregl === 'undefined' || typeof pmtiles === 'undefined';
  }

  function ensureMap() {
    if (mapInstance) { $('map-fallback').hidden = true; return; }
    if (libsMissing()) {
      $('map-fallback').hidden = false;
      return;
    }
    $('map-fallback').hidden = true;
    initMap();
  }

  function retryMapLibs() {
    if (!libsMissing()) { ensureMap(); return; }
    // Re-inject whichever CDN assets are missing, then try again.
    if (typeof maplibregl === 'undefined' &&
        !document.querySelector('link[data-maplibre-retry]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = MAPLIBRE_CSS;
      link.setAttribute('data-maplibre-retry', '1');
      document.head.appendChild(link);
    }
    if (retryInFlight) return; // a previous retry's scripts are still pending
    const need = [];
    if (typeof maplibregl === 'undefined') need.push(MAPLIBRE_JS);
    if (typeof pmtiles === 'undefined') need.push(PMTILES_JS);
    let remaining = need.length;
    if (!remaining) { ensureMap(); return; }
    retryInFlight = true;
    const done = () => {
      remaining -= 1;
      if (remaining <= 0) { retryInFlight = false; ensureMap(); }
    };
    need.forEach((src) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = done;
      s.onerror = done;
      document.head.appendChild(s);
    });
  }

  // Map palette — alpine pine/lake, both themes.
  const MAP_THEMES = {
    dark: {
      bg: '#10201f', land: '#152825', landuse: '#1a2f2b', park: '#1b3a2c',
      water: '#16404c', waterLabel: '#7db7c9', road: '#31463f', roadMid: '#3f584d',
      roadHi: '#55705f', roadTop: '#6d8a75', rail: '#2e443c', boundary: '#41584c',
      building: '#20342e', label: '#d8e4d2', labelStrong: '#efe7d2', labelDim: '#93a695',
    },
    light: {
      bg: '#f5efdf', land: '#ece5cf', landuse: '#e2dec4', park: '#cfe0b7',
      water: '#a5c9cd', waterLabel: '#3d7086', road: '#fffdf4', roadMid: '#fffdf4',
      roadHi: '#f7dfa4', roadTop: '#eeb964', rail: '#b3ab93', boundary: '#a09a7f',
      building: '#e0d8bd', label: '#26372c', labelStrong: '#182a20', labelDim: '#6d7c6b',
    },
  };

  function buildStyle(themeName) {
    const C = MAP_THEMES[themeName] || MAP_THEMES.dark;
    return {
      version: 8,
      glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
      sources: {
        omt: { type: 'vector', url: 'pmtiles://' + PMTILES_URL },
      },
      layers: [
        { id: 'bg', type: 'background', paint: { 'background-color': C.bg } },
        { id: 'landcover', type: 'fill', source: 'omt', 'source-layer': 'landcover', paint: { 'fill-color': C.land } },
        { id: 'landuse', type: 'fill', source: 'omt', 'source-layer': 'landuse', paint: { 'fill-color': C.landuse } },
        { id: 'park', type: 'fill', source: 'omt', 'source-layer': 'park', paint: { 'fill-color': C.park } },
        { id: 'water', type: 'fill', source: 'omt', 'source-layer': 'water', paint: { 'fill-color': C.water } },
        { id: 'waterway', type: 'line', source: 'omt', 'source-layer': 'waterway', paint: { 'line-color': C.water, 'line-width': 1 } },

        { id: 'road-rail', type: 'line', source: 'omt', 'source-layer': 'transportation',
          filter: ['==', ['get', 'class'], 'rail'],
          paint: { 'line-color': C.rail, 'line-width': 0.6 } },
        { id: 'road-minor', type: 'line', source: 'omt', 'source-layer': 'transportation',
          filter: ['in', ['get', 'class'], ['literal', ['service', 'minor', 'track', 'path']]],
          paint: { 'line-color': C.road, 'line-width': 0.6 } },
        { id: 'road-secondary', type: 'line', source: 'omt', 'source-layer': 'transportation',
          filter: ['in', ['get', 'class'], ['literal', ['secondary', 'tertiary']]],
          paint: { 'line-color': C.roadMid, 'line-width': 1 } },
        { id: 'road-primary', type: 'line', source: 'omt', 'source-layer': 'transportation',
          filter: ['in', ['get', 'class'], ['literal', ['primary', 'trunk']]],
          paint: { 'line-color': C.roadHi, 'line-width': 1.4 } },
        { id: 'road-motorway', type: 'line', source: 'omt', 'source-layer': 'transportation',
          filter: ['==', ['get', 'class'], 'motorway'],
          paint: { 'line-color': C.roadTop, 'line-width': 1.8 } },

        { id: 'building', type: 'fill', source: 'omt', 'source-layer': 'building',
          minzoom: 14, paint: { 'fill-color': C.building } },
        { id: 'admin-boundary', type: 'line', source: 'omt', 'source-layer': 'boundary',
          filter: ['<=', ['coalesce', ['get', 'admin_level'], 99], 4],
          paint: { 'line-color': C.boundary, 'line-width': 0.8, 'line-dasharray': [2, 2] } },

        { id: 'road-label-major', type: 'symbol', source: 'omt', 'source-layer': 'transportation_name',
          minzoom: 11,
          filter: ['in', ['get', 'class'], ['literal', ['motorway', 'trunk', 'primary']]],
          layout: {
            'text-field': ['coalesce', ['get', 'name:latin'], ['get', 'name'], ['get', 'ref']],
            'text-font': TEXT_FONT,
            'text-size': ['interpolate', ['linear'], ['zoom'], 11, 10, 16, 12],
            'symbol-placement': 'line',
            'text-letter-spacing': 0.05,
          },
          paint: { 'text-color': C.label, 'text-halo-color': C.bg, 'text-halo-width': 1.5 } },

        { id: 'peak', type: 'symbol', source: 'omt', 'source-layer': 'mountain_peak',
          minzoom: 9,
          layout: {
            'text-field': ['concat', '▲ ', ['coalesce', ['get', 'name:latin'], ['get', 'name'], '']],
            'text-font': TEXT_FONT,
            'text-size': 11,
          },
          paint: { 'text-color': C.labelDim, 'text-halo-color': C.bg, 'text-halo-width': 1.5 } },

        { id: 'water-name', type: 'symbol', source: 'omt', 'source-layer': 'water_name',
          minzoom: 8,
          layout: {
            'text-field': ['coalesce', ['get', 'name:latin'], ['get', 'name'], ''],
            'text-font': TEXT_FONT,
            'text-size': ['interpolate', ['linear'], ['zoom'], 8, 11, 14, 14],
          },
          paint: { 'text-color': C.waterLabel, 'text-halo-color': C.bg, 'text-halo-width': 1.5 } },

        { id: 'place-city', type: 'symbol', source: 'omt', 'source-layer': 'place',
          filter: ['in', ['get', 'class'], ['literal', ['city', 'town']]],
          minzoom: 7,
          layout: {
            'text-field': ['coalesce', ['get', 'name:latin'], ['get', 'name']],
            'text-font': TEXT_FONT,
            'text-size': ['interpolate', ['linear'], ['zoom'], 7, 12, 12, 16],
          },
          paint: { 'text-color': C.label, 'text-halo-color': C.bg, 'text-halo-width': 1.8 } },
        { id: 'place-village', type: 'symbol', source: 'omt', 'source-layer': 'place',
          filter: ['in', ['get', 'class'], ['literal', ['village', 'suburb', 'hamlet']]],
          minzoom: 10,
          layout: {
            'text-field': ['coalesce', ['get', 'name:latin'], ['get', 'name']],
            'text-font': TEXT_FONT,
            'text-size': 11,
          },
          paint: { 'text-color': C.labelDim, 'text-halo-color': C.bg, 'text-halo-width': 1.5 } },
      ],
    };
  }

  // ---- emoji → map image (copied pattern from Locator) ----
  const POI_PIXEL_RATIO = 2;
  const POI_LOGICAL_SIZE = 40;

  function emojiToImage(emoji) {
    const w = POI_LOGICAL_SIZE * POI_PIXEL_RATIO;
    const h = POI_LOGICAL_SIZE * POI_PIXEL_RATIO;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.font =
      Math.floor(POI_LOGICAL_SIZE * 0.85 * POI_PIXEL_RATIO) + 'px ' +
      '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Twemoji Mozilla", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(emoji, w / 2, h / 2);
    const imgData = ctx.getImageData(0, 0, w, h);
    return { width: w, height: h, data: imgData.data };
  }

  function addImageSafe(id, emoji) {
    if (mapInstance.hasImage(id)) return;
    try {
      mapInstance.addImage(id, emojiToImage(emoji), { pixelRatio: POI_PIXEL_RATIO });
    } catch (e) {
      console.warn('addImage failed', id, e);
    }
  }

  function registerMapIcons() {
    // 1×1 transparent fallback so icon expressions never dangle.
    if (!mapInstance.hasImage('poi-blank')) {
      try {
        mapInstance.addImage('poi-blank', { width: 1, height: 1, data: new Uint8Array(4) },
          { pixelRatio: POI_PIXEL_RATIO });
      } catch (e) {
        console.warn('addImage failed', 'poi-blank', e);
      }
    }
    if (data.pois) {
      (data.pois.pois || []).forEach((p) => addImageSafe('mpoi-' + p.id, p.icon || '📍'));
    }
    Object.keys(OSM_KIND_ICONS).forEach((kind) => addImageSafe('osm-' + kind, OSM_KIND_ICONS[kind]));
  }

  function poiNameField() {
    return ['get', lang === 'mk' ? 'name_mk' : 'name_en'];
  }

  function trailColorExpr() {
    const expr = ['match', ['get', 'trailId']];
    if (data.trails) {
      (data.trails.trails || []).forEach((tr) => {
        expr.push(tr.id, DIFF_COLORS[tr.difficulty] || DIFF_COLORS.easy);
      });
    }
    expr.push(DIFF_COLORS.easy);
    return expr.length > 3 ? expr : DIFF_COLORS.easy;
  }

  function loadOverlayData() {
    if (overlaysRequested) return;
    overlaysRequested = true;
    Promise.allSettled([
      fetchJSON('data/geo/boundary.geojson'),
      fetchJSON('data/geo/trails.geojson'),
      fetchJSON('data/geo/osm-pois.geojson'),
    ]).then((res) => {
      overlaysSettled = true;
      if (res[0].status === 'fulfilled') geo.boundary = res[0].value;
      if (res[1].status === 'fulfilled') geo.trails = res[1].value;
      if (res[2].status === 'fulfilled') geo.osmPois = res[2].value;
      if (mapInstance && mapLoaded) {
        addOverlays();
        runPendingMapAction();
      }
    });
  }

  function parkPoiFC() {
    const features = ((data.pois && data.pois.pois) || []).map((p) => ({
      type: 'Feature',
      properties: {
        id: p.id,
        name_mk: (p.name && p.name.mk) || '',
        name_en: (p.name && p.name.en) || '',
      },
      geometry: { type: 'Point', coordinates: p.coords },
    }));
    return { type: 'FeatureCollection', features };
  }

  function osmPoiFC() {
    const feats = ((geo.osmPois && geo.osmPois.features) || []).filter((f) =>
      f.properties && OSM_KIND_ICONS[f.properties.kind]);
    return { type: 'FeatureCollection', features: feats };
  }

  function addOverlays() {
    if (!mapInstance || !mapLoaded) return;
    const C = MAP_THEMES[theme] || MAP_THEMES.dark;

    if (geo.boundary && !mapInstance.getSource('park-boundary')) {
      mapInstance.addSource('park-boundary', { type: 'geojson', data: geo.boundary });
      mapInstance.addLayer({
        id: 'park-boundary-fill', type: 'fill', source: 'park-boundary',
        paint: { 'fill-color': '#5fae7f', 'fill-opacity': 0.05 },
      });
      mapInstance.addLayer({
        id: 'park-boundary-line', type: 'line', source: 'park-boundary',
        paint: {
          'line-color': '#5fae7f', 'line-width': 1.6,
          'line-dasharray': [3, 2], 'line-opacity': 0.8,
        },
      });
    }

    if (geo.trails && !mapInstance.getSource('park-trails')) {
      mapInstance.addSource('park-trails', { type: 'geojson', data: geo.trails });
      mapInstance.addLayer({
        id: 'park-trails-casing', type: 'line', source: 'park-trails',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': C.bg, 'line-width': 5, 'line-opacity': 0.55 },
      });
      mapInstance.addLayer({
        id: 'park-trails-line', type: 'line', source: 'park-trails',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': trailColorExpr(), 'line-width': 2.6 },
      });
    }

    if (geo.osmPois && !mapInstance.getSource('osm-pois')) {
      mapInstance.addSource('osm-pois', { type: 'geojson', data: osmPoiFC() });
      mapInstance.addLayer({
        id: 'osm-pois-layer', type: 'symbol', source: 'osm-pois',
        minzoom: 11,
        layout: {
          'icon-image': ['concat', 'osm-', ['get', 'kind']],
          'icon-size': ['interpolate', ['linear'], ['zoom'], 11, 0.35, 15, 0.6],
          'icon-allow-overlap': false,
          'icon-padding': 1,
          'text-field': ['step', ['zoom'], '', 14, ['coalesce', ['get', 'name'], '']],
          'text-font': TEXT_FONT,
          'text-size': 10,
          'text-anchor': 'top',
          'text-offset': [0, 1.1],
          'text-optional': true,
          visibility: osmVisible ? 'visible' : 'none',
        },
        paint: { 'text-color': C.labelDim, 'text-halo-color': C.bg, 'text-halo-width': 1.4 },
      });
      $('osm-toggle').hidden = false;
      $('osm-toggle').setAttribute('aria-pressed', osmVisible ? 'true' : 'false');
    }

    if (data.pois && !mapInstance.getSource('park-pois')) {
      mapInstance.addSource('park-pois', { type: 'geojson', data: parkPoiFC() });
      mapInstance.addLayer({
        id: 'park-pois-layer', type: 'symbol', source: 'park-pois',
        layout: {
          'icon-image': ['concat', 'mpoi-', ['get', 'id']],
          'icon-size': ['interpolate', ['linear'], ['zoom'], 8, 0.45, 12, 0.7, 16, 0.95],
          'icon-allow-overlap': true,
          'text-field': ['step', ['zoom'], '', 10.5, poiNameField()],
          'text-font': TEXT_FONT,
          'text-size': 11,
          'text-anchor': 'top',
          'text-offset': [0, 1.35],
          'text-optional': true,
        },
        paint: { 'text-color': C.label, 'text-halo-color': C.bg, 'text-halo-width': 1.6 },
      });
    }

    addUserLayers();
  }

  function refreshMapLang() {
    if (!mapInstance || !mapLoaded) return;
    try {
      if (mapInstance.getLayer('park-pois-layer')) {
        mapInstance.setLayoutProperty('park-pois-layer', 'text-field',
          ['step', ['zoom'], '', 10.5, poiNameField()]);
      }
    } catch (_) {}
  }

  // ---- User position layers ----
  const EMPTY_FC = { type: 'FeatureCollection', features: [] };

  function circlePolygon(lng, lat, radiusMeters, points) {
    const n = points || 64;
    const dLat = radiusMeters / 111320;
    const dLng = radiusMeters / (111320 * Math.cos((lat * Math.PI) / 180));
    const ring = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 2 * Math.PI;
      ring.push([lng + dLng * Math.cos(a), lat + dLat * Math.sin(a)]);
    }
    ring.push(ring[0]);
    return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] }, properties: {} };
  }

  function addUserLayers() {
    if (!mapInstance || mapInstance.getSource('me-accuracy')) return;
    mapInstance.addSource('me-accuracy', { type: 'geojson', data: EMPTY_FC });
    mapInstance.addLayer({
      id: 'me-accuracy-fill', type: 'fill', source: 'me-accuracy',
      paint: { 'fill-color': '#5fae7f', 'fill-opacity': 0.08 },
    });
    mapInstance.addLayer({
      id: 'me-accuracy-line', type: 'line', source: 'me-accuracy',
      paint: { 'line-color': '#5fae7f', 'line-width': 1.5, 'line-opacity': 0.5 },
    });
    if (lastFix) {
      mapInstance.getSource('me-accuracy').setData(
        circlePolygon(lastFix.lon, lastFix.lat, lastFix.accuracy));
    }
  }

  // ---- Map init + error surfacing ----
  function initMap() {
    const protocol = new pmtiles.Protocol();
    maplibregl.addProtocol('pmtiles', protocol.tile);

    mapInstance = new maplibregl.Map({
      container: 'map',
      style: buildStyle(theme),
      center: MAP_CENTER,
      zoom: MAP_ZOOM,
      minZoom: MAP_MIN_ZOOM,
      attributionControl: false,
    });
    mapInstance.addControl(new maplibregl.NavigationControl({ showCompass: false, visualizePitch: false }), 'top-right');
    mapInstance.addControl(new maplibregl.AttributionControl({
      compact: true,
      customAttribution:
        '© <a href="https://openmaptiles.org/">OpenMapTiles</a> ' +
        '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors · ' +
        '<a href="https://github.com/onthegomap/planetiler">planetiler</a>',
    }), 'bottom-right');

    // Error surfacing trio (Locator's battle-tested set):
    // 1. surface MapLibre's first error to the pill,
    mapInstance.on('error', (e) => {
      const msg = (e && e.error && e.error.message) || 'Map error';
      if (!mapErrorShown) {
        mapErrorShown = true;
        if (!pillState || pillState.state !== 'active') {
          setMapPill('error', null, msg.slice(0, 60));
        }
      }
      console.error('Map error:', e);
    });
    mapInstance.on('data', (e) => {
      if (e.sourceId === 'omt' && e.dataType === 'source' && e.tile) tilesLoaded++;
    });
    // 2. HEAD-probe the PMTiles URL for an early, legible diagnosis,
    fetch(PMTILES_URL, { method: 'HEAD' })
      .then((r) => {
        if (!r.ok && !mapErrorShown) {
          mapErrorShown = true;
          setMapPill('error', null, 'PMTiles ' + r.status);
        }
      })
      .catch((err) => {
        if (!mapErrorShown) {
          mapErrorShown = true;
          setMapPill('error', 'map.tilesUnreachable');
        }
        console.error('PMTiles HEAD failed:', err);
      });
    // 3. 10 s watchdog for the silent-blank-canvas failure mode.
    setTimeout(() => {
      if (tilesLoaded === 0 && !mapErrorShown && (!pillState || pillState.state !== 'active')) {
        setMapPill('error', 'map.noTiles');
      }
    }, 10000);

    mapInstance.on('load', () => {
      mapLoaded = true;
      registerMapIcons();
      addOverlays();
      wireMapPoiTap();
      $('locate-btn').hidden = false;
      runPendingMapAction();
    });
    // Theme swap (setStyle) wipes images + custom sources — re-add.
    mapInstance.on('style.load', () => {
      if (!mapLoaded) return;
      registerMapIcons();
      addOverlays();
    });

    loadOverlayData();
  }

  function wireMapPoiTap() {
    mapInstance.on('click', 'park-pois-layer', (e) => {
      const f = e.features && e.features[0];
      if (!f) return;
      openPoiSheet(f.properties.id);
    });
    mapInstance.on('mouseenter', 'park-pois-layer', () => {
      mapInstance.getCanvas().style.cursor = 'pointer';
    });
    mapInstance.on('mouseleave', 'park-pois-layer', () => {
      mapInstance.getCanvas().style.cursor = '';
    });
    mapInstance.on('click', (e) => {
      // Tap on empty map closes the sheet.
      const hits = mapInstance.getLayer('park-pois-layer')
        ? mapInstance.queryRenderedFeatures(e.point, { layers: ['park-pois-layer'] })
        : [];
      if (!hits.length) $('poi-sheet').hidden = true;
    });
  }

  let poiSheetId = null;
  function openPoiSheet(id) {
    const p = getPoi(id);
    if (!p) return;
    poiSheetId = id;
    $('poi-sheet-icon').textContent = p.icon || '📍';
    $('poi-sheet-name').textContent = pick(p.name);
    $('poi-sheet-summary').textContent = pick(p.summary);
    $('poi-sheet').hidden = false;
  }

  function runPendingMapAction() {
    if (!pendingMapAction || !mapInstance || !mapLoaded) return;
    const a = pendingMapAction;
    if (a.type === 'trail') {
      const tr = getTrail(a.id);
      if (!tr) { pendingMapAction = null; return; }
      const feat = geo.trails && (geo.trails.features || []).find((f) =>
        f.properties && f.properties.trailId === a.id);
      if (feat && feat.geometry && feat.geometry.coordinates.length) {
        if (!overlayFitBounds(feat.geometry.coordinates)) return; // keep pending
      } else if (!overlaysSettled && tr.hasGeometry) {
        return; // geometry still on its way — retried from loadOverlayData
      } else if (tr.start && tr.start.coords) {
        mapInstance.flyTo({ center: tr.start.coords, zoom: 13, duration: 900 });
      }
      pendingMapAction = null;
      return;
    }
    if (a.type === 'poi') {
      const p = getPoi(a.id);
      pendingMapAction = null;
      if (p && p.coords) {
        mapInstance.flyTo({ center: p.coords, zoom: 13, duration: 900 });
        openPoiSheet(p.id);
      }
    }
  }

  function overlayFitBounds(coords) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    coords.forEach((c) => {
      if (c[0] < minX) minX = c[0];
      if (c[0] > maxX) maxX = c[0];
      if (c[1] < minY) minY = c[1];
      if (c[1] > maxY) maxY = c[1];
    });
    if (!isFinite(minX)) return false;
    try {
      mapInstance.fitBounds([[minX, minY], [maxX, maxY]], { padding: 60, duration: 900, maxZoom: 14 });
    } catch (_) { return false; }
    return true;
  }

  // ---- Map status pill ----
  function setMapPill(state, key, raw) {
    pillState = { state, key, raw };
    renderMapPill();
  }

  function renderMapPill() {
    const pill = $('map-pill');
    if (!pillState) { pill.hidden = true; return; }
    pill.hidden = false;
    pill.dataset.state = pillState.state;
    $('map-pill-text').textContent = pillState.key ? t(pillState.key) : (pillState.raw || '');
  }

  // ---- Geolocation (Locator's handling: visible retry + watchdogs) ----
  function clearGeoWatchdog() {
    if (geoWatchdog) { clearTimeout(geoWatchdog); geoWatchdog = null; }
  }

  function onGeoFix(pos) {
    lastFix = {
      lon: pos.coords.longitude,
      lat: pos.coords.latitude,
      accuracy: pos.coords.accuracy,
      ts: pos.timestamp || Date.now(),
    };
    clearGeoWatchdog();
    if (mapInstance && mapLoaded) {
      if (!pinMarker) {
        const el = document.createElement('div');
        el.className = 'me-pin';
        el.innerHTML = '<div class="me-pin-ring"></div><div class="me-pin-dot"></div>';
        pinMarker = new maplibregl.Marker({ element: el, anchor: 'center' });
      }
      pinMarker.setLngLat([lastFix.lon, lastFix.lat]).addTo(mapInstance);
      const src = mapInstance.getSource('me-accuracy');
      if (src) src.setData(circlePolygon(lastFix.lon, lastFix.lat, lastFix.accuracy));
      if (justLocated) {
        justLocated = false;
        mapInstance.flyTo({ center: [lastFix.lon, lastFix.lat], zoom: Math.max(mapInstance.getZoom(), 13), duration: 800 });
      }
    }
    setMapPill('active', 'map.live');
    updateSosCoords();
  }

  function onGeoError(err) {
    clearGeoWatchdog();
    let key = 'map.geoUnavailable';
    if (err && err.code === 1) key = 'map.geoDenied';
    else if (err && err.code === 3) key = 'map.geoTimeout';
    setMapPill('error', key);
    updateSosCoords(key);
  }

  let justLocated = false;
  function startWatch() {
    if (!navigator.geolocation) { setMapPill('error', 'map.geoUnsupported'); return; }
    stopWatch();
    justLocated = true;
    setMapPill('locating', 'map.locating');
    // iOS Safari inside an iframe can stall watchPosition silently —
    // after 8 s with no fix and no error, nudge the user to retry.
    clearGeoWatchdog();
    geoWatchdog = setTimeout(() => {
      if (!lastFix && pillState && pillState.state === 'locating') {
        setMapPill('locating', 'map.tapLocate');
      }
    }, 8000);
    watchId = navigator.geolocation.watchPosition(onGeoFix, onGeoError, {
      enableHighAccuracy: true, maximumAge: 5000, timeout: 15000,
    });
  }

  function stopWatch() {
    clearGeoWatchdog();
    if (watchId !== null && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (watchId !== null) { geoSuspended = true; stopWatch(); }
    } else if (geoSuspended) {
      geoSuspended = false;
      startWatch();
    }
  });

  // ---------------- SOS ----------------
  let sosGeoRequested = false;

  function updateSosCoords(errorKey) {
    const out = $('sos-coords');
    const copyBtn = $('sos-copy');
    if (lastFix) {
      const text = lastFix.lat.toFixed(5) + ', ' + lastFix.lon.toFixed(5) +
        ' (±' + Math.round(lastFix.accuracy) + ' m)';
      out.textContent = text;
      copyBtn.hidden = false;
      return;
    }
    if (errorKey) {
      out.textContent = t(errorKey);
      copyBtn.hidden = true;
    }
  }

  function openSos() {
    $('sos-sheet').hidden = false;
    $('sos-backdrop').hidden = false;
    updateSosCoords();
    if (!lastFix && navigator.geolocation && !sosGeoRequested) {
      sosGeoRequested = true;
      navigator.geolocation.getCurrentPosition(
        (pos) => { sosGeoRequested = false; onGeoFix(pos); },
        (err) => { sosGeoRequested = false; onGeoError(err); },
        { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 },
      );
    }
  }

  function closeSos() {
    $('sos-sheet').hidden = true;
    $('sos-backdrop').hidden = true;
  }

  function copySosCoords() {
    if (!lastFix) return;
    const text = lastFix.lat.toFixed(5) + ', ' + lastFix.lon.toFixed(5);
    const flash = () => {
      const btn = $('sos-copy');
      const prev = btn.innerHTML;
      btn.textContent = '✓';
      setTimeout(() => { btn.innerHTML = prev; }, 1400);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(flash).catch(() => fallbackCopy(text, flash));
    } else {
      fallbackCopy(text, flash);
    }
  }

  function fallbackCopy(text, done) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      done();
    } catch (_) {}
  }

  // ---------------- Quit (embedded shell contract) ----------------
  function quit() {
    stopWatch();
    if (window.self !== window.top) {
      try { window.parent.postMessage({ type: 'close-game' }, '*'); } catch (_) {}
    } else {
      location.href = '../../';
    }
  }

  // ---------------- Wiring ----------------
  function wire() {
    TABS.forEach((tab) => {
      $('tab-' + tab).addEventListener('click', () => switchTab(tab));
    });
    $('lang-mk').addEventListener('click', () => setLang('mk'));
    $('lang-en').addEventListener('click', () => setLang('en'));
    $('theme-btn').addEventListener('click', () => setTheme(theme === 'dark' ? 'light' : 'dark'));
    $('quit-btn').addEventListener('click', quit);

    $('sos-btn').addEventListener('click', openSos);
    $('sos-close').addEventListener('click', closeSos);
    $('sos-backdrop').addEventListener('click', closeSos);
    $('sos-copy').addEventListener('click', copySosCoords);

    $('map-retry').addEventListener('click', retryMapLibs);
    $('locate-btn').addEventListener('click', () => { stopWatch(); startWatch(); });
    $('osm-toggle').addEventListener('click', () => {
      osmVisible = !osmVisible;
      $('osm-toggle').setAttribute('aria-pressed', osmVisible ? 'true' : 'false');
      if (mapInstance && mapInstance.getLayer('osm-pois-layer')) {
        mapInstance.setLayoutProperty('osm-pois-layer', 'visibility', osmVisible ? 'visible' : 'none');
      }
    });
    $('poi-sheet-close').addEventListener('click', () => { $('poi-sheet').hidden = true; });
    $('poi-sheet-open').addEventListener('click', () => {
      $('poi-sheet').hidden = true;
      if (poiSheetId) {
        renderPlaceDetail(poiSheetId);
        switchTab('places');
      }
    });

    // If the CDN scripts arrive after boot (slow network) while the
    // fallback is showing, recover automatically.
    window.addEventListener('load', () => {
      if (activeTab === 'map' && !mapInstance && !libsMissing()) ensureMap();
    });
  }

  // ---------------- Boot ----------------
  function boot() {
    syncLangButtons();
    wire();
    let savedTab = null;
    try { savedTab = localStorage.getItem(TAB_KEY); } catch (_) {}
    switchTab(TABS.indexOf(savedTab) !== -1 ? savedTab : 'today', false);
    renderTodayHead();
    renderSun();
    renderSki();
    loadCore();
    loadWeather();
  }

  boot();
})();
