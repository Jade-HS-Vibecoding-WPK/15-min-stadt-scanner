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

// Overpass-API: kostenloser Abfragedienst für OpenStreetMap-Daten.
// Die Server sind manchmal ausgelastet – dann wird der nächste probiert.
const OVERPASS_SERVER = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter'
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

  // Haltepunkte: auf dunkler Karte hell, sonst schwarz
  analyse.eachLayer(function (ebene) {
    if (ebene.options.className === 'haltepunkt') ebene.setStyle({ fillColor: haltepunktFarbe() });
  });
}

function haltepunktFarbe() {
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

  // Echte Infrastruktur-Daten aus OpenStreetMap nachladen
  ladeOepnv(punkt);
}

// ------------------------------------------------------------
// Infrastruktur: ÖPNV-Haltepunkte über die Overpass-API laden
// ------------------------------------------------------------
let standortMarker = null;   // damit der Standort-Punkt oben bleibt
let letzteHaltepunkte = null; // zuletzt geladene Haltepunkte (null = noch keine)
let anfrageNummer = 0;       // zählt Anfragen mit (siehe unten)

async function ladeOepnv(punkt) {
  // Jede Analyse bekommt eine Nummer. Klickt man schnell zweimal,
  // kommt die alte Antwort evtl. später an – die ignorieren wir dann.
  const meineNummer = ++anfrageNummer;

  letzteHaltepunkte = null;   // alte Daten verwerfen (für GeoJSON-Export)

  const rInnen = einstellungen.radiusInnen;
  const rAussen = einstellungen.radiusAussen;
  const zelleInnen = document.getElementById('oepnv-innen');
  const zelleAussen = document.getElementById('oepnv-aussen');
  const status = document.getElementById('infra-status');
  zelleInnen.textContent = '…';
  zelleAussen.textContent = '…';
  status.textContent = 'Lade Daten aus OpenStreetMap …';

  // Abfrage in der Overpass-Sprache: alle Bus-, Tram- und Bahn-
  // Haltepunkte im Umkreis des äußeren Kreises
  const umkreis = '(around:' + rAussen + ',' + punkt.lat + ',' + punkt.lng + ')';
  const abfrage =
    '[out:json][timeout:25];(' +
    'node["highway"="bus_stop"]' + umkreis + ';' +
    'node["public_transport"="platform"]' + umkreis + ';' +
    'node["railway"~"^(station|halt|tram_stop)$"]' + umkreis + ';' +
    ');out body;';

  try {
    // Bis zu 3 Versuche. Ist der Server voll, warten wir kurz und
    // probieren es erneut – jedes Mal doppelt so lange (5 s, dann 10 s).
    // So empfiehlt es der Overpass-Server selbst.
    let daten = null;
    let wartezeit = 5;
    for (let versuch = 1; versuch <= 3; versuch++) {
      try {
        daten = await overpassAbfrage(abfrage);
        break;
      } catch (fehler) {
        if (versuch === 3) throw fehler;
        if (meineNummer !== anfrageNummer) return;
        status.textContent = 'Server ausgelastet – neuer Versuch in ' + wartezeit + ' s …';
        await warte(wartezeit);
        if (meineNummer !== anfrageNummer) return;
        status.textContent = 'Lade Daten aus OpenStreetMap … (Versuch ' + (versuch + 1) + ' von 3)';
        wartezeit = wartezeit * 2;
      }
    }

    // Inzwischen wurde woanders geklickt? Dann nichts mehr tun.
    if (meineNummer !== anfrageNummer) return;

    let anzahlInnen = 0;
    let anzahlAussen = 0;
    const gefunden = [];

    daten.elements.forEach(function (element) {
      const ort = L.latLng(element.lat, element.lon);
      const entfernung = map.distance(punkt, ort); // Luftlinie in Metern

      if (entfernung <= rAussen) anzahlAussen++;
      if (entfernung <= rInnen) anzahlInnen++;

      // für den GeoJSON-Export merken
      gefunden.push({
        lat: element.lat,
        lon: element.lon,
        name: (element.tags && element.tags.name) || '',
        entfernung: entfernung,
        osmId: element.type + '/' + element.id
      });

      // Punkt auf die Karte zeichnen (klein, schwarz)
      const kreis = L.circleMarker(ort, {
        radius: 3.5,
        stroke: false,
        className: 'haltepunkt',
        fillColor: haltepunktFarbe(),   // schwarz, auf dunkler Karte hell
        fillOpacity: 1
      }).addTo(analyse);

      // Name beim Darüberfahren mit der Maus anzeigen
      const name = document.createElement('span');
      name.textContent = (element.tags && element.tags.name) || 'Haltepunkt';
      kreis.bindTooltip(name, { direction: 'top' });
    });

    letzteHaltepunkte = gefunden;
    zelleInnen.textContent = anzahlInnen;
    zelleAussen.textContent = anzahlAussen;
    status.textContent = '';
    if (standortMarker) standortMarker.bringToFront();
  } catch (fehler) {
    if (meineNummer !== anfrageNummer) return;
    zelleInnen.textContent = '–';
    zelleAussen.textContent = '–';
    status.textContent = 'Daten gerade nicht abrufbar – die kostenlosen Overpass-Server sind ausgelastet. Bitte in ein paar Minuten erneut klicken.';
  }
}

// Kleine Hilfe: eine bestimmte Anzahl Sekunden abwarten
function warte(sekunden) {
  return new Promise(function (fertig) { setTimeout(fertig, sekunden * 1000); });
}

// Schickt eine Abfrage an die Overpass-Server – der Reihe nach,
// bis einer antwortet. Pro Server warten wir höchstens 15 Sekunden.
async function overpassAbfrage(abfrage) {
  for (const server of OVERPASS_SERVER) {
    try {
      const antwort = await fetch(server, {
        method: 'POST',
        body: new URLSearchParams({ data: abfrage }),
        signal: AbortSignal.timeout(15000)
      });
      if (antwort.ok) return await antwort.json();
    } catch (fehler) {
      // Server nicht erreichbar oder zu langsam → nächsten probieren
    }
  }
  throw new Error('Kein Overpass-Server erreichbar');
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
    tabellenZeile(pdf, [
      'ÖPNV-Haltepunkte',
      zahlOderStrich('oepnv-innen'),
      zahlOderStrich('oepnv-aussen')
    ], spalten2, x, xr, y, true);

    // 5) Fußzeile unten im Plankopf: Datum + Quellen (Lizenzpflicht!)
    let yu = BLATT_H - RAND - 14;
    pdf.setDrawColor(17, 17, 17);
    pdf.setLineWidth(0.3);
    pdf.line(x, yu - 5, xr, yu - 5);
    grauerText(pdf, 'Erstellt am ' + new Date().toLocaleDateString('de-DE'), x, yu, false);
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
// Export: GeoJSON für QGIS
//   GeoJSON ist ein offenes Geodaten-Format (Textdatei). QGIS
//   öffnet es per Drag & Drop. Koordinatensystem: WGS 84
//   (EPSG:4326, Längen-/Breitengrade) – so schreibt es der
//   GeoJSON-Standard vor.
//   Inhalt: Standort (Punkt), innerer/äußerer Kreis (Flächen),
//           ÖPNV-Haltepunkte (Punkte) mit Attributen.
//   Attributnamen max. 10 Zeichen, damit sie auch beim
//   Weiterspeichern als Shapefile vollständig bleiben.
// ------------------------------------------------------------
const OSM_QUELLE = '© OpenStreetMap-Mitwirkende, ODbL';

document.getElementById('geojson-knopf').addEventListener('click', function () {
  if (!letzterPunkt) {
    exportStatus.textContent = 'Bitte zuerst einen Standort wählen (Klick auf die Karte oder Adresssuche).';
    return;
  }

  const features = [];

  // 1) Standort als Punkt
  features.push(punktFeature(letzterPunkt.lat, letzterPunkt.lng, {
    typ: 'Standort',
    name: letzteAdresse || '',
    lat: runde(letzterPunkt.lat, 6),
    lon: runde(letzterPunkt.lng, 6)
  }));

  // 2) Gehzeit-Kreise als Flächen (großer zuerst, damit der kleine oben liegt)
  [einstellungen.radiusAussen, einstellungen.radiusInnen].forEach(function (radius) {
    const fussweg = radius * UMWEGFAKTOR;
    features.push({
      type: 'Feature',
      properties: {
        typ: 'Einzugsbereich',
        radius_m: radius,
        luft_min: runde(radius / GEHTEMPO_M_PRO_MIN, 1),   // Gehzeit Luftlinie
        flaeche_ha: runde(kreisflaeche(radius) / 10000, 1),
        fussweg_m: Math.round(fussweg),                      // mit Umwegfaktor
        geh_min: runde(fussweg / GEHTEMPO_M_PRO_MIN, 1),     // realistische Gehzeit
        umwegfakt: UMWEGFAKTOR
      },
      geometry: { type: 'Polygon', coordinates: [kreisPolygon(letzterPunkt, radius, 128)] }
    });
  });

  // 3) ÖPNV-Haltepunkte (nur wenn sie geladen werden konnten)
  (letzteHaltepunkte || []).forEach(function (hp) {
    features.push(punktFeature(hp.lat, hp.lon, {
      typ: 'ÖPNV-Haltepunkt',
      name: hp.name,
      entf_m: Math.round(hp.entfernung),
      im_innen: hp.entfernung <= einstellungen.radiusInnen ? 1 : 0,   // 1 = im inneren Kreis
      osm_id: hp.osmId,
      quelle: OSM_QUELLE
    }));
  });

  const geojson = {
    type: 'FeatureCollection',
    name: 'stadt_scanner',
    features: features
  };

  // Als Datei herunterladen, z. B. "stadt-scanner-2026-11-16.geojson"
  const datei = new Blob([JSON.stringify(geojson, null, 2)], { type: 'application/geo+json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(datei);
  link.download = 'stadt-scanner-' + new Date().toISOString().slice(0, 10) + '.geojson';
  link.click();
  setTimeout(function () { URL.revokeObjectURL(link.href); }, 10000);

  exportStatus.textContent = letzteHaltepunkte
    ? 'GeoJSON gespeichert (Standort, Kreise, ' + letzteHaltepunkte.length + ' Haltepunkte).'
    : 'GeoJSON gespeichert – ohne Haltepunkte, da diese nicht geladen werden konnten.';
});

// --- kleine Helfer für den GeoJSON-Export ---

// Ein Punkt-Feature. Achtung: GeoJSON erwartet [Länge, Breite]!
function punktFeature(lat, lon, eigenschaften) {
  return {
    type: 'Feature',
    properties: eigenschaften,
    geometry: { type: 'Point', coordinates: [runde(lon, 7), runde(lat, 7)] }
  };
}

// Kreis als Vieleck mit n Ecken berechnen (auf der Erdkugel, Radius in Metern).
// Formel: "Zielpunkt bei gegebener Entfernung und Richtung".
function kreisPolygon(mitte, radius, n) {
  const ERDRADIUS = 6371008.8;
  const lat1 = mitte.lat * Math.PI / 180;
  const lon1 = mitte.lng * Math.PI / 180;
  const winkel = radius / ERDRADIUS;
  const ring = [];
  for (let i = 0; i <= n; i++) {
    const richtung = (i % n) / n * 2 * Math.PI;   // letzter Punkt = erster (geschlossen)
    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(winkel) +
                           Math.cos(lat1) * Math.sin(winkel) * Math.cos(richtung));
    const lon2 = lon1 + Math.atan2(Math.sin(richtung) * Math.sin(winkel) * Math.cos(lat1),
                                   Math.cos(winkel) - Math.sin(lat1) * Math.sin(lat2));
    ring.push([runde(lon2 * 180 / Math.PI, 7), runde(lat2 * 180 / Math.PI, 7)]);
  }
  // GeoJSON-Regel: Außenringe gegen den Uhrzeigersinn → Reihenfolge umdrehen
  return ring.reverse();
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
