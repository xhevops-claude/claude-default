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
  Garage: 'Garage', 'Ground floor': 'Erdgeschoss', Slabs: 'Decken', 'Garage slab': 'Bodenplatte Garage', 'Ground floor slab': 'Decke über der Garage', 'First floor slab': 'Decke über dem Erdgeschoss', 'First floor': 'Obergeschoss',
  'Balcony over the garage': 'Balkon über der Garage', 'Apron, in front of the door': 'Vorplatz vor dem Tor',
  'Front wall, north of the door': 'Vorderwand nördlich des Tors', 'Front wall, south of the door': 'Vorderwand südlich des Tors', 'Front, north': 'Vorn, Nord', 'Front, south': 'Vorn, Süd', 'Lintel over the door, 5.00 × 2.25 opening': 'Sturz über dem Tor, Öffnung 5,00 × 2,25', Lintel: 'Sturz',
  'Stair to the hall': 'Treppe zur Diele', 'Railing along the flight, treads 1 to 4, 1.0 m above the top one': 'Geländer am Lauf, Stufen 1 bis 4, 1,0 m über der obersten', 'Railing along the flight, treads 5 to 8, 1.0 m above the top one': 'Geländer am Lauf, Stufen 5 bis 8, 1,0 m über der obersten', 'Railing along the flight, treads 9 to 12, 1.0 m above the top one': 'Geländer am Lauf, Stufen 9 bis 12, 1,0 m über der obersten', 'Railing along the flight, treads 13 to 16, 1.0 m above the top one': 'Geländer am Lauf, Stufen 13 bis 16, 1,0 m über der obersten', 'Railing 1': 'Geländer 1', 'Railing 2': 'Geländer 2', 'Railing 3': 'Geländer 3', 'Railing 4': 'Geländer 4', 'Landing inside the door, 1.36 × 1.00': 'Antritt hinter dem Tor, 1,36 × 1,00', Landing: 'Antritt', 'Storage under the stair, 2.25 long, 2.7 to 1.2 high, open to the garage': 'Abstellraum unter der Treppe, 2,25 lang, 2,7 bis 1,2 hoch, zur Garage offen', 'Storage under': 'Abstellraum',
  'Parking slots': 'Stellplätze', Walls: 'Wände', Storey: 'Geschoss', Slab: 'Decke', 'Slab 1': 'Decke 1', 'Slab 2': 'Decke 2', 'Slab 3': 'Decke 3', 'Slab 4': 'Decke 4', Treads: 'Stufen', Railing: 'Geländer', Balcony: 'Balkon', 'Part of': 'Teil von', 'Car slot, 2.60 × 6.00': 'Stellplatz Auto, 2,60 × 6,00', Car: 'Auto', 'Second slot, 2.75 × 6.00: the quad, or a second car': 'Zweiter Stellplatz, 2,75 × 6,00: das Quad oder ein zweites Auto', Second: 'Zweiter',
  /* the ground floor */
  Rooms: 'Räume', Hall: 'Diele', 'Hall: the landing at the stair top and the lobby south of it, 6.9 m²': 'Diele: der Austritt der Treppe und der Vorraum südlich davon, 6,9 m²', Toilet: 'WC', 'Toilet, 1.20 × 1.80, 2.2 m²': 'WC, 1,20 × 1,80, 2,2 m²', Bedroom: 'Schlafzimmer', 'Bedroom, 3.30 × 3.20, 10.6 m², window to the yard': 'Schlafzimmer, 3,30 × 3,20, 10,6 m², Fenster zum Hof', 'Living room': 'Wohnraum', 'Living room with kitchen, 4.00 × 5.20, 20.8 m², open to the roof': 'Wohnraum mit Küche, 4,00 × 5,20, 20,8 m², offen bis zum Dach',
  'Open to the roof': 'Offen bis zum Dach', 'To the eaves': 'Bis zur Traufe', 'Under the north slope': 'Unter der Dachfläche Nord', 'Under the south slope': 'Unter der Dachfläche Süd',
  'Outer walls': 'Außenwände', 'Outer wall, north': 'Außenwand Nord', 'Outer wall, west, against the hill': 'Außenwand West, am Hang', 'North, tall': 'Nord, hoch', 'South, tall': 'Süd, hoch',
  'Panorama glass': 'Panoramaglas', 'North half': 'Nordhälfte', 'South half': 'Südhälfte', 'Over the door': 'Über der Tür', 'South end': 'Südende', 'Balcony door': 'Balkontür', 'Door to the balcony in the glass, 1.00 × 2.30': 'Balkontür im Glas, 1,00 × 2,30',
  'Windows and doors': 'Fenster und Türen', 'Bedroom window': 'Schlafzimmerfenster', 'Bedroom window to the yard, 1.40 × 1.30, sill 0.90': 'Schlafzimmerfenster zum Hof, 1,40 × 1,30, Brüstung 0,90', 'Yard door': 'Hoftür', 'Yard door in the south wall, 0.90, glazed, swings in: the entrance from the yard': 'Hoftür in der Südwand, 0,90, verglast, nach innen: der Eingang vom Hof', 'South window': 'Fenster Süd', 'Window to the yard by the sofa, 1.40 × 1.30, sill 0.90': 'Fenster zum Hof beim Sofa, 1,40 × 1,30, Brüstung 0,90', 'Toilet door': 'WC-Tür', 'Toilet door, 0.80, swings in': 'WC-Tür, 0,80, nach innen', 'Bedroom door': 'Schlafzimmertür', 'Bedroom door, 0.90, swings in': 'Schlafzimmertür, 0,90, nach innen',
  Partitions: 'Innenwände', Kitchen: 'Küche', Counter: 'Arbeitsplatte', 'Kitchen counter along the bedroom wall, 3.20 × 0.60, 0.90 high': 'Küchenzeile an der Schlafzimmerwand, 3,20 × 0,60, 0,90 hoch',
  'Stair to the first floor': 'Treppe zum Obergeschoss', Balustrade: 'Brüstung', 'Balustrade 1': 'Brüstung 1', 'Balustrade 2': 'Brüstung 2', 'Balustrade 3': 'Brüstung 3', 'Balustrade 4': 'Brüstung 4',
  'Gallery railing': 'Galeriegeländer', 'Gallery railing on the first floor’s edge over the living room, 1.0 high': 'Galeriegeländer an der Kante des Obergeschosses über dem Wohnraum, 1,0 hoch',
  Roof: 'Dach', 'North slope': 'Dachfläche Nord', 'South slope': 'Dachfläche Süd',
  'Driveway, down to the road': 'Einfahrt hinunter zur Straße',
  'Garage walls': 'Garagenwände', South: 'Süd', West: 'West', North: 'Nord', 'Garage wall, south': 'Garagenwand Süd', 'Garage wall, west': 'Garagenwand West', 'Garage wall, north': 'Garagenwand Nord',
  'Retaining wall': 'Stützmauer', 'Retaining wall, tapering out': 'Stützmauer, auslaufend',
  'Corner fillet, wall': 'Eckrundung, Mauer', 'Retaining wall, uphill side': 'Stützmauer bergseitig',
  'Entrance mouth, wall': 'Einfahrtstrichter, Mauer',
  run: 'Lauf', flare: 'Trichter', along: 'entlang', over: 'über', rise: 'Anstieg',
  Parcel: 'Parzelle', 'Parcel boundary, 705 m²': 'Parzellengrenze, 705 m²', 'Existing building': 'Bestandsgebäude',
  Relief: 'Relief', Excavation: 'Aushub', 'Excavation for': 'Aushub für', 'the house': 'das Haus', 'the driveway': 'die Einfahrt', 'the yard': 'der Hof', depth: 'Tiefe', 'Nothing built yet': 'Noch nichts gebaut', buildings: 'Gebäude', floor: 'Geschoss',
  Buildings: 'Gebäude', 'Buildable areas': 'Bebaubare Flächen', Parcels: 'Parzellen', Cadastre: 'Kataster', Street: 'Straße',
  'Ground floor': 'Erdgeschoss', '1st floor': '1. Obergeschoss', '2nd floor': '2. Obergeschoss', Attic: 'Dachgeschoss',
  'Basement −1': 'Untergeschoss −1', 'Basement −2': 'Untergeschoss −2', 'Garage floor': 'Garagengeschoss', 'Cadastral line': 'Katasterlinie',
  Recent: 'Zuletzt', 'No projects yet.': 'Noch keine Projekte.', Projects: 'Projekte', 'All projects': 'Alle Projekte', 'A viewer for sites and the buildings drawn for them. Pick a project.': 'Ein Betrachter für Grundstücke und die darauf gezeichneten Gebäude. Wähle ein Projekt.', 'The project list could not be loaded.': 'Die Projektliste konnte nicht geladen werden.', 'This project could not be loaded.': 'Dieses Projekt konnte nicht geladen werden.',
  Layers: 'Ebenen', 'All layers': 'Alle Ebenen', Save: 'Speichern', Reset: 'Zurücksetzen',
  Facade: 'Fassade', 'Interior floors': 'Innere Geschossdecken', Wireframe: 'Drahtgitter', 'Floor lines': 'Geschosslinien',
  Properties: 'Eigenschaften', 'Nothing selected. Tap an object in the scene or in the layer tree.': 'Nichts ausgewählt. Tippe ein Objekt in der Szene oder im Ebenenbaum an.',
  Group: 'Gruppe', Building: 'Gebäude', Level: 'Niveau', Height: 'Höhe', Footprint: 'Grundfläche', Extent: 'Ausdehnung', Top: 'Oberkante', Dimensions: 'Maße', 'Fly to': 'Anfliegen', Hide: 'Ausblenden',
  Volume: 'Volumen', Area: 'Fläche', Deepest: 'Tiefste Stelle', Thickest: 'Dickste Stelle', Fill: 'Auffüllung', 'Fill under': 'Auffüllung unter', Floor: 'Sohle', Surface: 'Oberfläche', 'floor at': 'Sohle', 'top at': 'Oberkante', 'All excavations': 'Gesamter Aushub', 'All fill': 'Gesamte Auffüllung',
  'Full screen': 'Vollbild', 'Scene only': 'Nur die Szene', 'Exit full screen': 'Vollbild verlassen', Collapse: 'Einklappen', Expand: 'Ausklappen',
  Drawing: 'Zeichnung', Objects: 'Objekte', 'Ground grid': 'Bodenraster',
  'Relief points': 'Reliefpunkte', 'Relief surface': 'Reliefoberfläche', 'Contours 10 cm': 'Höhenlinien 10 cm', 'Contours 1 m': 'Höhenlinien 1 m', 'Contours 5 m': 'Höhenlinien 5 m', 'Contour labels': 'Höhenbeschriftung', 'Relief grid': 'Reliefraster',
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
