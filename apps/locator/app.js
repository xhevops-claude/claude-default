(function () {
  const statusEl = document.getElementById('status');
  const statusText = document.getElementById('status-text');
  const metaAcc = document.getElementById('meta-acc');
  const metaTime = document.getElementById('meta-time');
  const followBtn = document.getElementById('follow-btn');
  const retryBtn = document.getElementById('retry-btn');
  const themeBtn = document.getElementById('theme-btn');
  const layersBtn = document.getElementById('layers-btn');
  const layersPopover = document.getElementById('layers-popover');
  const layersList = document.getElementById('layers-list');
  const quitBtn = document.getElementById('quit-btn');

  // Self-hosted vector tiles from the daily Geofabrik → planetiler
  // pipeline. Same origin as this iframe, so no CORS dance.
  const PMTILES_URL =
    'https://xhevops-claude.github.io/claude-default/cdn/maps/pmtiles/north-macedonia.pmtiles';

  const NMK_CENTER = [21.7453, 41.6086];
  const NMK_ZOOM = 7;
  const FIX_ZOOM = 15;
  const THEME_KEY = 'locator-theme';
  const LAYER_KEY_PREFIX = 'locator-layer-';

  // pmtiles → MapLibre custom protocol
  const pmtilesProtocol = new pmtiles.Protocol();
  maplibregl.addProtocol('pmtiles', pmtilesProtocol.tile);

  // Two palettes for the OpenMapTiles schema. Keys describe the role
  // each colour plays so the same style code drives both themes.
  const THEMES = {
    dark: {
      bg: '#1a1d24',
      land: '#22262e',
      landuse: '#252a33',
      park: '#1f2a23',
      water: '#0f1419',
      waterLabel: '#5b8db1',
      road: '#3d4148',
      roadMid: '#4a4f57',
      roadHi: '#5a6068',
      roadTop: '#6b7178',
      rail: '#3a3f45',
      runway: '#3a3f45',
      boundary: '#3a4048',
      building: '#262a32',
      label: '#cbd5e1',
      labelStrong: '#e2e8f0',
      labelDim: '#94a3b8',
      poi: '#94a3b8',
    },
    light: {
      bg: '#f5f3ee',
      land: '#ecead8',
      landuse: '#e6dccd',
      park: '#cce0c2',
      water: '#aacbe2',
      waterLabel: '#3b6ea3',
      road: '#ffffff',
      roadMid: '#ffffff',
      roadHi: '#ffe9b0',
      roadTop: '#ffc36b',
      rail: '#a8a6a0',
      runway: '#c9c3b3',
      boundary: '#998888',
      building: '#dfd6c5',
      label: '#1a1d24',
      labelStrong: '#0c1118',
      labelDim: '#525866',
      poi: '#525866',
    },
  };
  const TEXT_FONT = ['Noto Sans Regular'];

  // Logical groups organised into categories for the Layers UI. Each
  // group toggles one or more style layer ids; keys also drive the
  // localStorage entry name (`locator-layer-<key>`).
  const LAYER_CATEGORIES = [
    {
      name: 'Land',
      groups: {
        landuse:       { label: 'Landuse',     defaultOn: true, layers: ['landcover', 'landuse', 'park'] },
        water:         { label: 'Water',       defaultOn: true, layers: ['water', 'waterway'] },
        'water-names': { label: 'Water names', defaultOn: true, layers: ['water-name'] },
      },
    },
    {
      name: 'Transport',
      groups: {
        roads:        { label: 'Roads',      defaultOn: true, layers: ['road-rail', 'road-minor', 'road-secondary', 'road-primary', 'road-motorway'] },
        'road-names': { label: 'Road names', defaultOn: true, layers: ['road-label-major', 'road-label-minor'] },
        aeroways:     { label: 'Airports',   defaultOn: true, layers: ['aeroway-fill', 'aeroway-line', 'aerodrome-label'] },
      },
    },
    {
      name: 'Places',
      groups: {
        places: { label: 'Places', defaultOn: true, layers: ['place-country', 'place-state', 'place-city', 'place-town', 'place-village'] },
        peaks:  { label: 'Peaks',  defaultOn: true, layers: ['peak'] },
      },
    },
    {
      name: 'Detail',
      groups: {
        buildings:  { label: 'Buildings', defaultOn: true, layers: ['building'] },
        pois:       { label: 'POIs',      defaultOn: true, layers: ['poi-dot', 'poi-label'] },
        boundaries: { label: 'Borders',   defaultOn: true, layers: ['boundary'] },
      },
    },
  ];
  // Flat lookup so setGroupVisible / isGroupVisible can resolve a
  // group key without walking the categories.
  const LAYER_GROUPS = {};
  LAYER_CATEGORIES.forEach((cat) => {
    Object.entries(cat.groups).forEach(([k, v]) => { LAYER_GROUPS[k] = v; });
  });

  function buildStyle(themeName) {
    const C = THEMES[themeName] || THEMES.dark;
    return {
      version: 8,
      glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
      sources: { omt: { type: 'vector', url: 'pmtiles://' + PMTILES_URL } },
      layers: [
        { id: 'bg', type: 'background', paint: { 'background-color': C.bg } },

        // ---- Land + water ----
        { id: 'landcover', type: 'fill', source: 'omt', 'source-layer': 'landcover', paint: { 'fill-color': C.land } },
        { id: 'landuse',   type: 'fill', source: 'omt', 'source-layer': 'landuse',   paint: { 'fill-color': C.landuse } },
        { id: 'park',      type: 'fill', source: 'omt', 'source-layer': 'park',      paint: { 'fill-color': C.park } },
        { id: 'water',     type: 'fill', source: 'omt', 'source-layer': 'water',     paint: { 'fill-color': C.water } },
        { id: 'waterway',  type: 'line', source: 'omt', 'source-layer': 'waterway',  paint: { 'line-color': C.water, 'line-width': 1 } },

        // ---- Aerodromes (runways/taxiways + terminal areas) ----
        { id: 'aeroway-fill', type: 'fill', source: 'omt', 'source-layer': 'aeroway',
          filter: ['==', ['geometry-type'], 'Polygon'],
          paint: { 'fill-color': C.runway, 'fill-opacity': 0.5 } },
        { id: 'aeroway-line', type: 'line', source: 'omt', 'source-layer': 'aeroway',
          filter: ['==', ['geometry-type'], 'LineString'],
          paint: { 'line-color': C.runway, 'line-width': 1.5 } },

        // ---- Road network — drawn in priority order so big roads sit on top ----
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

        // ---- Buildings + admin boundaries ----
        { id: 'building', type: 'fill', source: 'omt', 'source-layer': 'building',
          minzoom: 14, paint: { 'fill-color': C.building } },
        { id: 'boundary', type: 'line', source: 'omt', 'source-layer': 'boundary',
          filter: ['<=', ['coalesce', ['get', 'admin_level'], 99], 4],
          paint: { 'line-color': C.boundary, 'line-width': 0.8, 'line-dasharray': [2, 2] } },

        // ---- Road labels (street names along the line) ----
        { id: 'road-label-major', type: 'symbol', source: 'omt', 'source-layer': 'transportation_name',
          minzoom: 11,
          filter: ['in', ['get', 'class'], ['literal', ['motorway', 'trunk', 'primary']]],
          layout: {
            'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name'], ['get', 'ref']],
            'text-font': TEXT_FONT,
            'text-size': ['interpolate', ['linear'], ['zoom'], 11, 10, 16, 12],
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

        // ---- Mountain peaks (▲ + name) ----
        { id: 'peak', type: 'symbol', source: 'omt', 'source-layer': 'mountain_peak',
          minzoom: 9,
          layout: {
            'text-field': ['concat', '▲ ', ['coalesce', ['get', 'name:en'], ['get', 'name'], '']],
            'text-font': TEXT_FONT,
            'text-size': 11,
          },
          paint: { 'text-color': C.labelDim, 'text-halo-color': C.bg, 'text-halo-width': 1.5 } },

        // ---- Water names (lakes, big rivers) ----
        { id: 'water-name', type: 'symbol', source: 'omt', 'source-layer': 'water_name',
          minzoom: 8,
          layout: {
            'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name'], ''],
            'text-font': TEXT_FONT,
            'text-size': ['interpolate', ['linear'], ['zoom'], 8, 11, 14, 14],
            'text-transform': 'none',
            'text-font-style': 'italic',
          },
          paint: { 'text-color': C.waterLabel, 'text-halo-color': C.bg, 'text-halo-width': 1.5 } },

        // ---- Aerodrome labels ----
        { id: 'aerodrome-label', type: 'symbol', source: 'omt', 'source-layer': 'aerodrome_label',
          minzoom: 9,
          layout: {
            'text-field': ['concat', '✈ ', ['coalesce', ['get', 'name:en'], ['get', 'name'], '']],
            'text-font': TEXT_FONT,
            'text-size': 11,
          },
          paint: { 'text-color': C.label, 'text-halo-color': C.bg, 'text-halo-width': 1.5 } },

        // ---- POIs at high zoom ----
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

        // ---- Place hierarchy (last so labels win the depth fight) ----
        // Country: visible from world zoom; uppercase, big.
        { id: 'place-country', type: 'symbol', source: 'omt', 'source-layer': 'place',
          filter: ['==', ['get', 'class'], 'country'],
          minzoom: 3,
          layout: {
            'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']],
            'text-font': TEXT_FONT,
            'text-size': ['interpolate', ['linear'], ['zoom'], 3, 12, 7, 18],
            'text-letter-spacing': 0.15,
            'text-transform': 'uppercase',
            'text-max-width': 8,
          },
          paint: { 'text-color': C.labelStrong, 'text-halo-color': C.bg, 'text-halo-width': 2 } },
        // Region/state — softer than country.
        { id: 'place-state', type: 'symbol', source: 'omt', 'source-layer': 'place',
          filter: ['==', ['get', 'class'], 'state'],
          minzoom: 5,
          layout: {
            'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']],
            'text-font': TEXT_FONT,
            'text-size': ['interpolate', ['linear'], ['zoom'], 5, 11, 9, 14],
            'text-letter-spacing': 0.08,
          },
          paint: { 'text-color': C.labelDim, 'text-halo-color': C.bg, 'text-halo-width': 1.5 } },
        // Cities — capital + major cities visible early.
        { id: 'place-city', type: 'symbol', source: 'omt', 'source-layer': 'place',
          filter: ['==', ['get', 'class'], 'city'],
          minzoom: 5,
          layout: {
            'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']],
            'text-font': TEXT_FONT,
            'text-size': ['interpolate', ['linear'], ['zoom'], 5, 13, 12, 20],
            'text-letter-spacing': 0.05,
          },
          paint: { 'text-color': C.label, 'text-halo-color': C.bg, 'text-halo-width': 1.8 } },
        // Towns — medium settlements.
        { id: 'place-town', type: 'symbol', source: 'omt', 'source-layer': 'place',
          filter: ['==', ['get', 'class'], 'town'],
          minzoom: 8,
          layout: {
            'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']],
            'text-font': TEXT_FONT,
            'text-size': ['interpolate', ['linear'], ['zoom'], 8, 11, 14, 15],
          },
          paint: { 'text-color': C.label, 'text-halo-color': C.bg, 'text-halo-width': 1.5 } },
        // Villages/suburbs — only at high zoom.
        { id: 'place-village', type: 'symbol', source: 'omt', 'source-layer': 'place',
          filter: ['in', ['get', 'class'], ['literal', ['village', 'suburb', 'hamlet']]],
          minzoom: 11,
          layout: {
            'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']],
            'text-font': TEXT_FONT,
            'text-size': 11,
          },
          paint: { 'text-color': C.labelDim, 'text-halo-color': C.bg, 'text-halo-width': 1.5 } },
      ],
    };
  }

  // Initial theme: localStorage > system preference > dark.
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

  // ---- User pin + accuracy circle ----
  const pinEl = document.createElement('div');
  pinEl.className = 'me-pin';
  pinEl.innerHTML = '<div class="me-pin-ring"></div><div class="me-pin-dot"></div>';
  const pinMarker = new maplibregl.Marker({ element: pinEl, anchor: 'center' });

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
    applyAllGroupVisibility();
    mapReady = true;
    if (pendingFix) { applyFix(pendingFix); pendingFix = null; }
  });
  map.on('style.load', () => {
    if (!mapReady) return;
    addUserLayers();
    applyAllGroupVisibility();
  });

  // ---- Helpers ----
  // The Locate-me button is hidden only when we have a live fix.
  // Keeping it visible during 'locating' matters because some
  // platforms (notably iOS Safari in iframes) silently block
  // watchPosition until the user makes an explicit gesture — the
  // visible button gives them a way to retry.
  function setStatus(state, text) {
    statusEl.dataset.state = state;
    statusText.textContent = text;
    retryBtn.hidden = (state === 'active');
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

  let movingUs = false;
  function moveProgrammatically(fn) {
    movingUs = true;
    map.once('moveend', () => { movingUs = false; });
    fn();
  }

  // ---- Geolocation ----
  let firstFix = true;
  let follow = true;
  let lastFixTs = 0;
  let lastFixCoords = null;
  let watchId = null;
  let suspended = false;

  function applyFix(pos) {
    const { latitude, longitude, accuracy } = pos.coords;
    lastFixCoords = [longitude, latitude, accuracy];
    clearWatchdog();
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
  let watchdog = null;
  function clearWatchdog() {
    if (watchdog) { clearTimeout(watchdog); watchdog = null; }
  }
  function startWatch() {
    if (!navigator.geolocation) { setStatus('error', 'Not supported'); return; }
    if (watchId !== null) return;
    setStatus('locating', 'Locating…');
    // Some platforms (notably iOS Safari in iframes) stall
    // watchPosition silently — no fix, no error. After 8s without
    // progress, surface a clearer hint so the user knows to tap
    // Locate me to nudge it.
    clearWatchdog();
    watchdog = setTimeout(() => {
      if (lastFixTs === 0 && statusEl.dataset.state === 'locating') {
        setStatus('locating', 'Tap Locate me');
      }
    }, 8000);
    watchId = navigator.geolocation.watchPosition(onFix, onError, {
      enableHighAccuracy: true, maximumAge: 5000, timeout: 15000,
    });
  }
  function stopWatch() {
    clearWatchdog();
    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { suspended = true; stopWatch(); }
    else if (suspended) { suspended = false; startWatch(); }
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
  map.on('dragstart', () => { if (!movingUs && follow) setFollow(false); });

  // ---- Theme toggle ----
  function applyTheme(theme) {
    currentTheme = theme;
    document.documentElement.dataset.theme = theme;
    themeBtn.textContent = theme === 'dark' ? 'Light' : 'Dark';
    try { localStorage.setItem(THEME_KEY, theme); } catch (_) {}
    map.setStyle(buildStyle(theme), { diff: false });
  }
  themeBtn.textContent = currentTheme === 'dark' ? 'Light' : 'Dark';
  themeBtn.addEventListener('click', () => {
    applyTheme(currentTheme === 'dark' ? 'light' : 'dark');
  });

  // ---- Layers UI ----
  function isGroupVisible(group) {
    try {
      const v = localStorage.getItem(LAYER_KEY_PREFIX + group);
      if (v === 'true' || v === 'false') return v === 'true';
    } catch (_) {}
    const def = LAYER_GROUPS[group];
    return def ? def.defaultOn : true;
  }
  function setGroupVisible(group, visible, persist = true) {
    const def = LAYER_GROUPS[group];
    if (!def) return;
    def.layers.forEach((id) => {
      if (map.getLayer(id)) {
        map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
      }
    });
    if (persist) {
      try { localStorage.setItem(LAYER_KEY_PREFIX + group, String(visible)); } catch (_) {}
    }
  }
  function applyAllGroupVisibility() {
    Object.keys(LAYER_GROUPS).forEach((g) => setGroupVisible(g, isGroupVisible(g), false));
  }

  function buildLayersPanel() {
    layersList.innerHTML = LAYER_CATEGORIES.map((cat) => {
      const items = Object.entries(cat.groups).map(([key, def]) => {
        const checked = isGroupVisible(key) ? ' checked' : '';
        return `<li><label><input type="checkbox" data-group="${key}"${checked}>${def.label}</label></li>`;
      }).join('');
      return `<li class="layers-cat-head">${cat.name}</li>${items}`;
    }).join('');
    layersList.querySelectorAll('input[type="checkbox"]').forEach((input) => {
      input.addEventListener('change', (e) => {
        setGroupVisible(e.target.dataset.group, e.target.checked);
      });
    });
  }
  buildLayersPanel();

  function setLayersOpen(open) {
    layersPopover.hidden = !open;
    layersBtn.setAttribute('aria-expanded', String(open));
  }
  layersBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    setLayersOpen(layersPopover.hidden);
  });
  // Click-away dismiss.
  document.addEventListener('click', (e) => {
    if (layersPopover.hidden) return;
    if (layersPopover.contains(e.target) || layersBtn.contains(e.target)) return;
    setLayersOpen(false);
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
