// ============================================================
// 15-Minuten-Stadt-Scanner
// ============================================================

// Tiefschwarz für Linien und Punkte (gleich wie in style.css)
const INK = '#111111';

// ------------------------------------------------------------
// Einstellungen (im Bereich "Darstellung" änderbar).
// Sie werden im Browser gespeichert (localStorage) und sind beim
// nächsten Besuch wieder da.
// ------------------------------------------------------------
const STANDARD = {
  farbe: '#FF4F00',        // Akzentfarbe: International Orange
  kartenstil: 'grau',      // 'grau', 'farbig' oder 'dunkel'
  deckkraft: 0.1,          // Füllung des inneren Kreises (0 = nur Linie)
  radiusInnen: 400,        // Meter (≈ 5 Min.)
  radiusAussen: 800        // Meter (≈ 10 Min.)
};
const SPEICHER_NAME = 'stadtScannerEinstellungen';
let einstellungen = ladeEinstellungen();

function ladeEinstellungen() {
  let gespeichert = {};
  try { gespeichert = JSON.parse(localStorage.getItem(SPEICHER_NAME)) || {}; } catch (e) { /* ignorieren */ }
  return pruefeEinstellungen(Object.assign({}, STANDARD, gespeichert));
}

// Unsinnige Werte auf sinnvolle zurücksetzen
function pruefeEinstellungen(e) {
  if (!/^#[0-9a-fA-F]{6}$/.test(e.farbe)) e.farbe = STANDARD.farbe;
  if (['grau', 'farbig', 'dunkel'].indexOf(e.kartenstil) < 0) e.kartenstil = STANDARD.kartenstil;
  e.deckkraft = Math.min(0.5, Math.max(0, Number(e.deckkraft) || 0));
  e.radiusInnen = Math.round(Number(e.radiusInnen)) || STANDARD.radiusInnen;
  e.radiusAussen = Math.round(Number(e.radiusAussen)) || STANDARD.radiusAussen;
  e.radiusInnen = Math.min(1500, Math.max(100, e.radiusInnen));
  e.radiusAussen = Math.min(1500, Math.max(100, e.radiusAussen));
  if (e.radiusInnen >= e.radiusAussen) {
    e.radiusInnen = STANDARD.radiusInnen;
    e.radiusAussen = STANDARD.radiusAussen;
  }
  return e;
}

function speichereEinstellungen() {
  try { localStorage.setItem(SPEICHER_NAME, JSON.stringify(einstellungen)); } catch (e) { /* ignorieren */ }
}

// Annahmen für den Luftlinien-Vergleich (hier leicht änderbar)
const UMWEGFAKTOR = 1.3;          // echter Fußweg ist ca. 30 % länger als Luftlinie
const GEHTEMPO_KMH = 4.8;         // übliche Gehgeschwindigkeit
const GEHTEMPO_M_PRO_MIN = GEHTEMPO_KMH * 1000 / 60;  // = 80 m pro Minute

// Kategorien der Infrastruktur (Daten: daten/oldenburg-osm.js)
//   form: wie die Orte auf der Karte und in der Legende aussehen
const KATEGORIEN = [
  { id: 'oepnv',      name: 'ÖPNV-Haltepunkte',     form: 'kreis' },
  { id: 'versorgung', name: 'Supermärkte & Bäcker', form: 'quadrat' },
  { id: 'bildung',    name: 'Kitas & Schulen',      form: 'dreieck' },
  { id: 'gruen',      name: 'Parks',                form: 'flaeche' }
];

// 1) Karte erzeugen und auf Oldenburg zentrieren
//    [Breitengrad, Längengrad], Zoomstufe
const map = L.map('map').setView([53.1435, 8.2146], 14);

// 2) Hintergrundkarte laden: Standard-Kacheln von OpenStreetMap
//    (kostenlos, ohne API-Key). In style.css machen wir sie über die
//    Klasse "basemap" grau und hell – so treten die Kreise klar hervor.
//    Die Namensnennung ist Pflicht (OSM-Lizenz).
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap-Mitwirkende</a>',
  className: 'basemap',
  crossOrigin: true,   // erlaubt, die Kacheln später ins PNG zu übernehmen
  maxZoom: 19
}).addTo(map);

// Maßstabsleiste (nur Meter), unten rechts über der Namensnennung
L.control.scale({ imperial: false, position: 'bottomright', maxWidth: 150 }).addTo(map);

// 3) Eine "Ebene" (wie ein Layer in CAD), in die wir Marker + Kreise legen.
//    So können wir beim nächsten Klick alles auf einmal löschen.
const analyse = L.layerGroup().addTo(map);

// 4) Beim Klick auf die Karte: Standort an der angeklickten Stelle analysieren
map.on('click', function (event) {
  document.getElementById('suche-status').textContent = '';
  letzteAdresse = '';   // Klick = keine Adresse bekannt
  analysiereStandort(event.latlng);
});

// Merkt sich den zuletzt analysierten Standort (für das PDF-Planblatt)
let letzterPunkt = null;
let letzteAdresse = '';
let kreisInnen = null;    // die beiden Kreise – damit man sie
let kreisAussen = null;   // später umfärben kann

// Kreise und Standort-Punkt in der aktuellen Akzentfarbe einfärben
function faerbeKreise() {
  const farbe = einstellungen.farbe;
  if (kreisAussen) kreisAussen.setStyle({ color: farbe });
  if (kreisInnen) kreisInnen.setStyle({ color: farbe, fillColor: farbe, fillOpacity: einstellungen.deckkraft });
  if (standortMarker) standortMarker.setStyle({ fillColor: farbe });

  // Infrastruktur: auf dunkler Karte hell, sonst schwarz
  document.getElementById('map').style.setProperty('--poi-farbe', poiFarbe());
  analyse.eachLayer(function (ebene) {
    if (ebene.options.className === 'park') {
      ebene.setStyle({ fillColor: poiFarbe(), fillOpacity: einstellungen.kartenstil === 'dunkel' ? 0.25 : 0.15 });
    }
  });
}

function poiFarbe() {
  return einstellungen.kartenstil === 'dunkel' ? '#F8F8F6' : INK;
}

// 5) Kern-Funktion: zeichnet Marker + Kreise und füllt das Panel.
//    Wird vom Klick UND von der Adresssuche benutzt.
function analysiereStandort(punkt) {
  letzterPunkt = punkt;

  // Alte Kreise und alten Marker entfernen
  analyse.clearLayers();

  // Äußerer Kreis (Standard 800 m ≈ 10 Min.): gestrichelte Linie, keine Füllung
  kreisAussen = L.circle(punkt, {
    radius: einstellungen.radiusAussen,
    weight: 1.5,
    dashArray: '6 6',
    fill: false
  }).addTo(analyse);

  // Innerer Kreis (Standard 400 m ≈ 5 Min.): Linie + leichte Füllung
  kreisInnen = L.circle(punkt, {
    radius: einstellungen.radiusInnen,
    weight: 1.5
  }).addTo(analyse);

  // Standort-Marker: kleiner Punkt in Akzentfarbe mit schwarzem Rand
  standortMarker = L.circleMarker(punkt, {
    radius: 6,
    color: INK,
    weight: 1.5,
    fillOpacity: 1
  }).addTo(analyse);

  faerbeKreise();   // Farbe + Deckkraft aus den Einstellungen anwenden

  // Karte so zoomen, dass der große Kreis ganz zu sehen ist
  map.fitBounds(kreisAussen.getBounds(), { padding: [40, 40] });

  // Kennzahlen im Side-Panel aktualisieren
  zeigeKennzahlen(punkt);

  // Infrastruktur aus den mitgelieferten OSM-Daten zählen
  zaehleInfrastruktur(punkt);
}

// ------------------------------------------------------------
// Infrastruktur zählen – aus der mitgelieferten Datei
// daten/oldenburg-osm.js (OpenStreetMap-Auszug, einmal heruntergeladen).
// Vorteil: kein Server nötig, sofort fertig, immer verfügbar.
// Nachteil: gilt nur für das Datengebiet (Oldenburg + Umland).
// ------------------------------------------------------------
let standortMarker = null;   // damit der Standort-Punkt oben bleibt
let letzteOrte = null;       // zuletzt gefundene Orte (für den GeoPackage-Export)

function zaehleInfrastruktur(punkt) {
  const rInnen = einstellungen.radiusInnen;
  const rAussen = einstellungen.radiusAussen;
  const status = document.getElementById('infra-status');
  letzteOrte = null;

  // Daten nicht geladen oder Standort außerhalb des Datengebiets?
  if (!window.OSM_DATEN || !imDatengebiet(punkt)) {
    KATEGORIEN.forEach(function (kat) {
      document.getElementById('anz-' + kat.id + '-innen').textContent = '–';
      document.getElementById('anz-' + kat.id + '-aussen').textContent = '–';
    });
    status.textContent = window.OSM_DATEN
      ? 'Außerhalb des Datengebiets – Infrastruktur nur für Oldenburg und Umgebung verfügbar.'
      : 'Infrastruktur-Daten konnten nicht geladen werden.';
    return;
  }

  // Zähler für jede Kategorie vorbereiten
  const zaehler = {};
  KATEGORIEN.forEach(function (kat) { zaehler[kat.id] = { innen: 0, aussen: 0 }; });
  const gefunden = [];

  OSM_DATEN.features.forEach(function (ort) {
    // Schneller Vorab-Test: grob zu weit weg? Dann gar nicht genau rechnen.
    if (!grobInDerNaehe(ort, punkt, rAussen)) return;

    const entfernung = entfernungZu(ort, punkt);   // Luftlinie in Metern
    if (entfernung > rAussen) return;

    const kat = ort.properties.kat;
    zaehler[kat].aussen++;
    if (entfernung <= rInnen) zaehler[kat].innen++;
    gefunden.push({ ort: ort, entfernung: entfernung });

    zeichneOrt(ort);
  });

  // Ergebnisse ins Panel schreiben
  KATEGORIEN.forEach(function (kat) {
    document.getElementById('anz-' + kat.id + '-innen').textContent = zaehler[kat.id].innen;
    document.getElementById('anz-' + kat.id + '-aussen').textContent = zaehler[kat.id].aussen;
  });
  status.textContent = 'OSM-Datenstand ' + OSM_DATEN.datenstand + ' · Parks: Rand im Radius';

  letzteOrte = gefunden;
  faerbeKreise();
  if (standortMarker) standortMarker.bringToFront();
}

// Liegt der Punkt im ausgeschnittenen Gebiet? gebiet = [West, Süd, Ost, Nord]
function imDatengebiet(punkt) {
  const g = OSM_DATEN.gebiet;
  return punkt.lng >= g[0] && punkt.lng <= g[2] && punkt.lat >= g[1] && punkt.lat <= g[3];
}

// Grober Test über die Koordinaten (1° Breite ≈ 111 km), damit nicht für
// tausende Orte genau gerechnet werden muss
function grobInDerNaehe(ort, punkt, radius) {
  const rand = (radius + 3000) / 111000;   // 3 km Puffer für große Parks
  const c = ersterPunkt(ort.geometry);
  return Math.abs(c[1] - punkt.lat) < rand && Math.abs(c[0] - punkt.lng) < rand * 1.7;
}

// Entfernung vom Standort zum Ort in Metern.
//   Punkte: direkte Luftlinie.
//   Parks (Flächen): 0, wenn der Standort im Park liegt –
//   sonst Entfernung zur nächsten Ecke des Park-Umrisses.
function entfernungZu(ort, punkt) {
  const geo = ort.geometry;
  if (geo.type === 'Point') {
    return map.distance(punkt, L.latLng(geo.coordinates[1], geo.coordinates[0]));
  }
  const polygone = geo.type === 'Polygon' ? [geo.coordinates] : geo.coordinates;
  let minimum = Infinity;
  polygone.forEach(function (polygon) {
    if (punktInPolygon(punkt, polygon)) minimum = 0;
    polygon[0].forEach(function (ecke) {
      minimum = Math.min(minimum, map.distance(punkt, L.latLng(ecke[1], ecke[0])));
    });
  });
  return minimum;
}

// Liegt der Punkt in der Fläche? (Strahl-Methode; Löcher werden beachtet)
function punktInPolygon(punkt, polygon) {
  function imRing(ring) {
    let drin = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if (((yi > punkt.lat) !== (yj > punkt.lat)) &&
          (punkt.lng < (xj - xi) * (punkt.lat - yi) / (yj - yi) + xi)) drin = !drin;
    }
    return drin;
  }
  if (!imRing(polygon[0])) return false;
  for (let k = 1; k < polygon.length; k++) if (imRing(polygon[k])) return false;
  return true;
}

// Erste Koordinate einer Geometrie (für den groben Test)
function ersterPunkt(geo) {
  if (geo.type === 'Point') return geo.coordinates;
  if (geo.type === 'Polygon') return geo.coordinates[0][0];
  return geo.coordinates[0][0][0];   // MultiPolygon
}

// Einen Ort auf die Karte zeichnen
function zeichneOrt(ort) {
  const kat = ort.properties.kat;
  const name = document.createElement('span');
  name.textContent = ort.properties.name || KATEGORIEN.find(function (k) { return k.id === kat; }).name;

  if (kat === 'gruen') {
    // Parks als graue Fläche ohne Rand
    L.geoJSON(ort, {
      style: { stroke: false, fillColor: poiFarbe(), fillOpacity: 0.15, className: 'park' },
      interactive: true
    }).eachLayer(function (ebene) {
      ebene.options.className = 'park';
      ebene.bindTooltip(name, { sticky: true });
      ebene.addTo(analyse);
    });
    return;
  }

  // Punkte als kleine Symbole (Kreis, Quadrat, Dreieck) – siehe style.css
  const form = KATEGORIEN.find(function (k) { return k.id === kat; }).form;
  const symbol = L.marker([ort.geometry.coordinates[1], ort.geometry.coordinates[0]], {
    icon: L.divIcon({ className: 'poi poi-' + form, iconSize: [8, 8] }),
    keyboard: false
  });
  symbol.bindTooltip(name, { direction: 'top' });
  symbol.addTo(analyse);
}

// ------------------------------------------------------------
// Adresssuche mit Nominatim (kostenlos, ohne API-Key)
// Regeln von Nominatim: höchstens 1 Anfrage pro Sekunde und keine
// Vorschläge beim Tippen – deshalb suchen wir erst beim Abschicken.
// ------------------------------------------------------------
const suchFormular = document.getElementById('suche');
const suchFeld = document.getElementById('suche-eingabe');
const suchKnopf = document.getElementById('suche-knopf');
const suchStatus = document.getElementById('suche-status');

suchFormular.addEventListener('submit', async function (event) {
  event.preventDefault(); // Seite nicht neu laden

  const suchbegriff = suchFeld.value.trim();
  if (!suchbegriff) return;

  // Die Suche bevorzugt Treffer im aktuell sichtbaren Kartenausschnitt
  const ausschnitt = map.getBounds();
  const parameter = new URLSearchParams({
    q: suchbegriff,
    format: 'jsonv2',
    limit: 1,
    'accept-language': 'de',
    viewbox: [ausschnitt.getWest(), ausschnitt.getNorth(),
              ausschnitt.getEast(), ausschnitt.getSouth()].join(',')
  });

  suchKnopf.disabled = true;
  suchStatus.textContent = 'Suche läuft …';

  try {
    const antwort = await fetch('https://nominatim.openstreetmap.org/search?' + parameter);
    if (!antwort.ok) throw new Error('Status ' + antwort.status);
    const treffer = await antwort.json();

    if (treffer.length === 0) {
      suchStatus.textContent = 'Keine Adresse gefunden. Tipp: Ort mit angeben.';
      return;
    }

    // Erster Treffer → Standort analysieren
    const ort = treffer[0];
    suchStatus.textContent = ort.display_name;
    suchStatus.title = ort.display_name;   // volle Adresse beim Darüberfahren
    letzteAdresse = ort.display_name;
    analysiereStandort(L.latLng(Number(ort.lat), Number(ort.lon)));
  } catch (fehler) {
    suchStatus.textContent = 'Suche gerade nicht möglich. Bitte später erneut versuchen.';
  } finally {
    // Knopf erst nach 1 Sekunde wieder freigeben (Nominatim-Regel)
    setTimeout(function () { suchKnopf.disabled = false; }, 1000);
  }
});

// ------------------------------------------------------------
// Hilfsfunktionen für das Side-Panel
// ------------------------------------------------------------

// Fläche eines Kreises: π · r²  (r in Metern → Ergebnis in m²)
function kreisflaeche(radiusMeter) {
  return Math.PI * radiusMeter * radiusMeter;
}

// Zahl im deutschen Format, z. B. 50,3 statt 50.3
function deutsch(zahl, nachkommastellen) {
  return zahl.toLocaleString('de-DE', {
    minimumFractionDigits: nachkommastellen,
    maximumFractionDigits: nachkommastellen
  });
}

// Werte in das Panel schreiben und den Bereich sichtbar machen
function zeigeKennzahlen(punkt) {
  // 5 Nachkommastellen ≈ 1 m Genauigkeit – reicht für ein Grundstück
  document.getElementById('wert-koordinaten').textContent =
    deutsch(punkt.lat, 5) + '° N  ' + deutsch(punkt.lng, 5) + '° O';

  zeigeEinzugsbereiche();

  // Hinweistext ausblenden, Kennzahlen einblenden
  document.getElementById('hinweis').hidden = true;
  document.getElementById('kennzahlen').hidden = false;
}

// Tabelle "Einzugsbereiche" füllen – eine Zeile pro Radius
//   Fläche  = π · r²  (1 ha = 10.000 m²)
//   Fußweg  = Luftlinie × Umwegfaktor
//   Gehzeit = Fußweg ÷ Gehtempo (m pro Minute)
function zeigeEinzugsbereiche() {
  const zeilen = [einstellungen.radiusInnen, einstellungen.radiusAussen].map(function (radius) {
    const hektar = kreisflaeche(radius) / 10000;
    const fussweg = radius * UMWEGFAKTOR;
    const gehzeit = fussweg / GEHTEMPO_M_PRO_MIN;
    return '<tr>' +
      '<td>' + deutsch(radius, 0) + ' m</td>' +
      '<td>' + deutsch(hektar, 1) + ' ha</td>' +
      '<td>≈ ' + deutsch(fussweg, 0) + ' m</td>' +
      '<td>≈ ' + deutsch(gehzeit, 1) + ' Min.</td>' +
      '</tr>';
  });
  document.getElementById('vergleich-zeilen').innerHTML = zeilen.join('');

  document.getElementById('vergleich-annahme').textContent =
    'Annahme: Umwegfaktor ' + deutsch(UMWEGFAKTOR, 1) +
    ', Gehtempo ' + deutsch(GEHTEMPO_KMH, 1) + ' km/h';
}

// ------------------------------------------------------------
// Export: Kartenbereich (Karte + Kreise + Legende + Maßstab +
// OSM-Namensnennung) als PNG-Bild speichern – z. B. fürs Poster
// ------------------------------------------------------------
const exportKnopf = document.getElementById('export-knopf');
const pdfKnopf = document.getElementById('pdf-knopf');
const exportStatus = document.getElementById('export-status');

// "Fotografiert" den Kartenbereich mit html-to-image.
//   format:     'png' (verlustfrei) oder 'jpeg' (kleinere Datei, fürs PDF)
//   pixelRatio: 2 = doppelte Auflösung, 3 = dreifache (scharf im Druck)
function kartenBild(format, pixelRatio) {
  const bereich = document.getElementById('karte-bereich');
  const optionen = {
    pixelRatio: pixelRatio,
    backgroundColor: '#F8F8F6',
    quality: 0.92,          // nur für JPEG wichtig
    // Wir nutzen nur System-Schriften → keine Web-Schriften einbetten
    skipFonts: true,
    // Zoom-Knöpfe (+/−) gehören nicht aufs Poster → weglassen
    filter: function (element) {
      return !(element.classList && element.classList.contains('leaflet-control-zoom'));
    }
  };
  return format === 'jpeg'
    ? htmlToImage.toJpeg(bereich, optionen)
    : htmlToImage.toPng(bereich, optionen);
}

exportKnopf.addEventListener('click', async function () {
  exportKnopf.disabled = true;
  exportStatus.textContent = 'Bild wird erstellt …';

  try {
    const bild = await kartenBild('png', 2);

    // Bild als Datei herunterladen, z. B. "stadt-scanner-2026-11-16.png"
    const datum = new Date().toISOString().slice(0, 10);
    const link = document.createElement('a');
    link.href = bild;
    link.download = 'stadt-scanner-' + datum + '.png';
    link.click();

    exportStatus.textContent = 'Gespeichert (im Download-Ordner).';
  } catch (fehler) {
    exportStatus.textContent = 'Export fehlgeschlagen. Bitte warten, bis die Karte ganz geladen ist, und erneut versuchen.';
  } finally {
    exportKnopf.disabled = false;
  }
});

// ------------------------------------------------------------
// Export: Planblatt A3 quer als PDF
//   links die Karte (wie beim PNG), rechts ein Plankopf mit
//   Titel, Standort, Kennzahlen und Quellenangabe.
//   Alle Maße in Millimetern (A3 quer = 420 × 297 mm).
// ------------------------------------------------------------
pdfKnopf.addEventListener('click', async function () {
  if (!letzterPunkt) {
    exportStatus.textContent = 'Bitte zuerst einen Standort wählen (Klick auf die Karte oder Adresssuche).';
    return;
  }

  pdfKnopf.disabled = true;
  exportStatus.textContent = 'Planblatt wird erstellt …';

  try {
    // 1) Kartenbild in dreifacher Auflösung (scharf im A3-Druck)
    const bild = await kartenBild('jpeg', 3);
    const groesse = await bildGroesse(bild);

    // 2) Leeres A3-Blatt im Querformat
    const pdf = new jspdf.jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3' });
    const BLATT_B = 420, BLATT_H = 297;
    const RAND = 12;               // Seitenrand
    const KOPF_B = 95;             // Breite des Plankopfs rechts
    const ABSTAND = 10;            // Abstand Karte ↔ Plankopf

    // 3) Karte links einpassen (Seitenverhältnis bleibt erhalten)
    const feldB = BLATT_B - 2 * RAND - ABSTAND - KOPF_B;
    const feldH = BLATT_H - 2 * RAND;
    const massstab = Math.min(feldB / groesse.breite, feldH / groesse.hoehe);
    const karteB = groesse.breite * massstab;
    const karteH = groesse.hoehe * massstab;
    pdf.addImage(bild, 'JPEG', RAND, RAND, karteB, karteH);
    pdf.setDrawColor(17, 17, 17);
    pdf.setLineWidth(0.3);
    pdf.rect(RAND, RAND, karteB, karteH);   // feiner schwarzer Rahmen

    // 4) Plankopf rechts
    const x = RAND + feldB + ABSTAND;   // linke Kante des Plankopfs
    const xr = BLATT_B - RAND;           // rechte Kante
    let y = RAND + 3;

    // Kleine Überschrift + Titel
    grauerText(pdf, 'STANDORTANALYSE', x, y);
    y += 10;
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(22);
    pdf.setTextColor(17, 17, 17);
    pdf.text('15-Minuten-', x, y);
    pdf.text('Stadt-Scanner', x, y + 8.5);
    y += 15;

    // Orange Akzentlinie
    pdf.setDrawColor.apply(pdf, hexZuRgb(einstellungen.farbe));   // Akzentfarbe
    pdf.setLineWidth(0.8);
    pdf.line(x, y, xr, y);
    y += 12;

    // Abschnitt: Standort
    y = abschnitt(pdf, 'Standort', x, xr, y);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(10);
    pdf.setTextColor(17, 17, 17);
    if (letzteAdresse) {
      const zeilen = pdf.splitTextToSize(letzteAdresse, KOPF_B);
      pdf.text(zeilen, x, y);
      y += zeilen.length * 4.6 + 2;
    }
    pdf.setFont('courier', 'normal');
    pdf.text(deutsch(letzterPunkt.lat, 5) + '° N   ' + deutsch(letzterPunkt.lng, 5) + '° O', x, y);
    y += 12;

    // Abschnitt: Einzugsbereiche (gleiche Rechnung wie im Panel)
    y = abschnitt(pdf, 'Einzugsbereiche', x, xr, y);
    const spalten = [x, x + 38, x + 66, xr];   // Radius | Fläche | Fußweg | Gehzeit
    tabellenKopf(pdf, ['Radius', 'Fläche', 'Fußweg ca.', 'Gehzeit ca.'], spalten, y);
    y += 6;
    [einstellungen.radiusInnen, einstellungen.radiusAussen].forEach(function (radius) {
      const fussweg = radius * UMWEGFAKTOR;
      tabellenZeile(pdf, [
        deutsch(radius, 0) + ' m',
        deutsch(kreisflaeche(radius) / 10000, 1) + ' ha',
        deutsch(fussweg, 0) + ' m',
        deutsch(fussweg / GEHTEMPO_M_PRO_MIN, 1) + ' Min.'
      ], spalten, x, xr, y);
      y += 7;
    });
    grauerText(pdf, 'Annahme: Umwegfaktor ' + deutsch(UMWEGFAKTOR, 1) +
      ', Gehtempo ' + deutsch(GEHTEMPO_KMH, 1) + ' km/h', x, y, false);
    y += 12;

    // Abschnitt: Infrastruktur (Werte aus dem Panel übernehmen)
    y = abschnitt(pdf, 'Infrastruktur im Umkreis', x, xr, y);
    const spalten2 = [x, x + 66, xr];
    tabellenKopf(pdf, ['Kategorie',
      'bis ' + deutsch(einstellungen.radiusInnen, 0) + ' m',
      'bis ' + deutsch(einstellungen.radiusAussen, 0) + ' m'], spalten2, y);
    y += 6;
    KATEGORIEN.forEach(function (kat) {
      tabellenZeile(pdf, [
        kat.name,
        zahlOderStrich('anz-' + kat.id + '-innen'),
        zahlOderStrich('anz-' + kat.id + '-aussen')
      ], spalten2, x, xr, y, true);
      y += 7;
    });
    grauerText(pdf, 'Parks zählen, wenn ihr Rand im Radius liegt.', x, y, false);

    // 5) Fußzeile unten im Plankopf: Datum + Quellen (Lizenzpflicht!)
    let yu = BLATT_H - RAND - 14;
    pdf.setDrawColor(17, 17, 17);
    pdf.setLineWidth(0.3);
    pdf.line(x, yu - 5, xr, yu - 5);
    const stand = window.OSM_DATEN ? ', Datenstand ' + OSM_DATEN.datenstand : '';
    grauerText(pdf, 'Erstellt am ' + new Date().toLocaleDateString('de-DE') + stand, x, yu, false);
    grauerText(pdf, 'Kartendaten & Kartenkacheln © OpenStreetMap-Mitwirkende', x, yu + 4.5, false);
    grauerText(pdf, '(ODbL, openstreetmap.org/copyright)', x, yu + 9, false);

    // 6) Speichern, z. B. "stadt-scanner-planblatt-2026-11-16.pdf"
    pdf.save('stadt-scanner-planblatt-' + new Date().toISOString().slice(0, 10) + '.pdf');
    exportStatus.textContent = 'Planblatt gespeichert (im Download-Ordner).';
  } catch (fehler) {
    exportStatus.textContent = 'PDF-Export fehlgeschlagen. Bitte warten, bis die Karte ganz geladen ist, und erneut versuchen.';
  } finally {
    pdfKnopf.disabled = false;
  }
});

// --- kleine Helfer für das Planblatt ---

// Breite und Höhe eines Bildes (in Pixeln) herausfinden
function bildGroesse(datenUrl) {
  return new Promise(function (fertig, fehler) {
    const img = new Image();
    img.onload = function () { fertig({ breite: img.naturalWidth, hoehe: img.naturalHeight }); };
    img.onerror = fehler;
    img.src = datenUrl;
  });
}

// Kleiner grauer Text (Überschriften in Versalien oder Anmerkungen)
function grauerText(pdf, text, x, y, versalien) {
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8);
  pdf.setTextColor(138, 138, 134);
  pdf.text(text, x, y, versalien === false ? {} : { charSpace: 0.6 });
}

// Abschnitts-Überschrift mit schwarzer Linie darunter; gibt neue y-Position zurück
function abschnitt(pdf, titel, x, xr, y) {
  grauerText(pdf, titel.toUpperCase(), x, y);
  pdf.setDrawColor(17, 17, 17);
  pdf.setLineWidth(0.3);
  pdf.line(x, y + 2.5, xr, y + 2.5);
  return y + 8;
}

// Tabellenkopf: erste Spalte links-, alle anderen rechtsbündig
function tabellenKopf(pdf, texte, spalten, y) {
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8);
  pdf.setTextColor(138, 138, 134);
  texte.forEach(function (text, i) {
    pdf.text(text, spalten[i], y, i === 0 ? {} : { align: 'right' });
  });
}

// Tabellenzeile in Monospace + feine graue Linie darunter
//   ersteSpalteNormal: true = erste Spalte in normaler Schrift (z. B. Kategorie-Name)
function tabellenZeile(pdf, texte, spalten, x, xr, y, ersteSpalteNormal) {
  pdf.setFontSize(10);
  pdf.setTextColor(17, 17, 17);
  texte.forEach(function (text, i) {
    pdf.setFont(i === 0 && ersteSpalteNormal ? 'helvetica' : 'courier', 'normal');
    pdf.text(String(text), spalten[i], y, i === 0 ? {} : { align: 'right' });
  });
  pdf.setDrawColor(221, 221, 216);
  pdf.setLineWidth(0.2);
  pdf.line(x, y + 2.5, xr, y + 2.5);
}

// Zahl aus dem Panel holen; "…" (lädt noch) oder "–" werden zu "–"
function zahlOderStrich(id) {
  const wert = document.getElementById(id).textContent.trim();
  return /^\d+$/.test(wert) ? wert : '–';
}

// ------------------------------------------------------------
// Export: GeoPackage für QGIS
//   GeoPackage (.gpkg) ist das Standard-Format von QGIS: eine
//   einzige Datei mit mehreren Ebenen (Layern). Wir speichern
//   direkt im amtlichen Koordinatensystem für Niedersachsen:
//   ETRS89 / UTM Zone 32N (EPSG:25832) – Einheit Meter, also
//   stimmen Flächen und Längen in QGIS sofort.
//
//   Ebenen:  standort         (Punkt)
//            einzugsbereiche  (Fläche: innerer + äußerer Kreis)
//            infrastruktur    (Punkte: ÖPNV, Versorgung, Bildung)
//            parks            (Flächen)
//
//   Technik: Eine GeoPackage-Datei ist eine SQLite-Datenbank.
//   sql.js (SQLite im Browser) und proj4 (Umrechnung der
//   Koordinaten) werden erst beim ersten Klick geladen.
// ------------------------------------------------------------
const OSM_QUELLE = '© OpenStreetMap-Mitwirkende, ODbL';
const EPSG_25832 = '+proj=utm +zone=32 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs';
const WKT_25832 = 'PROJCS["ETRS89 / UTM zone 32N",GEOGCS["ETRS89",DATUM["European_Terrestrial_Reference_System_1989",SPHEROID["GRS 1980",6378137,298.257222101,AUTHORITY["EPSG","7019"]],AUTHORITY["EPSG","6258"]],PRIMEM["Greenwich",0,AUTHORITY["EPSG","8901"]],UNIT["degree",0.0174532925199433,AUTHORITY["EPSG","9122"]],AUTHORITY["EPSG","4258"]],PROJECTION["Transverse_Mercator"],PARAMETER["latitude_of_origin",0],PARAMETER["central_meridian",9],PARAMETER["scale_factor",0.9996],PARAMETER["false_easting",500000],PARAMETER["false_northing",0],UNIT["metre",1,AUTHORITY["EPSG","9001"]],AXIS["Easting",EAST],AXIS["Northing",NORTH],AUTHORITY["EPSG","25832"]]';
const SQLJS_URL = 'https://unpkg.com/sql.js@1.16.0/dist/';
const PROJ4_URL = 'https://unpkg.com/proj4@2.23.0/dist/proj4.js';

const gpkgKnopf = document.getElementById('gpkg-knopf');

gpkgKnopf.addEventListener('click', async function () {
  if (!letzterPunkt) {
    exportStatus.textContent = 'Bitte zuerst einen Standort wählen (Klick auf die Karte oder Adresssuche).';
    return;
  }
  gpkgKnopf.disabled = true;
  exportStatus.textContent = 'GeoPackage wird erstellt …';

  try {
    // 1) Werkzeuge nachladen (nur beim ersten Mal)
    await ladeSkript(SQLJS_URL + 'sql-wasm.js');
    await ladeSkript(PROJ4_URL);
    const SQL = await initSqlJs({ locateFile: function (datei) { return SQLJS_URL + datei; } });
    const zuUtm = proj4('EPSG:4326', EPSG_25832);   // [Länge, Breite] → [Ost, Nord] in Metern

    // 2) Leere GeoPackage-Datenbank mit den Pflicht-Tabellen
    const db = new SQL.Database();
    erstelleGpkgGrundgeruest(db);

    // 3) Ebene "standort"
    const mitte = zuUtm.forward([letzterPunkt.lng, letzterPunkt.lat]);
    neueEbene(db, 'standort', 'POINT', 'Analysierter Standort',
      'name TEXT, lat REAL, lon REAL, ost_m REAL, nord_m REAL');
    fuegeEin(db, 'standort', wkbPunkt(mitte), {
      name: letzteAdresse || '',
      lat: runde(letzterPunkt.lat, 6), lon: runde(letzterPunkt.lng, 6),
      ost_m: runde(mitte[0], 1), nord_m: runde(mitte[1], 1)
    });

    // 4) Ebene "einzugsbereiche" – Kreise direkt in Metern berechnet
    neueEbene(db, 'einzugsbereiche', 'POLYGON', 'Fußläufige Einzugsbereiche (Luftlinie)',
      'radius_m INTEGER, luft_min REAL, flaeche_ha REAL, fussweg_m INTEGER, geh_min REAL, umwegfakt REAL');
    [einstellungen.radiusAussen, einstellungen.radiusInnen].forEach(function (radius) {
      const fussweg = radius * UMWEGFAKTOR;
      fuegeEin(db, 'einzugsbereiche', wkbPolygone([[utmKreis(mitte, radius, 128)]]), {
        radius_m: radius,
        luft_min: runde(radius / GEHTEMPO_M_PRO_MIN, 1),
        flaeche_ha: runde(kreisflaeche(radius) / 10000, 1),
        fussweg_m: Math.round(fussweg),
        geh_min: runde(fussweg / GEHTEMPO_M_PRO_MIN, 1),
        umwegfakt: UMWEGFAKTOR
      });
    });

    // 5) Ebenen "infrastruktur" (Punkte) und "parks" (Flächen)
    const spalten = 'kat TEXT, typ TEXT, name TEXT, entf_m INTEGER, im_innen INTEGER, osm_id TEXT, quelle TEXT';
    neueEbene(db, 'infrastruktur', 'POINT', 'ÖPNV, Supermärkte & Bäcker, Kitas & Schulen', spalten);
    neueEbene(db, 'parks', 'MULTIPOLYGON', 'Parks (OpenStreetMap)', spalten);
    const quelle = OSM_QUELLE + (window.OSM_DATEN ? ', Stand ' + OSM_DATEN.datenstand : '');

    (letzteOrte || []).forEach(function (fund) {
      const p = fund.ort.properties;
      const g = fund.ort.geometry;
      const werte = {
        kat: p.kat,
        typ: KATEGORIEN.find(function (k) { return k.id === p.kat; }).name,
        name: p.name || '',
        entf_m: Math.round(fund.entfernung),
        im_innen: fund.entfernung <= einstellungen.radiusInnen ? 1 : 0,
        osm_id: p.osm_id,
        quelle: quelle
      };
      if (g.type === 'Point') {
        fuegeEin(db, 'infrastruktur', wkbPunkt(zuUtm.forward(g.coordinates)), werte);
      } else {
        const polygone = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
        const umgerechnet = polygone.map(function (polygon) {
          return polygon.map(function (ring) { return ring.map(function (c) { return zuUtm.forward(c); }); });
        });
        fuegeEin(db, 'parks', wkbPolygone(umgerechnet, true), werte);
      }
    });

    aktualisiereAusdehnung(db);

    // 6) Als Datei herunterladen, z. B. "stadt-scanner-2026-11-16.gpkg"
    const datei = new Blob([db.export()], { type: 'application/geopackage+sqlite3' });
    db.close();
    const link = document.createElement('a');
    link.href = URL.createObjectURL(datei);
    link.download = 'stadt-scanner-' + new Date().toISOString().slice(0, 10) + '.gpkg';
    link.click();
    setTimeout(function () { URL.revokeObjectURL(link.href); }, 10000);

    exportStatus.textContent = letzteOrte
      ? 'GeoPackage gespeichert (4 Ebenen, ' + letzteOrte.length + ' Orte, EPSG:25832).'
      : 'GeoPackage gespeichert – ohne Infrastruktur (außerhalb des Datengebiets).';
  } catch (fehler) {
    exportStatus.textContent = 'GeoPackage-Export fehlgeschlagen. Bitte Internetverbindung prüfen und erneut versuchen.';
  } finally {
    gpkgKnopf.disabled = false;
  }
});

// --- Helfer für den GeoPackage-Export ---

// Ein Skript aus dem Internet nachladen (nur einmal)
function ladeSkript(url) {
  if (document.querySelector('script[src="' + url + '"]')) return Promise.resolve();
  return new Promise(function (fertig, fehler) {
    const s = document.createElement('script');
    s.src = url;
    s.onload = fertig;
    s.onerror = fehler;
    document.head.appendChild(s);
  });
}

// Pflicht-Tabellen nach dem GeoPackage-Standard (OGC, Version 1.3)
function erstelleGpkgGrundgeruest(db) {
  db.run('PRAGMA application_id = 1196444487');   // = "GPKG"
  db.run('PRAGMA user_version = 10300');           // Version 1.3.0
  db.run('CREATE TABLE gpkg_spatial_ref_sys (srs_name TEXT NOT NULL, srs_id INTEGER PRIMARY KEY, ' +
         'organization TEXT NOT NULL, organization_coordsys_id INTEGER NOT NULL, ' +
         'definition TEXT NOT NULL, description TEXT)');
  db.run('INSERT INTO gpkg_spatial_ref_sys VALUES (?,?,?,?,?,?)',
    ['Undefined cartesian SRS', -1, 'NONE', -1, 'undefined', 'undefined cartesian coordinate reference system']);
  db.run('INSERT INTO gpkg_spatial_ref_sys VALUES (?,?,?,?,?,?)',
    ['Undefined geographic SRS', 0, 'NONE', 0, 'undefined', 'undefined geographic coordinate reference system']);
  db.run('INSERT INTO gpkg_spatial_ref_sys VALUES (?,?,?,?,?,?)',
    ['WGS 84 geodetic', 4326, 'EPSG', 4326,
     'GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563,AUTHORITY["EPSG","7030"]],AUTHORITY["EPSG","6326"]],PRIMEM["Greenwich",0,AUTHORITY["EPSG","8901"]],UNIT["degree",0.0174532925199433,AUTHORITY["EPSG","9122"]],AXIS["Latitude",NORTH],AXIS["Longitude",EAST],AUTHORITY["EPSG","4326"]]',
     'longitude/latitude coordinates in decimal degrees on the WGS 84 spheroid']);
  db.run('INSERT INTO gpkg_spatial_ref_sys VALUES (?,?,?,?,?,?)',
    ['ETRS89 / UTM zone 32N', 25832, 'EPSG', 25832, WKT_25832, null]);
  db.run('CREATE TABLE gpkg_contents (table_name TEXT NOT NULL PRIMARY KEY, data_type TEXT NOT NULL, ' +
         'identifier TEXT UNIQUE, description TEXT DEFAULT \'\', ' +
         'last_change DATETIME NOT NULL DEFAULT (strftime(\'%Y-%m-%dT%H:%M:%fZ\',\'now\')), ' +
         'min_x DOUBLE, min_y DOUBLE, max_x DOUBLE, max_y DOUBLE, srs_id INTEGER, ' +
         'CONSTRAINT fk_gc_r_srs_id FOREIGN KEY (srs_id) REFERENCES gpkg_spatial_ref_sys(srs_id))');
  db.run('CREATE TABLE gpkg_geometry_columns (table_name TEXT NOT NULL, column_name TEXT NOT NULL, ' +
         'geometry_type_name TEXT NOT NULL, srs_id INTEGER NOT NULL, z TINYINT NOT NULL, m TINYINT NOT NULL, ' +
         'CONSTRAINT pk_geom_cols PRIMARY KEY (table_name, column_name), ' +
         'CONSTRAINT fk_gc_tn FOREIGN KEY (table_name) REFERENCES gpkg_contents(table_name), ' +
         'CONSTRAINT fk_gc_srs FOREIGN KEY (srs_id) REFERENCES gpkg_spatial_ref_sys (srs_id))');
}

// Eine neue Ebene (Tabelle) anlegen und im Inhaltsverzeichnis eintragen
function neueEbene(db, name, geometrieTyp, beschreibung, spalten) {
  db.run('CREATE TABLE "' + name + '" (fid INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, geom ' +
         geometrieTyp + ', ' + spalten + ')');
  db.run('INSERT INTO gpkg_contents (table_name, data_type, identifier, description, srs_id) VALUES (?,?,?,?,?)',
    [name, 'features', name, beschreibung, 25832]);
  db.run('INSERT INTO gpkg_geometry_columns VALUES (?,?,?,?,?,?)', [name, 'geom', geometrieTyp, 25832, 0, 0]);
}

// Ein Objekt (Geometrie + Attribute) in eine Ebene schreiben
function fuegeEin(db, ebene, geometrie, werte) {
  const namen = Object.keys(werte);
  db.run('INSERT INTO "' + ebene + '" (geom, ' + namen.join(', ') + ') VALUES (?' +
         ', ?'.repeat(namen.length) + ')',
    [geometrie].concat(namen.map(function (n) { return werte[n]; })));
}

// Ausdehnung (Bounding Box) jeder Ebene ins Inhaltsverzeichnis schreiben
function aktualisiereAusdehnung(db) {
  ['standort', 'einzugsbereiche', 'infrastruktur', 'parks'].forEach(function (ebene) {
    const ergebnis = db.exec('SELECT geom FROM "' + ebene + '"');
    if (!ergebnis.length) return;
    let box = [Infinity, Infinity, -Infinity, -Infinity];
    ergebnis[0].values.forEach(function (zeile) {
      const b = gpkgHuelle(zeile[0]);
      box = [Math.min(box[0], b[0]), Math.min(box[1], b[1]), Math.max(box[2], b[2]), Math.max(box[3], b[3])];
    });
    db.run('UPDATE gpkg_contents SET min_x=?, min_y=?, max_x=?, max_y=? WHERE table_name=?',
      box.concat([ebene]));
  });
}

// Kreis als Vieleck in UTM-Metern (Mittelpunkt [Ost, Nord])
function utmKreis(mitte, radius, n) {
  const ring = [];
  for (let i = 0; i <= n; i++) {
    const w = (i % n) / n * 2 * Math.PI;   // gegen den Uhrzeigersinn, geschlossen
    ring.push([mitte[0] + radius * Math.cos(w), mitte[1] + radius * Math.sin(w)]);
  }
  return ring;
}

// --- GeoPackage-Geometrie: kleiner Kopf ("GP") + WKB (Well-Known Binary) ---

// Kopf: "GP", Version 0, Flags, SRS-ID, Hülle (minX, maxX, minY, maxY)
function gpkgKopf(huelle) {
  const kopf = new DataView(new ArrayBuffer(8 + (huelle ? 32 : 0)));
  kopf.setUint8(0, 0x47); kopf.setUint8(1, 0x50);   // "G", "P"
  kopf.setUint8(2, 0);                               // Version
  kopf.setUint8(3, huelle ? 0b011 : 0b001);          // Little Endian (+ XY-Hülle)
  kopf.setInt32(4, 25832, true);                     // Koordinatensystem
  if (huelle) {
    kopf.setFloat64(8, huelle[0], true);  kopf.setFloat64(16, huelle[2], true);
    kopf.setFloat64(24, huelle[1], true); kopf.setFloat64(32, huelle[3], true);
  }
  return new Uint8Array(kopf.buffer);
}

function wkbPunkt(c) {
  const wkb = new DataView(new ArrayBuffer(21));
  wkb.setUint8(0, 1); wkb.setUint32(1, 1, true);     // Little Endian, Typ 1 = Point
  wkb.setFloat64(5, c[0], true); wkb.setFloat64(13, c[1], true);
  return verbinde(gpkgKopf(null), new Uint8Array(wkb.buffer));
}

// polygone = Liste von Polygonen, jedes = Liste von Ringen, jeder = Liste von [x, y]
//   multi: true → MultiPolygon (Typ 6), sonst ein einzelnes Polygon (Typ 3)
function wkbPolygone(polygone, multi) {
  const teile = [];
  let huelle = [Infinity, Infinity, -Infinity, -Infinity];
  function polygonWkb(ringe) {
    let groesse = 9;
    ringe.forEach(function (r) { groesse += 4 + r.length * 16; });
    const v = new DataView(new ArrayBuffer(groesse));
    v.setUint8(0, 1); v.setUint32(1, 3, true); v.setUint32(5, ringe.length, true);
    let pos = 9;
    ringe.forEach(function (ring) {
      v.setUint32(pos, ring.length, true); pos += 4;
      ring.forEach(function (c) {
        v.setFloat64(pos, c[0], true); v.setFloat64(pos + 8, c[1], true); pos += 16;
        huelle = [Math.min(huelle[0], c[0]), Math.min(huelle[1], c[1]), Math.max(huelle[2], c[0]), Math.max(huelle[3], c[1])];
      });
    });
    return new Uint8Array(v.buffer);
  }
  if (multi) {
    const kopf = new DataView(new ArrayBuffer(9));
    kopf.setUint8(0, 1); kopf.setUint32(1, 6, true); kopf.setUint32(5, polygone.length, true);
    teile.push(new Uint8Array(kopf.buffer));
    polygone.forEach(function (p) { teile.push(polygonWkb(p)); });
  } else {
    teile.push(polygonWkb(polygone[0]));
  }
  return verbinde.apply(null, [gpkgKopf(huelle)].concat(teile));
}

// Hülle aus dem Kopf einer gespeicherten Geometrie lesen (Punkte: aus dem WKB)
function gpkgHuelle(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if ((v.getUint8(3) & 0b1110) !== 0) {
    return [v.getFloat64(8, true), v.getFloat64(24, true), v.getFloat64(16, true), v.getFloat64(32, true)];
  }
  const x = v.getFloat64(8 + 5, true), y = v.getFloat64(8 + 13, true);
  return [x, y, x, y];
}

// Mehrere Byte-Stücke zu einem zusammenfügen
function verbinde() {
  const stuecke = Array.prototype.slice.call(arguments);
  const gesamt = new Uint8Array(stuecke.reduce(function (s, t) { return s + t.length; }, 0));
  let pos = 0;
  stuecke.forEach(function (t) { gesamt.set(t, pos); pos += t.length; });
  return gesamt;
}

// Zahl auf n Nachkommastellen runden
function runde(zahl, n) {
  const f = Math.pow(10, n);
  return Math.round(zahl * f) / f;
}

// ------------------------------------------------------------
// Darstellung: Farbe, Kartenstil, Füllung und Radien einstellen
// ------------------------------------------------------------

// Alle Einstellungen auf Seite und Karte anwenden
function wendeDarstellungAn() {
  const e = einstellungen;

  // Akzentfarbe für die ganze Seite (CSS-Variable) – Knöpfe, Legende usw.
  document.documentElement.style.setProperty('--accent', e.farbe);
  const rgb = hexZuRgb(e.farbe);
  document.documentElement.style.setProperty('--accent-fuellung',
    'rgba(' + rgb.join(',') + ',' + e.deckkraft + ')');

  // Kartenstil: eine CSS-Klasse am Karten-Element (siehe style.css)
  const karte = document.getElementById('map');
  karte.classList.remove('stil-grau', 'stil-farbig', 'stil-dunkel');
  karte.classList.add('stil-' + e.kartenstil);

  // Legende und Tabellenköpfe an die Radien anpassen
  document.getElementById('legende-innen').textContent = deutsch(e.radiusInnen, 0) + ' m';
  document.getElementById('legende-aussen').textContent = deutsch(e.radiusAussen, 0) + ' m';
  document.getElementById('legende-innen-min').textContent = '≈ ' + deutsch(e.radiusInnen / GEHTEMPO_M_PRO_MIN, 0) + ' Min.';
  document.getElementById('legende-aussen-min').textContent = '≈ ' + deutsch(e.radiusAussen / GEHTEMPO_M_PRO_MIN, 0) + ' Min.';
  document.getElementById('kopf-innen').textContent = '≤ ' + deutsch(e.radiusInnen, 0) + ' m';
  document.getElementById('kopf-aussen').textContent = '≤ ' + deutsch(e.radiusAussen, 0) + ' m';

  // Bedienelemente auf die aktuellen Werte setzen
  document.getElementById('farbe-frei').value = e.farbe.toLowerCase();
  document.querySelectorAll('.farbfeld').forEach(function (feld) {
    feld.classList.toggle('aktiv', feld.dataset.farbe.toLowerCase() === e.farbe.toLowerCase());
  });
  document.getElementById('kartenstil').value = e.kartenstil;
  document.getElementById('deckkraft').value = Math.round(e.deckkraft * 100);
  document.getElementById('deckkraft-wert').textContent = Math.round(e.deckkraft * 100) + ' %';
  document.getElementById('radius-innen').value = e.radiusInnen;
  document.getElementById('radius-aussen').value = e.radiusAussen;

  // Vorhandene Kreise umfärben
  faerbeKreise();
}

// Einstellung ändern → speichern → anzeigen
function aendere(neueWerte) {
  Object.assign(einstellungen, neueWerte);
  speichereEinstellungen();
  wendeDarstellungAn();
}

// Farbfelder (Orange, Blau, Grün, Schwarz)
document.querySelectorAll('.farbfeld').forEach(function (feld) {
  feld.addEventListener('click', function () { aendere({ farbe: feld.dataset.farbe }); });
});

// Freier Farbwähler ("input" = schon während man im Farbwähler zieht)
document.getElementById('farbe-frei').addEventListener('input', function (event) {
  aendere({ farbe: event.target.value });
});

// Kartenstil
document.getElementById('kartenstil').addEventListener('change', function (event) {
  aendere({ kartenstil: event.target.value });
});

// Füllung innen (Schieberegler 0–50 %)
document.getElementById('deckkraft').addEventListener('input', function (event) {
  aendere({ deckkraft: Number(event.target.value) / 100 });
});

// Radien: erst prüfen, dann Analyse mit neuen Kreisen wiederholen
function radienGeaendert() {
  const innen = Math.round(Number(document.getElementById('radius-innen').value));
  const aussen = Math.round(Number(document.getElementById('radius-aussen').value));
  const meldung = document.getElementById('darstellung-status');

  if (!(innen >= 100 && aussen <= 1500 && innen < aussen)) {
    meldung.textContent = 'Radien: 100–1.500 m, der innere muss kleiner als der äußere sein.';
    return;
  }
  meldung.textContent = '';
  aendere({ radiusInnen: innen, radiusAussen: aussen });

  // Gibt es schon einen Standort? Dann neu analysieren (neue Kreise, neue Zählung)
  if (letzterPunkt) analysiereStandort(letzterPunkt);
}
document.getElementById('radius-innen').addEventListener('change', radienGeaendert);
document.getElementById('radius-aussen').addEventListener('change', radienGeaendert);

// Alles auf Standard zurücksetzen
document.getElementById('zuruecksetzen').addEventListener('click', function () {
  const radienAnders = einstellungen.radiusInnen !== STANDARD.radiusInnen ||
                       einstellungen.radiusAussen !== STANDARD.radiusAussen;
  document.getElementById('darstellung-status').textContent = '';
  aendere(Object.assign({}, STANDARD));
  if (radienAnders && letzterPunkt) analysiereStandort(letzterPunkt);
});

// "#FF4F00" → [255, 79, 0]
function hexZuRgb(hex) {
  const zahl = parseInt(hex.slice(1), 16);
  return [(zahl >> 16) & 255, (zahl >> 8) & 255, zahl & 255];
}

// Beim Laden der Seite einmal anwenden (gespeicherte Einstellungen)
wendeDarstellungAn();
