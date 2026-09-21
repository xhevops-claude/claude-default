/* Language: the interface, the legend, object names and dimension
   labels, in English or German. */

/* ── language ─────────────────────────────────────────── */

/* English is the source; German is looked up by the English string, so
   a scene keeps its names and anything without an entry falls back. The
   choice is remembered on the device. */
export const DE = {
  Settings: 'Einstellungen', Close: 'Schließen', Navigation: 'Navigation', Object: 'Objekt', Camera: 'Kamera',
  Language: 'Sprache',
  'Drag orbits the scene, pinch or wheel zooms, two fingers pan.': 'Ziehen kreist um die Szene, Kneifen oder Rad zoomt, zwei Finger verschieben.',
  'Drag turns the camera, pinch or wheel walks it, two fingers slide it.': 'Ziehen dreht die Kamera, Kneifen oder Rad bewegt sie vor und zurück, zwei Finger verschieben sie.',
  Fit: 'Einpassen', Faces: 'Flächen', Floors: 'Böden', Dots: 'Punkte', Ground: 'Gelände', Spin: 'Drehen', Defects: 'Mängel',
  east: 'Ost', up: 'oben', south: 'Süd', 'site falls': 'Gelände fällt',
  House: 'Haus', Cantilever: 'Auskragung', Driveway: 'Einfahrt', 'Retaining walls': 'Stützmauern', Road: 'Straße',
  Garage: 'Garage', 'Ground floor': 'Erdgeschoss', 'First floor': 'Obergeschoss',
  'Cantilever over the door': 'Auskragung über dem Tor', 'Apron, in front of the door': 'Vorplatz vor dem Tor',
  'Driveway, down to the road': 'Einfahrt hinunter zur Straße',
  'Garage wall, south': 'Garagenwand Süd', 'Garage wall, west': 'Garagenwand West', 'Garage wall, north': 'Garagenwand Nord',
  'Retaining wall': 'Stützmauer', 'Retaining wall, tapering out': 'Stützmauer, auslaufend',
  'Corner fillet, wall': 'Eckrundung, Mauer', 'Retaining wall, uphill side': 'Stützmauer bergseitig',
  'Entrance mouth, wall': 'Einfahrtstrichter, Mauer',
  run: 'Lauf', flare: 'Trichter', along: 'entlang', over: 'über', rise: 'Anstieg',
  Parcel: 'Parzelle', 'Parcel boundary, 705 m²': 'Parzellengrenze, 705 m²', 'Existing building': 'Bestandsgebäude',
  Relief: 'Relief', Excavation: 'Aushub', 'Excavation for': 'Aushub für', 'Excavation for the house': 'Aushub für das Haus', depth: 'Tiefe', 'Nothing built yet': 'Noch nichts gebaut', buildings: 'Gebäude', floor: 'Geschoss',
  Buildings: 'Gebäude', 'Buildable areas': 'Bebaubare Flächen', Parcels: 'Parzellen', Cadastre: 'Kataster', Street: 'Straße',
  'Ground floor': 'Erdgeschoss', '1st floor': '1. Obergeschoss', '2nd floor': '2. Obergeschoss', Attic: 'Dachgeschoss',
  'Basement −1': 'Untergeschoss −1', 'Basement −2': 'Untergeschoss −2', 'Garage floor': 'Garagengeschoss', 'Cadastral line': 'Katasterlinie',
  Recent: 'Zuletzt', 'No projects yet.': 'Noch keine Projekte.', Projects: 'Projekte', 'All projects': 'Alle Projekte', 'A viewer for sites and the buildings drawn for them. Pick a project.': 'Ein Betrachter für Grundstücke und die darauf gezeichneten Gebäude. Wähle ein Projekt.', 'The project list could not be loaded.': 'Die Projektliste konnte nicht geladen werden.', 'This project could not be loaded.': 'Dieses Projekt konnte nicht geladen werden.',
  Layers: 'Ebenen', 'All layers': 'Alle Ebenen', Save: 'Speichern', Reset: 'Zurücksetzen',
  Drawing: 'Zeichnung', Objects: 'Objekte', 'Ground grid': 'Bodenraster',
  'Relief points': 'Reliefpunkte', 'Relief surface': 'Reliefoberfläche', 'Contours 1 m': 'Höhenlinien 1 m', 'Contours 5 m': 'Höhenlinien 5 m', 'Contour labels': 'Höhenbeschriftung', 'Relief grid': 'Reliefraster',
};
export let LANG = (() => {
  try { const v = localStorage.getItem('planner-lang'); if (v === 'de' || v === 'en') return v; } catch (err) { /* private mode */ }
  return (navigator.language || '').toLowerCase().startsWith('de') ? 'de' : 'en';
})();
export const t = (key) => (LANG === 'de' ? DE[key] ?? key : key);
/* A dimension label: its words translated, and a decimal comma. */
export const tDim = (label) => {
  if (LANG !== 'de') return label;
  return label.replace(/\b(run|flare|along|over|rise|depth)\b/g, (w) => DE[w]).replace(/(\d)\.(\d)/g, '$1,$2');
};

/* ── what the box is ──────────────────────────────────── */

/* The downhill face: which world axis the site falls along, and which
/* The choice, remembered on the device across every project. */
export function setLang(v) {
  LANG = v;
  try { localStorage.setItem('planner-lang', LANG); } catch (err) { /* private mode */ }
}
