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
  Rooms: 'Räume', Hall: 'Diele', 'Hall: the landing where the garage flight arrives and the stair up begins, and the room south of it with the toilet and bedroom doors, 5.8 m²': 'Diele: der Austritt der Garagentreppe und der Antritt der Treppe nach oben, und der Raum südlich davon mit der WC- und der Schlafzimmertür, 5,8 m²', Toilet: 'WC', 'Toilet under the stair’s west leg, 1.50 × 1.70, 2.6 m²: the flight is its ceiling over the pan, 2.70 at the door': 'WC unter dem Westlauf der Treppe, 1,50 × 1,70, 2,6 m²: der Lauf ist seine Decke über der Schüssel, 2,70 an der Tür', Bedroom: 'Schlafzimmer', 'Bedroom, 3.30 × 2.90, 9.6 m², window to the yard': 'Schlafzimmer, 3,30 × 2,90, 9,6 m², Fenster zum Hof', Store: 'Abstellraum', 'Low store under the winders and the first treads, from the hall’s bay through the stair wall: 1.00 × 0.50, up to 1.5': 'Niedriger Abstellraum unter den Wendelstufen und den ersten Stufen, aus der Nische der Diele durch die Treppenwand: 1,00 × 0,50, bis 1,5', 'Living room': 'Wohnraum', 'Living room with kitchen, 5.00 × 5.20, 26.0 m², open to the roof, the fireplace in its north-east corner; the panorama is its alone': 'Wohnraum mit Küche, 5,00 × 5,20, 26,0 m², offen bis zum Dach, der Kamin in seiner Nordostecke; das Panorama gehört ihm allein',
  'Open to the roof': 'Offen bis zum Dach', 'To the eaves': 'Bis zur Traufe', 'Under the north slope': 'Unter der Dachfläche Nord', 'Under the south slope': 'Unter der Dachfläche Süd',
  'Outer walls': 'Außenwände', 'Outer wall, north': 'Außenwand Nord', 'Outer wall, west, against the hill: a metre further in than before': 'Außenwand West, am Hang: einen Meter weiter hinten als zuvor', 'North, tall': 'Nord, hoch', 'South, tall': 'Süd, hoch',
  'Panorama glass': 'Panoramaglas', 'North half': 'Nordhälfte', 'South half': 'Südhälfte', 'Over the door': 'Über der Tür', 'South end': 'Südende', 'Balcony door': 'Balkontür', 'Door to the balcony in the glass, 1.00 × 2.30': 'Balkontür im Glas, 1,00 × 2,30',
  'Windows and doors': 'Fenster und Türen', 'Bedroom window': 'Schlafzimmerfenster', 'Bedroom window to the yard, 1.40 × 1.30, sill 0.90': 'Schlafzimmerfenster zum Hof, 1,40 × 1,30, Brüstung 0,90', 'Yard door': 'Hoftür', 'Yard door in the south wall, 0.90, glazed, swings in: the entrance from the yard': 'Hoftür in der Südwand, 0,90, verglast, nach innen: der Eingang vom Hof', 'South window': 'Fenster Süd', 'Window to the yard by the sofa, 1.40 × 1.30, sill 0.90': 'Fenster zum Hof beim Sofa, 1,40 × 1,30, Brüstung 0,90', 'Toilet door': 'WC-Tür', 'Toilet door, 0.80 × 2.00, from the hall, swings in': 'WC-Tür, 0,80 × 2,00, von der Diele, nach innen', 'Bedroom door': 'Schlafzimmertür', 'Bedroom door, 0.90, from the hall, swings in': 'Schlafzimmertür, 0,90, von der Diele, nach innen', 'Store hatch': 'Luke zum Abstellraum', 'Store hatch in the stair wall, 0.50 × 1.40, from the hall’s bay': 'Luke zum Abstellraum in der Treppenwand, 0,50 × 1,40, aus der Nische der Diele',
  Partitions: 'Innenwände', Kitchen: 'Küche', Counter: 'Arbeitsplatte', 'Kitchen counter along the bedroom wall, 2.90 × 0.60, 0.90 high': 'Küchenzeile an der Schlafzimmerwand, 2,90 × 0,60, 0,90 hoch', Return: 'Winkel', 'Kitchen counter, the return along the south wall, 0.90 × 0.60': 'Küchenzeile, der Winkel an der Südwand, 0,90 × 0,60',
  'Stair to the first floor': 'Treppe zum Obergeschoss', 'Stair wall, north leg': 'Treppenwand, Nordlauf', 'Stair wall along the north leg, its south side': 'Treppenwand am Nordlauf, seine Südseite', 'Stair wall, west leg, head': 'Treppenwand, Westlauf, Sturz', 'Stair wall along the west leg’s first treads, over the store hatch': 'Treppenwand an den ersten Stufen des Westlaufs, über der Luke', 'Stair wall, west leg, post': 'Treppenwand, Westlauf, Pfosten', 'Stair wall along the west leg, the post at the toilet’s wall': 'Treppenwand am Westlauf, der Pfosten an der WC-Wand', 'Stair parapet': 'Treppenbrüstung', 'Stair parapet on the west leg’s east string, from the flight’s underside to the ceiling: the toilet’s side to the stair': 'Treppenbrüstung an der Ostwange des Westlaufs, von der Laufunterseite bis zur Decke: die Seite des WCs zur Treppe',
  'Toilet, north 1': 'WC, Nord 1', 'Toilet wall, north, under the flight': 'WC-Wand Nord, unter dem Lauf', 'Toilet, north 2': 'WC, Nord 2', 'Toilet wall, north, east of the stair': 'WC-Wand Nord, östlich der Treppe', 'Toilet, east 1': 'WC, Ost 1', 'Toilet wall, east, north of the door': 'WC-Wand Ost, nördlich der Tür', 'Toilet, east head': 'WC, Ost Sturz', 'Toilet wall, east, over the door': 'WC-Wand Ost, über der Tür', 'Toilet, east 2': 'WC, Ost 2', 'Toilet wall, east, south of the door': 'WC-Wand Ost, südlich der Tür',
  'Bedroom, north 1': 'Schlafzimmer, Nord 1', 'Bedroom wall, north, west of the door; the toilet’s south wall': 'Schlafzimmerwand Nord, westlich der Tür; die Südwand des WCs', 'Bedroom, north head': 'Schlafzimmer, Nord Sturz', 'Bedroom wall, north, over the door': 'Schlafzimmerwand Nord, über der Tür', 'Bedroom, north 2': 'Schlafzimmer, Nord 2', 'Bedroom wall, north, the corner east of the door': 'Schlafzimmerwand Nord, die Ecke östlich der Tür', 'Bedroom, east': 'Schlafzimmer, Ost', 'Bedroom wall, east; the kitchen stands against it and the first floor’s edge is above it': 'Schlafzimmerwand Ost; die Küche steht daran und die Kante des Obergeschosses ist darüber',
  'Garage stair, closed': 'Garagentreppe, geschlossen', 'South wall': 'Südwand', 'Stair enclosure, south wall: the TV’s wall, 3.58 × 2.70, closing the garage stair off the living room': 'Treppenkasten, Südwand: die Fernsehwand, 3,58 × 2,70, schließt die Garagentreppe vom Wohnraum ab', 'East end': 'Ostende', 'Stair enclosure, east end, beside the hearth': 'Treppenkasten, Ostende, neben dem Kamin', Lid: 'Deckel', 'Stair enclosure, the lid at the first floor’s level: a 3.58 × 1.20 ledge behind the gallery rail': 'Treppenkasten, der Deckel auf Höhe des Obergeschosses: ein Sims 3,58 × 1,20 hinter dem Galeriegeländer', 'TV wall': 'Fernsehwand', TV: 'Fernseher', 'TV on the closed stair’s south face, 3.1 m from the sofa: 75″, 1.67 × 0.95, 1.00 to 1.95 up': 'Fernseher an der Südseite des Treppenkastens, 3,1 m vom Sofa: 75″, 1,67 × 0,95, 1,00 bis 1,95 hoch', 'Stairwell rail': 'Geländer am Treppenauge',
  Fireplace: 'Kamin', 'Hearth, back': 'Kamin, Rückwand', 'Hearth, west': 'Kamin, Wange West', 'Hearth, east': 'Kamin, Wange Ost', 'Hearth, base': 'Kamin, Feuerboden', Fire: 'Feuer', 'Hearth, breast': 'Kaminbrust', 'Chimney, below the roof': 'Schornstein unter dem Dach', 'Chimney, above the roof': 'Schornstein über dem Dach', 'Chimney above the roof, to 9.90: 0.80 over the ridge': 'Schornstein über dem Dach, bis 9,90: 0,80 über dem First',
  'Gallery railing': 'Galeriegeländer', 'Gallery railing on the first floor’s edge over the living room and the closed stair’s lid, 1.0 high': 'Galeriegeländer an der Kante des Obergeschosses über dem Wohnraum und dem Deckel der Treppe, 1,0 hoch',
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
