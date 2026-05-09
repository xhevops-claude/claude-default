(function () {
  const statusEl = document.getElementById('status');
  const statusText = document.getElementById('status-text');
  const metaAcc = document.getElementById('meta-acc');
  const metaTime = document.getElementById('meta-time');
  const followBtn = document.getElementById('follow-btn');
  const retryBtn = document.getElementById('retry-btn');
  const quitBtn = document.getElementById('quit-btn');

  // Self-hosted vector tiles from our daily Geofabrik → planetiler
  // pipeline; same origin as this iframe, so no CORS dance. The
  // file lives at the production site's /cdn/ on gh-pages.
  const PMTILES_URL =
    'https://xhevops-claude.github.io/claude-default/cdn/maps/pmtiles/north-macedonia.pmtiles';

  // Defaults — North Macedonia centred until we get a first fix.
  const NMK_CENTER = [41.6086, 21.7453];
  const NMK_ZOOM = 8;
  const FIX_ZOOM = 15;

  const map = L.map('map', { zoomControl: false }).setView(NMK_CENTER, NMK_ZOOM);
  L.control.zoom({ position: 'topright' }).addTo(map);

  // Dark paint ruleset for planetiler's default OpenMapTiles schema.
  // Each rule binds a vector-tile data layer (and optional filter) to
  // a Leaflet-compatible symbolizer; protomaps-leaflet does the
  // canvas drawing per tile via byte-range reads from the PMTiles.
  const PR = window.protomapsL;
  const COLOR = {
    bg: '#1a1d24',
    land: '#22262e',
    landuse: '#252a33',
    water: '#0f1419',
    park: '#1f2a23',
    road: '#3d4148',
    roadHi: '#5a6068',
    roadMid: '#4a4f57',
    rail: '#3a3f45',
    boundary: '#3a4048',
    building: '#262a32',
    label: '#cbd5e1',
    labelDim: '#94a3b8',
  };
  const paintRules = [
    { dataLayer: 'landcover', symbolizer: new PR.PolygonSymbolizer({ fill: COLOR.land }) },
    { dataLayer: 'park',      symbolizer: new PR.PolygonSymbolizer({ fill: COLOR.park }) },
    { dataLayer: 'landuse',   symbolizer: new PR.PolygonSymbolizer({ fill: COLOR.landuse }) },
    { dataLayer: 'water',     symbolizer: new PR.PolygonSymbolizer({ fill: COLOR.water }) },
    { dataLayer: 'waterway',  symbolizer: new PR.LineSymbolizer({ color: COLOR.water, width: 1 }) },

    // Roads — minor classes first, then primary/motorway on top so
    // they read as a hierarchy.
    { dataLayer: 'transportation', filter: (z, f) => ['service', 'minor', 'track'].includes(f.props.class), symbolizer: new PR.LineSymbolizer({ color: COLOR.road, width: 0.6 }) },
    { dataLayer: 'transportation', filter: (z, f) => ['secondary', 'tertiary'].includes(f.props.class), symbolizer: new PR.LineSymbolizer({ color: COLOR.roadMid, width: 1 }) },
    { dataLayer: 'transportation', filter: (z, f) => ['primary', 'trunk'].includes(f.props.class), symbolizer: new PR.LineSymbolizer({ color: COLOR.roadHi, width: 1.4 }) },
    { dataLayer: 'transportation', filter: (z, f) => f.props.class === 'motorway', symbolizer: new PR.LineSymbolizer({ color: COLOR.roadHi, width: 1.8 }) },
    { dataLayer: 'transportation', filter: (z, f) => f.props.class === 'rail', symbolizer: new PR.LineSymbolizer({ color: COLOR.rail, width: 0.6 }) },

    { dataLayer: 'boundary', filter: (z, f) => (f.props.admin_level || 99) <= 2, symbolizer: new PR.LineSymbolizer({ color: COLOR.boundary, width: 0.8 }) },

    { dataLayer: 'building', minzoom: 14, symbolizer: new PR.PolygonSymbolizer({ fill: COLOR.building }) },
  ];
  const labelRules = [
    {
      dataLayer: 'place',
      filter: (z, f) => ['country', 'state', 'city'].includes(f.props.class),
      symbolizer: new PR.TextSymbolizer({
        properties: ['name:en', 'name'],
        font: '600 12px ui-sans-serif, system-ui, sans-serif',
        fill: COLOR.label,
        stroke: COLOR.bg,
        width: 3,
      }),
    },
    {
      dataLayer: 'place',
      filter: (z, f) => ['town', 'village'].includes(f.props.class),
      minzoom: 9,
      symbolizer: new PR.TextSymbolizer({
        properties: ['name:en', 'name'],
        font: '500 11px ui-sans-serif, system-ui, sans-serif',
        fill: COLOR.labelDim,
        stroke: COLOR.bg,
        width: 2,
      }),
    },
  ];

  PR.leafletLayer({
    url: PMTILES_URL,
    paintRules,
    labelRules,
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · tiles built with <a href="https://github.com/onthegomap/planetiler">planetiler</a>',
  }).addTo(map);

  const pinIcon = L.divIcon({
    className: 'me-pin-icon',
    html: '<div class="me-pin"><div class="me-pin-ring"></div><div class="me-pin-dot"></div></div>',
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });

  let pinMarker = null;
  let accCircle = null;
  let watchId = null;
  let firstFix = true;
  let follow = true;
  let lastFixTs = 0;
  let suspended = false;

  // ---- Helpers ----
  function setStatus(state, text) {
    statusEl.dataset.state = state;
    statusText.textContent = text;
    // Show the Locate button only when we don't have an active watch.
    retryBtn.hidden = (state === 'active' || state === 'locating');
  }

  function fmtAccuracy(m) {
    if (!isFinite(m)) return '—';
    if (m < 1000) return `±${Math.round(m)}m`;
    return `±${(m / 1000).toFixed(1)}km`;
  }

  function fmtTime(ts) {
    const d = Math.max(0, Date.now() - ts);
    if (d < 1500) return 'now';
    if (d < 60000) return `${Math.floor(d / 1000)}s ago`;
    if (d < 3600000) return `${Math.floor(d / 60000)}m ago`;
    return `${Math.floor(d / 3600000)}h ago`;
  }

  function refreshTime() {
    if (lastFixTs) metaTime.textContent = fmtTime(lastFixTs);
  }

  // Wrap programmatic moves so the dragstart handler can tell user
  // pans apart from our auto-recentre. Using map.once('moveend') flips
  // the flag back exactly once, so concurrent fly/pan calls don't get
  // tangled.
  let movingUs = false;
  function moveProgrammatically(fn) {
    movingUs = true;
    map.once('moveend', () => { movingUs = false; });
    fn();
  }

  // ---- Geolocation handlers ----
  function onFix(pos) {
    const { latitude, longitude, accuracy } = pos.coords;
    const ll = [latitude, longitude];
    lastFixTs = pos.timestamp || Date.now();

    if (!pinMarker) {
      pinMarker = L.marker(ll, { icon: pinIcon, keyboard: false, interactive: false }).addTo(map);
    } else {
      pinMarker.setLatLng(ll);
    }

    if (!accCircle) {
      accCircle = L.circle(ll, {
        radius: accuracy,
        color: '#fb923c',
        weight: 1.5,
        opacity: 0.5,
        fillColor: '#fb923c',
        fillOpacity: 0.08,
        interactive: false,
      }).addTo(map);
    } else {
      accCircle.setLatLng(ll);
      accCircle.setRadius(accuracy);
    }

    if (firstFix) {
      moveProgrammatically(() => map.flyTo(ll, FIX_ZOOM, { duration: 0.8 }));
      firstFix = false;
    } else if (follow) {
      moveProgrammatically(() => map.panTo(ll, { animate: true, duration: 0.4 }));
    }

    setStatus('active', 'Live');
    metaAcc.textContent = fmtAccuracy(accuracy);
    refreshTime();
  }

  function onError(err) {
    let msg = 'Location unavailable';
    if (err && err.code === 1) msg = 'Location denied';
    else if (err && err.code === 3) msg = 'Location timed out';
    setStatus('error', msg);
  }

  function startWatch() {
    if (!navigator.geolocation) {
      setStatus('error', 'Not supported');
      return;
    }
    if (watchId !== null) return;
    setStatus('locating', 'Locating…');
    watchId = navigator.geolocation.watchPosition(onFix, onError, {
      enableHighAccuracy: true,
      maximumAge: 5000,
      timeout: 20000,
    });
  }

  function stopWatch() {
    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
  }

  // ---- Visibility: pause the watch when the iframe is hidden so we
  // aren't draining battery in the background. Resume on return. ----
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      suspended = true;
      stopWatch();
    } else if (suspended) {
      suspended = false;
      startWatch();
    }
  });

  // ---- Follow toggle ----
  function setFollow(on) {
    follow = on;
    followBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    if (on && pinMarker) {
      moveProgrammatically(() => map.panTo(pinMarker.getLatLng(), { animate: true, duration: 0.3 }));
    }
  }

  followBtn.addEventListener('click', () => setFollow(!follow));

  // User pan turns Follow off so the map doesn't snap back; user
  // zoom is left alone so they can scale freely while still
  // following. Programmatic moves set movingUs = true to opt out.
  map.on('dragstart', () => {
    if (!movingUs && follow) setFollow(false);
  });

  // ---- Buttons ----
  retryBtn.addEventListener('click', () => {
    stopWatch();
    startWatch();
  });

  function quit() {
    stopWatch();
    if (window.self !== window.top) {
      try { window.parent.postMessage({ type: 'close-game' }, '*'); } catch (_) {}
    } else {
      location.href = '../../';
    }
  }

  quitBtn.addEventListener('click', quit);

  // ---- Boot ----
  setInterval(refreshTime, 1000);
  startWatch();

  // Hide the inline loading screen once Leaflet has painted at least
  // one tile, with a 1s minimum so the splash isn't a flash.
  (function hideLoading() {
    const loading = document.getElementById('app-loading');
    if (!loading) return;
    const navStart = (performance && performance.timeOrigin) || Date.now();
    const elapsed = Date.now() - navStart;
    const remaining = Math.max(0, 1000 - elapsed);
    setTimeout(() => {
      loading.classList.add('hidden');
      setTimeout(() => loading.remove(), 500);
    }, remaining);
  })();
})();
