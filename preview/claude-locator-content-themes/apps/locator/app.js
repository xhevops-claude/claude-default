(function () {
  const statusEl = document.getElementById('status');
  const statusText = document.getElementById('status-text');
  const metaAcc = document.getElementById('meta-acc');
  const metaTime = document.getElementById('meta-time');
  const followBtn = document.getElementById('follow-btn');
  const retryBtn = document.getElementById('retry-btn');
  const themeBtn = document.getElementById('theme-btn');
  const quitBtn = document.getElementById('quit-btn');

  // Self-hosted vector tiles from the daily Geofabrik → planetiler
  // pipeline. Same origin as this iframe, so no CORS dance. We hardcode
  // the production gh-pages URL so production, preview deploys, and
  // embedded iframes all read from the same place.
  const PMTILES_URL =
    'https://xhevops-claude.github.io/claude-default/cdn/maps/pmtiles/north-macedonia.pmtiles';

  // North Macedonia centred until we get a first fix.
  // (lng, lat) for MapLibre — note the order flip vs Leaflet.
  const NMK_CENTER = [21.7453, 41.6086];
  const NMK_ZOOM = 7;
  const FIX_ZOOM = 15;
  const THEME_KEY = 'locator-theme';

  // ---- pmtiles plugin → MapLibre custom protocol ----
  // Registers the `pmtiles://...` URL scheme so the source URL below
  // can resolve into byte-range reads against the PMTiles file.
  const pmtilesProtocol = new pmtiles.Protocol();
  maplibregl.addProtocol('pmtiles', pmtilesProtocol.tile);

  // Two palettes for the OpenMapTiles schema. Keys describe the role
  // each colour plays so the same style code drives both themes; the
  // HUD chrome shares the same theme via CSS variables in styles.css.
  const THEMES = {
    dark: {
      bg: '#1a1d24',
      land: '#22262e',
      landuse: '#252a33',
      park: '#1f2a23',
      water: '#0f1419',
      road: '#3d4148',
      roadMid: '#4a4f57',
      roadHi: '#5a6068',
      roadTop: '#6b7178',
      rail: '#3a3f45',
      boundary: '#3a4048',
      building: '#262a32',
      label: '#cbd5e1',
      labelDim: '#94a3b8',
      poi: '#94a3b8',
    },
    light: {
      bg: '#f5f3ee',
      land: '#ecead8',
      landuse: '#e6dccd',
      park: '#cce0c2',
      water: '#aacbe2',
      road: '#ffffff',
      roadMid: '#ffffff',
      roadHi: '#ffe9b0',
      roadTop: '#ffc36b',
      rail: '#a8a6a0',
      boundary: '#998888',
      building: '#dfd6c5',
      label: '#1a1d24',
      labelDim: '#525866',
      poi: '#525866',
    },
  };
  const TEXT_FONT = ['Noto Sans Regular'];

  function buildStyle(themeName) {
    const C = THEMES[themeName] || THEMES.dark;
    return {
      version: 8,
      glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
      sources: { omt: { type: 'vector', url: 'pmtiles://' + PMTILES_URL } },
      layers: [
        { id: 'bg', type: 'background', paint: { 'background-color': C.bg } },
        { id: 'landcover', type: 'fill', source: 'omt', 'source-layer': 'landcover', paint: { 'fill-color': C.land } },
        { id: 'landuse',   type: 'fill', source: 'omt', 'source-layer': 'landuse',   paint: { 'fill-color': C.landuse } },
        { id: 'park',      type: 'fill', source: 'omt', 'source-layer': 'park',      paint: { 'fill-color': C.park } },
        { id: 'water',     type: 'fill', source: 'omt', 'source-layer': 'water',     paint: { 'fill-color': C.water } },
        { id: 'waterway',  type: 'line', source: 'omt', 'source-layer': 'waterway',  paint: { 'line-color': C.water, 'line-width': 1 } },

        // Road network — drawn in priority order so big roads sit on top.
        { id: 'road-rail',     type: 'line', source: 'omt', 'source-layer': 'transportation',
          filter: ['==', ['get', 'class'], 'rail'],
          paint: { 'line-color': C.rail, 'line-width': 0.6 } },
        { id: 'road-minor',    type: 'line', source: 'omt', 'source-layer': 'transportation',
          filter: ['in', ['get', 'class'], ['literal', ['service', 'minor', 'track', 'path']]],
          paint: { 'line-color': C.road, 'line-width': 0.6 } },
        { id: 'road-secondary', type: 'line', source: 'omt', 'source-layer': 'transportation',
          filter: ['in', ['get', 'class'], ['literal', ['secondary', 'tertiary']]],
          paint: { 'line-color': C.roadMid, 'line-width': 1 } },
        { id: 'road-primary',  type: 'line', source: 'omt', 'source-layer': 'transportation',
          filter: ['in', ['get', 'class'], ['literal', ['primary', 'trunk']]],
          paint: { 'line-color': C.roadHi, 'line-width': 1.4 } },
        { id: 'road-motorway', type: 'line', source: 'omt', 'source-layer': 'transportation',
          filter: ['==', ['get', 'class'], 'motorway'],
          paint: { 'line-color': C.roadTop, 'line-width': 1.8 } },

        { id: 'building', type: 'fill', source: 'omt', 'source-layer': 'building',
          minzoom: 14, paint: { 'fill-color': C.building } },

        { id: 'boundary', type: 'line', source: 'omt', 'source-layer': 'boundary',
          filter: ['<=', ['coalesce', ['get', 'admin_level'], 99], 4],
          paint: { 'line-color': C.boundary, 'line-width': 0.8, 'line-dasharray': [2, 2] } },

        // Road labels (street names along the line) for the visible
        // hierarchy. Using `symbol-placement: line` glues the label to
        // the road shape; halo keeps it legible against any palette.
        { id: 'road-label-major', type: 'symbol', source: 'omt', 'source-layer': 'transportation_name',
          minzoom: 12,
          filter: ['in', ['get', 'class'], ['literal', ['motorway', 'trunk', 'primary']]],
          layout: {
            'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name'], ['get', 'ref']],
            'text-font': TEXT_FONT,
            'text-size': 11,
            'symbol-placement': 'line',
            'text-letter-spacing': 0.05,
          },
          paint: { 'text-color': C.label, 'text-halo-color': C.bg, 'text-halo-width': 1.5 } },
        { id: 'road-label-minor', type: 'symbol', source: 'omt', 'source-layer': 'transportation_name',
          minzoom: 14,
          filter: ['in', ['get', 'class'], ['literal', ['secondary', 'tertiary', 'minor']]],
          layout: {
            'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']],
            'text-font': TEXT_FONT,
            'text-size': 10,
            'symbol-placement': 'line',
          },
          paint: { 'text-color': C.labelDim, 'text-halo-color': C.bg, 'text-halo-width': 1.5 } },

        // Mountain peaks — small ▲ glyph + name. NMK has Korab,
        // Šara, Vodno, Pelister; nice landscape context.
        { id: 'peak', type: 'symbol', source: 'omt', 'source-layer': 'mountain_peak',
          minzoom: 10,
          layout: {
            'text-field': ['concat', '▲ ', ['coalesce', ['get', 'name:en'], ['get', 'name'], '']],
            'text-font': TEXT_FONT,
            'text-size': 10,
          },
          paint: { 'text-color': C.labelDim, 'text-halo-color': C.bg, 'text-halo-width': 1.5 } },

        // POIs at high zoom — tiny dot, name above it. Schools,
        // restaurants, shops, etc. Off below z14 to keep the map
        // legible at city scale.
        { id: 'poi-dot', type: 'circle', source: 'omt', 'source-layer': 'poi',
          minzoom: 14,
          paint: { 'circle-radius': 2, 'circle-color': C.poi, 'circle-opacity': 0.7 } },
        { id: 'poi-label', type: 'symbol', source: 'omt', 'source-layer': 'poi',
          minzoom: 16,
          layout: {
            'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name'], ''],
            'text-font': TEXT_FONT,
            'text-size': 9,
            'text-anchor': 'top',
            'text-offset': [0, 0.5],
          },
          paint: { 'text-color': C.poi, 'text-halo-color': C.bg, 'text-halo-width': 1.5 } },

        // Place names last so they sit on top of everything else.
        { id: 'place-city', type: 'symbol', source: 'omt', 'source-layer': 'place',
          filter: ['in', ['get', 'class'], ['literal', ['country', 'state', 'city']]],
          layout: {
            'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']],
            'text-font': TEXT_FONT,
            'text-size': 13,
            'text-letter-spacing': 0.05,
          },
          paint: { 'text-color': C.label, 'text-halo-color': C.bg, 'text-halo-width': 1.5 } },
        { id: 'place-town', type: 'symbol', source: 'omt', 'source-layer': 'place',
          filter: ['in', ['get', 'class'], ['literal', ['town', 'village']]],
          minzoom: 9,
          layout: {
            'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']],
            'text-font': TEXT_FONT,
            'text-size': 11,
          },
          paint: { 'text-color': C.labelDim, 'text-halo-color': C.bg, 'text-halo-width': 1.5 } },
      ],
    };
  }

  // Pick the initial theme: localStorage > system preference > dark.
  // The same detection runs in <head> before paint to colour the
  // splash; this re-reads to drive the map and the toggle button.
  function readInitialTheme() {
    try {
      const saved = localStorage.getItem(THEME_KEY);
      if (saved === 'light' || saved === 'dark') return saved;
    } catch (_) {}
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  let currentTheme = readInitialTheme();

  // ---- Map ----
  const map = new maplibregl.Map({
    container: 'map',
    style: buildStyle(currentTheme),
    center: NMK_CENTER,
    zoom: NMK_ZOOM,
    attributionControl: false,
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false, visualizePitch: false }), 'top-right');
  map.addControl(new maplibregl.AttributionControl({
    compact: true,
    customAttribution:
      '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · tiles built with <a href="https://github.com/onthegomap/planetiler">planetiler</a>',
  }), 'bottom-right');

  // ---- User position pin (HTML element marker) ----
  const pinEl = document.createElement('div');
  pinEl.className = 'me-pin';
  pinEl.innerHTML = '<div class="me-pin-ring"></div><div class="me-pin-dot"></div>';
  const pinMarker = new maplibregl.Marker({ element: pinEl, anchor: 'center' });

  // ---- Accuracy circle as a GeoJSON polygon source ----
  // MapLibre doesn't have a built-in "circle in metres" primitive, so
  // we bake the polygon ourselves and update the source on each fix.
  function circlePolygon(lng, lat, radiusMeters, points = 64) {
    const dLat = radiusMeters / 111320;
    const dLng = radiusMeters / (111320 * Math.cos((lat * Math.PI) / 180));
    const ring = [];
    for (let i = 0; i < points; i++) {
      const t = (i / points) * 2 * Math.PI;
      ring.push([lng + dLng * Math.cos(t), lat + dLat * Math.sin(t)]);
    }
    ring.push(ring[0]);
    return {
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [ring] },
      properties: {},
    };
  }
  const EMPTY_FC = { type: 'FeatureCollection', features: [] };

  // Re-add the user position layers after every style swap. The Marker
  // (a DOM element on the canvas container) survives setStyle on its
  // own, but our GeoJSON source has to be re-registered each time.
  function addUserLayers() {
    if (map.getSource('me-accuracy')) return;
    map.addSource('me-accuracy', { type: 'geojson', data: EMPTY_FC });
    map.addLayer({
      id: 'me-accuracy-fill', type: 'fill', source: 'me-accuracy',
      paint: { 'fill-color': '#fb923c', 'fill-opacity': 0.08 },
    });
    map.addLayer({
      id: 'me-accuracy-line', type: 'line', source: 'me-accuracy',
      paint: { 'line-color': '#fb923c', 'line-width': 1.5, 'line-opacity': 0.5 },
    });
    if (lastFixCoords) {
      map.getSource('me-accuracy').setData(circlePolygon.apply(null, lastFixCoords));
    }
  }

  let mapReady = false;
  let pendingFix = null;
  map.on('load', () => {
    addUserLayers();
    mapReady = true;
    if (pendingFix) { applyFix(pendingFix); pendingFix = null; }
  });
  // Style changes (theme toggle) reset the layer set; re-add ours.
  map.on('style.load', () => { if (mapReady) addUserLayers(); });

  // ---- Helpers ----
  function setStatus(state, text) {
    statusEl.dataset.state = state;
    statusText.textContent = text;
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

  // Wrap programmatic camera moves so dragstart can tell user pans
  // apart from our auto-recentre. flag flips back on the next moveend.
  let movingUs = false;
  function moveProgrammatically(fn) {
    movingUs = true;
    map.once('moveend', () => { movingUs = false; });
    fn();
  }

  // ---- Geolocation handlers ----
  let firstFix = true;
  let follow = true;
  let lastFixTs = 0;
  let lastFixCoords = null; // [lng, lat, accuracy]
  let watchId = null;
  let suspended = false;

  function applyFix(pos) {
    const { latitude, longitude, accuracy } = pos.coords;
    lastFixCoords = [longitude, latitude, accuracy];
    pinMarker.setLngLat([longitude, latitude]).addTo(map);
    map.getSource('me-accuracy').setData(circlePolygon(longitude, latitude, accuracy));

    if (firstFix) {
      moveProgrammatically(() => map.flyTo({ center: [longitude, latitude], zoom: FIX_ZOOM, duration: 800 }));
      firstFix = false;
    } else if (follow) {
      moveProgrammatically(() => map.panTo([longitude, latitude], { duration: 400 }));
    }
    setStatus('active', 'Live');
    metaAcc.textContent = fmtAccuracy(accuracy);
    refreshTime();
  }

  function onFix(pos) {
    lastFixTs = pos.timestamp || Date.now();
    if (!mapReady) { pendingFix = pos; return; }
    applyFix(pos);
  }
  function onError(err) {
    let msg = 'Location unavailable';
    if (err && err.code === 1) msg = 'Location denied';
    else if (err && err.code === 3) msg = 'Location timed out';
    setStatus('error', msg);
  }

  function startWatch() {
    if (!navigator.geolocation) { setStatus('error', 'Not supported'); return; }
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

  // Pause the watch when the iframe is hidden; resume on return.
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
    if (on && pinMarker.getLngLat()) {
      moveProgrammatically(() => map.panTo(pinMarker.getLngLat(), { duration: 300 }));
    }
  }
  followBtn.addEventListener('click', () => setFollow(!follow));

  // User-initiated drag turns Follow off; programmatic moves opt out
  // via movingUs.
  map.on('dragstart', () => { if (!movingUs && follow) setFollow(false); });

  // ---- Theme toggle ----
  function applyTheme(theme) {
    currentTheme = theme;
    document.documentElement.dataset.theme = theme;
    themeBtn.textContent = theme === 'dark' ? 'Light' : 'Dark';
    try { localStorage.setItem(THEME_KEY, theme); } catch (_) {}
    // Re-set the entire map style with the new palette. The Marker
    // survives (DOM element), the accuracy source/layers are re-added
    // by the style.load handler above.
    map.setStyle(buildStyle(theme), { diff: false });
  }
  // Reflect the initial theme on the toggle label.
  themeBtn.textContent = currentTheme === 'dark' ? 'Light' : 'Dark';
  themeBtn.addEventListener('click', () => {
    applyTheme(currentTheme === 'dark' ? 'light' : 'dark');
  });

  // ---- Buttons ----
  retryBtn.addEventListener('click', () => { stopWatch(); startWatch(); });

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

  // Hide the inline splash with a 1s minimum so it's not a flash.
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
