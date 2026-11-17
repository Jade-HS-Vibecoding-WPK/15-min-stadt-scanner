// ============================================================
// 15-Minuten-Stadt-Scanner
// ============================================================

// Apple Text-Schwarz für Linien und Punkte (gleich wie in style.css)
const INK = '#1D1D1F';

// ------------------------------------------------------------
// Einstellungen (im Bereich "Darstellung" änderbar).
// Sie werden im Browser gespeichert (localStorage) und sind beim
// nächsten Besuch wieder da.
// ------------------------------------------------------------
const STANDARD = {
  farbe: '#007AFF',        // Akzentfarbe: Apple Systemblau
  kartenstil: 'grau',      // 'grau', 'farbig' oder 'dunkel'
  deckkraft: 0.12,         // Füllung des inneren Kreises (0 = nur Linie)
  radiusInnen: 400,        // Meter (≈ 5 Min.)
  radiusAussen: 800        // Meter (≈ 10 Min.)
};
const SPEICHER_NAME = 'stadtScannerEinstellungen-v3';   // v3: Apple-Farben
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
//   farbe: Apple-Systemfarbe (Füllung), kontur: weißer Rand (wie Apple Karten)
const KATEGORIEN = [
  { id: 'oepnv',      name: 'ÖPNV-Haltepunkte',     form: 'kreis',   farbe: '#30B0C7', kontur: '#FFFFFF' },
  { id: 'versorgung', name: 'Supermärkte & Bäcker', form: 'quadrat', farbe: '#FF9500', kontur: '#FFFFFF' },
  { id: 'bildung',    name: 'Kitas & Schulen',      form: 'dreieck', farbe: '#AF52DE', kontur: '#FFFFFF' },
  { id: 'gruen',      name: 'Parks',                form: 'flaeche', farbe: '#34C759', kontur: '#FFFFFF' }
];

// 1) Karte erzeugen und auf Oldenburg zentrieren
//    [Breitengrad, Längengrad], Zoomstufe
const map = L.map('map').setView([53.1435, 8.2146], 14);

// Namensnennung ohne den Zusatz "Leaflet" + Flagge (ruhiger); OSM bleibt sichtbar
map.attributionControl.setPrefix(false);

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
}

// Kleines SVG-Symbol einer Kategorie: kräftige Füllung + weißer Rand.
//   Wird auf der Karte, in der Legende und in der Tabelle verwendet.
function symbolSvg(katId) {
  const kat = KATEGORIEN.find(function (k) { return k.id === katId; });
  const stil = 'fill="' + kat.farbe + '" stroke="' + kat.kontur + '" stroke-width="1"';
  let form;
  if (kat.form === 'kreis')   form = '<circle cx="5.5" cy="5.5" r="4.5" ' + stil + '/>';
  if (kat.form === 'quadrat') form = '<rect x="1.5" y="1.5" width="8" height="8" ' + stil + '/>';
  if (kat.form === 'dreieck') form = '<polygon points="5.5,1 10,10 1,10" ' + stil + ' stroke-linejoin="round"/>';
  if (kat.form === 'flaeche') {
    return '<svg class="sym sym-flaeche" viewBox="0 0 14 11" aria-hidden="true">' +
           '<rect x="0.5" y="1.5" width="13" height="8" ' + stil + '/></svg>';
  }
  return '<svg class="sym" viewBox="0 0 11 11" aria-hidden="true">' + form + '</svg>';
}

// Platzhalter in Legende und Tabelle (data-symbol="…") mit Symbolen füllen
document.querySelectorAll('[data-symbol]').forEach(function (platz) {
  platz.outerHTML = symbolSvg(platz.dataset.symbol);
});

// ------------------------------------------------------------
// Animationen (wie bei Apple: weich auslaufend, leicht nachfedernd)
// Wer im Betriebssystem "Bewegung reduzieren" eingestellt hat,
// bekommt keine Animationen – das ist Apples eigene Regel.
// ------------------------------------------------------------
const WENIG_BEWEGUNG = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Feder-Kurve: t läuft von 0 bis 1, das Ergebnis schießt kurz über 1
// hinaus (≈ 4 %) und federt dann zurück – wie ein Gummiband.
function federKurve(t) {
  const c = 1.1;
  return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
}

// Weiche Kurve ohne Überschwingen (schnell los, sanft ankommen)
function weichKurve(t) {
  return 1 - Math.pow(1 - t, 3);
}

// Lässt innerer Kreis, äußerer Kreis und Standort-Punkt nacheinander
// aufgehen. Jeder Eintrag: [Objekt, Zielgröße, Verzögerung in ms]
let kreisAnimation = null;
let kreiseWachsen = false;   // läuft gerade eine Kreis-Animation?
let analyseNummer = 0;       // zählt jede Analyse (alte Animationen erkennen)
let kameraFliegt = false;    // fliegt die Karte gerade zum Standort?

// Für den Export: warten, bis Kreise und Kameraflug fertig sind
// (höchstens 2 Sekunden), damit nichts "halb fertig" im Bild landet
async function warteAufAnimationen() {
  for (let i = 0; i < 40 && (kreiseWachsen || kameraFliegt); i++) {
    await new Promise(function (r) { setTimeout(r, 50); });
  }
}

// Kreise + Punkt ganz klein machen (unsichtbar), bis die Karte steht
function kreiseVerstecken() {
  cancelAnimationFrame(kreisAnimation);
  [standortMarker, kreisInnen, kreisAussen].forEach(function (k) { k.setRadius(0.01); });
  kreiseWachsen = true;
}

function lasseKreiseWachsen() {
  cancelAnimationFrame(kreisAnimation);
  if (WENIG_BEWEGUNG) return;

  const ablauf = [
    [standortMarker, 6, 0],
    [kreisInnen, einstellungen.radiusInnen, 60],
    [kreisAussen, einstellungen.radiusAussen, 160]
  ];
  const DAUER = 700;
  kreiseWachsen = true;

  const start = performance.now();
  function schritt(jetzt) {
    let fertig = true;
    ablauf.forEach(function (a) {
      const t = Math.min(1, Math.max(0, (jetzt - start - a[2]) / DAUER));
      if (t < 1) fertig = false;
      a[0].setRadius(Math.max(0.01, a[1] * federKurve(t)));
    });
    if (!fertig) kreisAnimation = requestAnimationFrame(schritt);
    else kreiseWachsen = false;
  }
  kreisAnimation = requestAnimationFrame(schritt);
}

// Zahl hochzählen lassen, z. B. "0/8" → "7/8"
let zahlAnimation = null;
function zaehleHoch(element, ziel, nachsatz) {
  cancelAnimationFrame(zahlAnimation);
  if (WENIG_BEWEGUNG) { element.textContent = ziel + nachsatz; return; }
  const start = performance.now();
  const DAUER = 650;
  function schritt(jetzt) {
    const t = Math.min(1, (jetzt - start) / DAUER);
    element.textContent = Math.round(ziel * weichKurve(t)) + nachsatz;
    if (t < 1) zahlAnimation = requestAnimationFrame(schritt);
  }
  zahlAnimation = requestAnimationFrame(schritt);
}

// CSS-Animation erneut abspielen: Klasse kurz entfernen und wieder setzen
function spieleAb(element, klasse) {
  element.classList.remove(klasse);
  void element.offsetWidth;   // Browser "vergisst" die alte Animation
  element.classList.add(klasse);
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
    fill: false,
    interactive: false   // nur Zeichnung: Klicks gehen an die Karte
  }).addTo(analyse);

  // Innerer Kreis (Standard 400 m ≈ 5 Min.): Linie + leichte Füllung
  kreisInnen = L.circle(punkt, {
    radius: einstellungen.radiusInnen,
    weight: 1.5,
    interactive: false
  }).addTo(analyse);

  // Standort-Marker: kleiner Punkt in Akzentfarbe mit schwarzem Rand
  standortMarker = L.circleMarker(punkt, {
    radius: 6,
    color: INK,
    weight: 1.5,
    fillOpacity: 1,
    interactive: false
  }).addTo(analyse);

  faerbeKreise();   // Farbe + Deckkraft aus den Einstellungen anwenden

  // Karte so zoomen, dass der große Kreis ganz zu sehen ist –
  // im freien Teil der Karte, nicht hinter dem Glas-Panel
  const frei = verdeckterRand();
  const ausschnitt = {
    paddingTopLeft: [40, 40],
    paddingBottomRight: [40 + frei.rechts, 40 + frei.unten]
  };
  const ziel = kreisAussen.getBounds();
  const nummer = ++analyseNummer;

  if (WENIG_BEWEGUNG) {
    map.fitBounds(ziel, ausschnitt);
  } else {
    // Reihenfolge wie bei Apple: ERST bewegt sich die Karte, DANN wachsen
    // die Kreise und ploppen die Symbole auf. Beides gleichzeitig ruckelt,
    // weil Leaflet die Kreise während der Kamerafahrt nur "gestreckt"
    // anzeigt und erst am Ende neu zeichnet.
    kreiseVerstecken();
    map.getContainer().classList.add('karte-bewegt');   // Symbole kurz ausblenden
    kameraFliegt = true;

    let gestartet = false;
    const losGehts = function () {
      // nur, wenn inzwischen nicht schon ein neuer Standort gewählt wurde
      if (gestartet || nummer !== analyseNummer) return;
      gestartet = true;
      kameraFliegt = false;
      map.getContainer().classList.remove('karte-bewegt');
      lasseKreiseWachsen();
    };

    map.stop();                     // laufende Kamerafahrt beenden
    map.once('moveend', losGehts);  // wenn die Karte steht → los
    setTimeout(losGehts, 1200);     // Sicherheitsnetz

    // Weiches Schwenken/Zoomen (Leaflet-eigene, ruckelfreie Animation)
    ausschnitt.animate = true;
    ausschnitt.duration = 0.55;                  // Sekunden
    ausschnitt.pan = { easeLinearity: 0.15 };    // sanft abbremsen
    map.fitBounds(ziel, ausschnitt);
  }

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
  letzteBewertung = null;

  // Daten nicht geladen oder Standort außerhalb des Datengebiets?
  if (!window.OSM_DATEN || !imDatengebiet(punkt)) {
    zeigeBewertung(null);
    status.textContent = window.OSM_DATEN
      ? 'Außerhalb des Datengebiets – Infrastruktur nur für Oldenburg und Umgebung verfügbar.'
      : 'Infrastruktur-Daten konnten nicht geladen werden.';
    return;
  }

  // Zähler für jede Kategorie vorbereiten
  const zaehler = {};
  KATEGORIEN.forEach(function (kat) { zaehler[kat.id] = { innen: 0, aussen: 0, naechstes: null }; });
  const gefunden = [];

  OSM_DATEN.features.forEach(function (ort) {
    // Schneller Vorab-Test: grob zu weit weg? Dann gar nicht genau rechnen.
    if (!grobInDerNaehe(ort, punkt, rAussen)) return;

    const stelle = naechsteStelle(ort, punkt);   // Luftlinie in Metern + Zielpunkt
    const entfernung = stelle.entfernung;
    const kat = ort.properties.kat;

    // Nächstes Ziel dieser Kategorie merken – auch außerhalb der Kreise,
    // damit wir zeigen können, wie weit es bis zum nächsten Ziel ist
    const bisher = zaehler[kat].naechstes;
    if (!bisher || entfernung < bisher.entfernung) {
      zaehler[kat].naechstes = { name: ort.properties.name || '', entfernung: entfernung, lage: stelle.lage };
    }

    if (entfernung > rAussen) return;

    zaehler[kat].aussen++;
    if (entfernung <= rInnen) zaehler[kat].innen++;
    gefunden.push({ ort: ort, entfernung: entfernung });

    zeichneOrt(ort);
  });

  // Ergebnisse ins Panel schreiben (Anzahlen stehen in der Aufschlüsselung)
  status.textContent = 'OSM-Stand ' + OSM_DATEN.datenstand + '. Parks zählen ab ihrem Rand.';

  letzteOrte = gefunden;
  letzteBewertung = berechneBewertung(zaehler);
  zeigeBewertung(letzteBewertung);
  faerbeKreise();
  if (standortMarker) standortMarker.bringToFront();
}

// ------------------------------------------------------------
// 15-Minuten-Bewertung
//   Pro Kategorie:  2 Punkte = mind. ein Ziel im inneren Kreis (≈ 5 Min.)
//                   1 Punkt  = erst im äußeren Kreis (≈ 10 Min.)
//                   0 Punkte = gar nicht im Umkreis
//   4 Kategorien × 2 Punkte = höchstens 8 Punkte (= 100 %)
// ------------------------------------------------------------
let letzteBewertung = null;

const BEWERTUNGS_STUFEN = [
  { ab: 0.875, text: 'sehr gut versorgt' },   // 7–8 Punkte
  { ab: 0.625, text: 'gut versorgt' },        // 5–6 Punkte
  { ab: 0.375, text: 'teilweise versorgt' },  // 3–4 Punkte
  { ab: 0,     text: 'schwach versorgt' }     // 0–2 Punkte
];

function berechneBewertung(zaehler) {
  let punkte = 0;
  const fehlend = [];   // Kategorien ohne Ziel im inneren Kreis
  const details = [];   // Aufschlüsselung: eine Zeile pro Kategorie
  KATEGORIEN.forEach(function (kat) {
    const z = zaehler[kat.id];
    let p = 0;
    if (z.innen > 0) p = 2;
    else if (z.aussen > 0) { p = 1; fehlend.push(kat.name + ' (erst im äußeren Kreis)'); }
    else fehlend.push(kat.name + ' (fehlt ganz)');
    punkte += p;
    details.push({ kat: kat, punkte: p, innen: z.innen, aussen: z.aussen, naechstes: z.naechstes });
  });
  const maximum = KATEGORIEN.length * 2;
  const anteil = punkte / maximum;
  return {
    punkte: punkte,
    maximum: maximum,
    prozent: Math.round(anteil * 100),
    stufe: BEWERTUNGS_STUFEN.find(function (s) { return anteil >= s.ab; }).text,
    fehlend: fehlend,
    details: details
  };
}

// Bewertung oben im Ergebnis-Block anzeigen:
//   Ring (4 Segmente = 4 Kategorien), große Zahl, Stufe – und die
//   aufklappbare Aufschlüsselung mit dem nächsten Ziel je Kategorie.
function zeigeBewertung(b) {
  const zahl = document.getElementById('bewertung');
  const stufe = document.getElementById('bewertung-stufe');
  const knopf = document.getElementById('bewertung-knopf');
  entferneWeg();
  zeichneRing(b);
  zeichneZeitstrahl(b);

  if (!b) {
    cancelAnimationFrame(zahlAnimation);
    zahl.textContent = '–';
    stufe.textContent = 'keine Daten für diesen Ort';
    knopf.disabled = true;
    klappeAufschluesselung(false);
    return;
  }
  knopf.disabled = false;
  zaehleHoch(zahl, b.punkte, '');
  document.getElementById('bewertung-max').textContent = '/' + b.maximum;
  stufe.textContent = b.stufe;
  fuelleAufschluesselung(b);
}

// --- Ring: wie die Aktivitätsringe der Apple Watch, aber in 4 Stücken.
//     Jedes Stück ist eine Kategorie; voll = 2 Punkte, halb = 1 Punkt.
function zeichneRing(b) {
  const R = 33, MITTE = 40, LUECKE = 14;   // Radius, Mittelpunkt, Lücke in Grad
  const STUECK = 90 - LUECKE;
  let svg = '<svg viewBox="0 0 80 80" aria-hidden="true">';
  KATEGORIEN.forEach(function (kat, i) {
    const von = i * 90 + LUECKE / 2 - 90;   // oben beginnen, im Uhrzeigersinn
    const d = bogen(MITTE, R, von, von + STUECK);
    const p = b ? b.details[i].punkte : 0;
    svg += '<path class="ring-spur" d="' + d + '"/>';
    svg += '<path class="ring-wert" d="' + d + '" pathLength="100" stroke="' + kat.farbe +
           '" data-ziel="' + (100 - p * 50) + '" style="stroke-dashoffset:100"/>';
  });
  svg += '</svg>';
  const ring = document.getElementById('bewertung-ring');
  ring.querySelector('svg') && ring.querySelector('svg').remove();
  ring.insertAdjacentHTML('afterbegin', svg);

  // Nach dem Einfügen die Stücke "füllen" (CSS-Übergang = Animation)
  requestAnimationFrame(function () {
    requestAnimationFrame(function () {
      ring.querySelectorAll('.ring-wert').forEach(function (pfad, i) {
        pfad.style.transitionDelay = (WENIG_BEWEGUNG ? 0 : 0.15 + i * 0.08) + 's';
        pfad.style.strokeDashoffset = pfad.dataset.ziel;
      });
    });
  });
}

// --- Zeitstrahl: Minuten-Achse, auf der das nächste Ziel jeder
//     Kategorie als Symbol sitzt. Die zwei Zonen entsprechen den Kreisen.
function zeichneZeitstrahl(b) {
  const feld = document.getElementById('zeitstrahl');
  if (!b) { feld.innerHTML = '<p class="anmerkung">Keine Daten für diesen Ort.</p>'; return; }

  const minuten = function (meter) { return meter * UMWEGFAKTOR / GEHTEMPO_M_PRO_MIN; };
  const tInnen = minuten(einstellungen.radiusInnen);
  const tAussen = minuten(einstellungen.radiusAussen);
  const MAX = Math.max(15, Math.ceil(tAussen) + 2);   // Achse: 0–15 Min.
  const pos = function (t) { return Math.min(100, t / MAX * 100); };

  let html = '<div class="zs-flaeche">' +
    '<span class="zs-zone zs-innen" style="width:' + pos(tInnen) + '%"></span>' +
    '<span class="zs-zone zs-aussen" style="left:' + pos(tInnen) + '%;width:' + (pos(tAussen) - pos(tInnen)) + '%"></span>';

  b.details.forEach(function (d) {
    const n = d.naechstes;
    const t = n ? minuten(n.entfernung) : null;
    const text = t === null ? 'über 3 km' : (t > MAX ? '› ' + MAX + ' Min.' : Math.max(1, Math.round(t)) + ' Min.');
    const x = t === null ? 100 : pos(t);
    html += '<button type="button" class="zs-bahn" data-kat="' + d.kat.id + '"' + (n ? '' : ' disabled') +
      ' title="' + d.kat.name + (n && n.name ? ': ' + n.name : '') + '">' +
      '<span class="zs-linie"></span>' +
      '<span class="zs-marke' + (x > 72 ? ' links' : '') + '" data-x="' + x + '" style="left:0">' +
        symbolSvg(d.kat.id) + '<span class="zs-zeit">' + text + '</span>' +
      '</span></button>';
  });
  // Achse: 0 · Grenze innerer Kreis · Grenze äußerer Kreis (in Minuten)
  const minText = function (t) { return deutsch(t, Math.abs(t - Math.round(t)) < 0.05 ? 0 : 1); };
  html += '</div><div class="zs-achse">' +
    '<span style="left:0">0</span>' +
    '<span style="left:' + pos(tInnen) + '%">' + minText(tInnen) + '</span>' +
    '<span style="left:' + pos(tAussen) + '%">' + minText(tAussen) + ' Min.</span></div>';
  feld.innerHTML = html;

  // Klick auf eine Bahn: Weg zum Ziel auf der Karte (wie in der Aufschlüsselung)
  feld.querySelectorAll('.zs-bahn').forEach(function (bahn, i) {
    bahn.addEventListener('click', function () { zeigeWeg(b.details[i], bahn); });
  });

  // Symbole gleiten von 0 an ihre Stelle (nacheinander)
  requestAnimationFrame(function () {
    requestAnimationFrame(function () {
      feld.querySelectorAll('.zs-marke').forEach(function (m, i) {
        m.style.transitionDelay = (WENIG_BEWEGUNG ? 0 : 0.2 + i * 0.07) + 's';
        m.style.left = m.dataset.x + '%';
      });
    });
  });
}

// SVG-Bogen von Winkel a1 bis a2 (Grad, 0 = rechts, im Uhrzeigersinn)
function bogen(m, r, a1, a2) {
  const p1 = [m + r * Math.cos(a1 * Math.PI / 180), m + r * Math.sin(a1 * Math.PI / 180)];
  const p2 = [m + r * Math.cos(a2 * Math.PI / 180), m + r * Math.sin(a2 * Math.PI / 180)];
  return 'M' + p1[0].toFixed(2) + ' ' + p1[1].toFixed(2) +
         ' A' + r + ' ' + r + ' 0 0 1 ' + p2[0].toFixed(2) + ' ' + p2[1].toFixed(2);
}

// --- Aufschlüsselung: je Kategorie Punkte + nächstes Ziel mit Gehzeit
const PUNKTE_TEXT = ['0 Punkte', '1 Punkt', '2 Punkte'];

function fuelleAufschluesselung(b) {
  const liste = document.getElementById('bewertung-liste');
  liste.innerHTML = '';
  b.details.forEach(function (d) {
    const zeile = document.createElement('li');
    const knopf = document.createElement('button');
    knopf.type = 'button';
    knopf.className = 'auf-zeile';
    knopf.dataset.kat = d.kat.id;

    // Punkte als zwei kleine Felder: ●● / ●○ / ○○
    let felder = '';
    for (let i = 0; i < 2; i++) {
      felder += '<span class="punkt' + (i < d.punkte ? ' voll' : '') + '" style="--kat:' + d.kat.farbe + '"></span>';
    }

    // Unterzeile: nächstes Ziel, Luftlinie, Gehzeit (wie bei den Einzugsbereichen)
    let unter;
    const n = d.naechstes;
    if (!n) {
      unter = 'kein Ziel in über 3 km Umkreis';
      knopf.disabled = true;
    } else {
      const min = Math.max(1, Math.round(n.entfernung * UMWEGFAKTOR / GEHTEMPO_M_PRO_MIN));
      const name = n.name || 'ohne Namen';
      unter = (n.entfernung === 0 ? 'Standort liegt im Park' : 'Nächstes: ' + name) + ' · ' +
              '<span class="mono">' + deutsch(Math.round(n.entfernung), 0) + ' m · ' + min + ' Min.</span>';
    }

    knopf.innerHTML =
      '<span class="auf-kopf">' + symbolSvg(d.kat.id) +
        '<span class="auf-name">' + d.kat.name + '</span>' +
        '<span class="auf-anzahl mono" title="Anzahl im inneren / äußeren Kreis">' + d.innen + ' · ' + d.aussen + '</span>' +
        '<span class="auf-punkte" title="' + PUNKTE_TEXT[d.punkte] + '">' + felder + '</span>' +
      '</span>' +
      '<span class="auf-unter">' + unter + '</span>';
    knopf.addEventListener('click', function () { zeigeWeg(d, knopf); });
    zeile.appendChild(knopf);
    liste.appendChild(zeile);
  });
}

// Auf- und zuklappen (offen = true/false)
function klappeAufschluesselung(offen) {
  const knopf = document.getElementById('bewertung-knopf');
  knopf.setAttribute('aria-expanded', offen ? 'true' : 'false');
  document.getElementById('ergebnis').classList.toggle('offen', offen);
  // Fokus: Tabellen 02 + 03 weichen, solange die Aufschlüsselung offen ist
  document.getElementById('kennzahlen').classList.toggle('fokus', offen);
  if (!offen) entferneWeg();
}
document.getElementById('bewertung-knopf').addEventListener('click', function () {
  klappeAufschluesselung(this.getAttribute('aria-expanded') !== 'true');
});

// --- Weg zum nächsten Ziel auf der Karte zeigen (gestrichelte Linie)
let wegEbene = null;
let wegKat = null;

function entferneWeg() {
  if (wegEbene) { analyse.removeLayer(wegEbene); wegEbene = null; }
  wegKat = null;
  document.querySelectorAll('.auf-zeile.aktiv, .zs-bahn.aktiv').forEach(function (z) { z.classList.remove('aktiv'); });
}

function zeigeWeg(d, knopf) {
  // Zweiter Klick auf dieselbe Zeile: Linie wieder weg
  if (wegKat === d.kat.id) { entferneWeg(); return; }
  entferneWeg();
  if (!d.naechstes || !letzterPunkt) return;

  wegKat = d.kat.id;
  knopf.classList.add('aktiv');
  const ziel = d.naechstes.lage;
  const min = Math.max(1, Math.round(d.naechstes.entfernung * UMWEGFAKTOR / GEHTEMPO_M_PRO_MIN));

  wegEbene = L.layerGroup([
    // Linie Standort → Ziel
    L.polyline([letzterPunkt, ziel], {
      color: INK, weight: 2, dashArray: '1 6', lineCap: 'round',
      interactive: false, className: 'weg-linie'
    }),
    // Ring um das Ziel in der Kategorie-Farbe
    L.circleMarker(ziel, {
      radius: 11, color: d.kat.farbe, weight: 2.5, fillOpacity: 0.15,
      fillColor: d.kat.farbe, interactive: false, className: 'weg-ziel'
    }).bindTooltip(
      (d.naechstes.name || d.kat.name) + ' · ' + deutsch(Math.round(d.naechstes.entfernung), 0) + ' m · ca. ' + min + ' Min.',
      { permanent: true, direction: 'top', offset: [0, -10], className: 'weg-schild' }
    )
  ]).addTo(analyse);

  // Liegt das Ziel außerhalb des sichtbaren Bereichs? Dann sanft hinschwenken.
  const frei = verdeckterRand();
  const grenzen = L.latLngBounds([letzterPunkt, ziel]);
  if (!map.getBounds().pad(-0.1).contains(ziel)) {
    map.fitBounds(grenzen, {
      paddingTopLeft: [60, 60], paddingBottomRight: [60 + frei.rechts, 60 + frei.unten],
      animate: !WENIG_BEWEGUNG, duration: 0.55, maxZoom: map.getZoom()
    });
  }
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
  return naechsteStelle(ort, punkt).entfernung;
}

// Wie entfernungZu, liefert aber zusätzlich den nächsten Punkt des Ortes
// (bei Parks: die nächste Ecke des Umrisses; liegt man im Park: der Standort)
function naechsteStelle(ort, punkt) {
  const geo = ort.geometry;
  if (geo.type === 'Point') {
    const lage = L.latLng(geo.coordinates[1], geo.coordinates[0]);
    return { entfernung: map.distance(punkt, lage), lage: lage };
  }
  const polygone = geo.type === 'Polygon' ? [geo.coordinates] : geo.coordinates;
  let beste = { entfernung: Infinity, lage: null };
  polygone.forEach(function (polygon) {
    if (punktInPolygon(punkt, polygon)) beste = { entfernung: 0, lage: punkt };
    if (beste.entfernung === 0) return;
    polygon[0].forEach(function (ecke) {
      const lage = L.latLng(ecke[1], ecke[0]);
      const e = map.distance(punkt, lage);
      if (e < beste.entfernung) beste = { entfernung: e, lage: lage };
    });
  });
  return beste;
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
    // Parks als salbeigrüne Fläche mit feiner Kontur
    const gruen = KATEGORIEN.find(function (k) { return k.id === 'gruen'; });
    L.geoJSON(ort, {
      style: { color: gruen.farbe, weight: 1, fillColor: gruen.farbe, fillOpacity: 0.28, className: 'park' },
      interactive: true
    }).eachLayer(function (ebene) {
      ebene.options.className = 'park';
      ebene.bindTooltip(name, { sticky: true });
      ebene.addTo(analyse);
    });
    return;
  }

  // Punkte als kleine farbige Symbole (Kreis, Quadrat, Dreieck)
  // Verzögerung je nach Entfernung: nahe Orte erscheinen zuerst,
  // ferne später – wie eine Welle, die sich vom Standort ausbreitet
  const lage = L.latLng(ort.geometry.coordinates[1], ort.geometry.coordinates[0]);
  const verzoegerung = 80 + Math.round(450 * Math.min(1, map.distance(letzterPunkt, lage) / einstellungen.radiusAussen));
  const html = symbolSvg(kat).replace('<svg ', '<svg style="animation-delay:' + verzoegerung + 'ms" ');
  const symbol = L.marker(lage, {
    icon: L.divIcon({ className: 'poi-marker', html: html, iconSize: [11, 11] }),
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
    deutsch(punkt.lat, 5) + '° N · ' + deutsch(punkt.lng, 5) + '° O';

  zeigeEinzugsbereiche();

  // Hinweistext ausblenden, Kennzahlen einblenden
  document.getElementById('hinweis').hidden = true;
  const kennzahlen = document.getElementById('kennzahlen');
  kennzahlen.hidden = false;
  spieleAb(kennzahlen, 'einblenden');   // Abschnitte gleiten nacheinander herein
}

// Tabelle "Einzugsbereiche" füllen – eine Zeile pro Radius
//   Fläche  = π · r²  (1 ha = 10.000 m²)
//   Fußweg  = Luftlinie × Umwegfaktor
//   Gehzeit = Fußweg ÷ Gehtempo (m pro Minute)
function zeigeEinzugsbereiche() {
  // Kurzfassung der beiden Kreise unter dem Zeitstrahl:
  // Radius · Gehzeit (mit Umweg) · Fläche
  const teile = [einstellungen.radiusInnen, einstellungen.radiusAussen].map(function (radius, i) {
    const hektar = kreisflaeche(radius) / 10000;
    const gehzeit = radius * UMWEGFAKTOR / GEHTEMPO_M_PRO_MIN;
    return '<span class="zs-kreis zs-kreis-' + (i ? 'aussen' : 'innen') + '"></span>' +
      deutsch(radius, 0) + ' m ≈ ' + deutsch(gehzeit, 1) + ' Min. · ' + deutsch(hektar, 1) + ' ha';
  });
  document.getElementById('vergleich-zeilen').innerHTML = teile.join('<br>');

  document.getElementById('vergleich-annahme').textContent =
    'Annahmen: Umwegfaktor ' + deutsch(UMWEGFAKTOR, 1) +
    ', Gehtempo ' + deutsch(GEHTEMPO_KMH, 1) + ' km/h.';
}

// ------------------------------------------------------------
// Export: Kartenbereich (Karte + Kreise + Legende + Maßstab +
// OSM-Namensnennung) als PNG-Bild speichern – z. B. fürs Poster
// ------------------------------------------------------------
const exportKnopf = document.getElementById('export-knopf');
const pdfKnopf = document.getElementById('pdf-knopf');
const exportStatus = document.getElementById('export-status');

// Wie viel Karte verdeckt das schwebende Panel? (in Pixeln)
//   Großer Bildschirm: Panel rechts → Rand rechts.
//   Handy: Panel unten → Rand unten.
function verdeckterRand() {
  // offsetLeft/offsetTop: Lage ohne laufende Animation (Panel gleitet beim Laden herein)
  const panel = document.getElementById('panel');
  const r = { left: panel.offsetLeft, top: panel.offsetTop };
  let rand;
  if (r.top > window.innerHeight / 3) {
    rand = { rechts: 0, unten: window.innerHeight - r.top };
  } else {
    rand = { rechts: window.innerWidth - r.left, unten: 0 };
  }
  // Sehr kleines Fenster: bleibt kaum Karte frei, Panel lieber ignorieren
  // (sonst zoomt die Karte extrem weit hinein)
  if (window.innerWidth - rand.rechts < 260) rand.rechts = 0;
  if (window.innerHeight - rand.unten < 220) rand.unten = 0;
  return rand;
}

// "Fotografiert" den Kartenbereich mit html-to-image.
//   format:     'png' (verlustfrei) oder 'jpeg' (kleinere Datei, fürs PDF)
//   pixelRatio: 2 = doppelte Auflösung, 3 = dreifache (scharf im Druck)
//   Das Bild endet links vom Glas-Panel (dort liegt die Analyse).
async function kartenBild(format, pixelRatio) {
  await warteAufAnimationen();
  const bereich = document.getElementById('karte-bereich');
  const frei = verdeckterRand();
  const optionen = {
    pixelRatio: pixelRatio,
    width: bereich.clientWidth - frei.rechts,
    height: bereich.clientHeight - frei.unten,
    backgroundColor: '#F2F2F7',
    quality: 0.92,          // nur für JPEG wichtig
    // Inter und IBM Plex Mono mit ins Bild übernehmen
    // (klappt nicht, wenn die Seite als Datei geöffnet ist → dann ohne)
    skipFonts: !location.protocol.startsWith('http'),
    // Zoom-Knöpfe (+/−) gehören nicht aufs Poster → weglassen
    filter: function (element) {
      // (auch der Knopf "Versorgungskarte")
      return !(element.classList && (element.classList.contains('leaflet-control-zoom') ||
                                     element.classList.contains('heat-knopf')));
    }
  };
  // Glas-Effekt kurz ausschalten (Unschärfe lässt sich nicht exportieren)
  document.body.classList.add('export-modus');
  try {
    return format === 'jpeg'
      ? await htmlToImage.toJpeg(bereich, optionen)
      : await htmlToImage.toPng(bereich, optionen);
  } finally {
    document.body.classList.remove('export-modus');
  }
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
    await ladePdfSchrift(pdf);   // IBM Plex Mono für die Zahlen (sonst Courier)
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
    pdf.setDrawColor(29, 29, 31);
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
    pdf.setTextColor(29, 29, 31);
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
    pdf.setTextColor(29, 29, 31);
    if (letzteAdresse) {
      const zeilen = pdf.splitTextToSize(letzteAdresse, KOPF_B);
      pdf.text(zeilen, x, y);
      y += zeilen.length * 4.6 + 2;
    }
    pdf.setFont(PDF_MONO, 'normal');
    pdf.text(deutsch(letzterPunkt.lat, 5) + '° N   ' + deutsch(letzterPunkt.lng, 5) + '° O', x, y);
    y += 12;

    // Abschnitt: 15-Minuten-Bewertung (große Zahl in Akzentfarbe)
    if (letzteBewertung) {
      const b = letzteBewertung;
      y = abschnitt(pdf, '01   15-Minuten-Bewertung', x, xr, y);
      y += 6;
      pdf.setFont(PDF_MONO, 'bold');
      pdf.setFontSize(26);
      pdf.setTextColor.apply(pdf, hexZuRgb(einstellungen.farbe));
      pdf.text(b.punkte + '/' + b.maximum, x, y);
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(12);
      pdf.setTextColor(29, 29, 31);
      pdf.text(b.stufe, x + 34, y - 4.5);
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(10);
      pdf.text(b.prozent + ' % der möglichen Punkte', x + 34, y);
      y += 8;
      const erklaerung = pdf.splitTextToSize(
        'Je Kategorie 2 Punkte, wenn mindestens ein Ziel im inneren Kreis (' +
        deutsch(einstellungen.radiusInnen, 0) + ' m) liegt, 1 Punkt im äußeren Kreis (' +
        deutsch(einstellungen.radiusAussen, 0) + ' m).' +
        (b.fehlend.length ? ' Nicht im inneren Kreis: ' + b.fehlend.join(', ') + '.' : ''), KOPF_B);
      grauerText(pdf, '', x, y, false);   // setzt Schrift klein + grau
      pdf.text(erklaerung, x, y);
      y += erklaerung.length * 3.6 + 10;
    }

    // Abschnitt: Infrastruktur (Anzahlen aus der Bewertung)
    y = abschnitt(pdf, '02   Infrastruktur', x, xr, y);
    const spalten2 = [x, x + 66, xr];
    tabellenKopf(pdf, ['Kategorie',
      'bis ' + deutsch(einstellungen.radiusInnen, 0) + ' m',
      'bis ' + deutsch(einstellungen.radiusAussen, 0) + ' m'], spalten2, y);
    y += 6;
    KATEGORIEN.forEach(function (kat, i) {
      const d = letzteBewertung ? letzteBewertung.details[i] : null;
      pdfSymbol(pdf, kat, x + 1.6, y - 1.2);   // farbiges Symbol vor dem Namen
      tabellenZeile(pdf, [
        '      ' + kat.name,
        d ? String(d.innen) : '–',
        d ? String(d.aussen) : '–'
      ], spalten2, x, xr, y, true);
      y += 7;
    });
    grauerText(pdf, 'Parks zählen, wenn ihr Rand im Radius liegt.', x, y, false);
    y += 14;

    // Abschnitt: Einzugsbereiche (gleiche Rechnung wie im Panel)
    y = abschnitt(pdf, '03   Einzugsbereiche', x, xr, y);
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

    // 5) Fußzeile unten im Plankopf: Datum + Quellen (Lizenzpflicht!)
    let yu = BLATT_H - RAND - 14;
    pdf.setDrawColor(29, 29, 31);
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

// IBM Plex Mono für Zahlen im PDF. Die TTF-Dateien werden beim ersten
// PDF-Export aus dem Internet geladen (jsDelivr, Lizenz: SIL OFL 1.1).
// Klappt das nicht, bleibt es bei der eingebauten Schrift "courier".
let PDF_MONO = 'courier';
const PLEX_URL = 'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/ibmplexmono/';
let plexDaten = null;   // zwischengespeichert: { normal: base64, bold: base64 }

async function ladePdfSchrift(pdf) {
  try {
    if (!plexDaten) {
      const laden = async function (datei) {
        const antwort = await fetch(PLEX_URL + datei);
        if (!antwort.ok) throw new Error(datei);
        const bytes = new Uint8Array(await antwort.arrayBuffer());
        let text = '';
        for (let i = 0; i < bytes.length; i += 8192) {
          text += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
        }
        return btoa(text);   // jsPDF erwartet die Schrift als Base64-Text
      };
      plexDaten = { normal: await laden('IBMPlexMono-Regular.ttf'), bold: await laden('IBMPlexMono-Medium.ttf') };
    }
    pdf.addFileToVFS('PlexMono-Regular.ttf', plexDaten.normal);
    pdf.addFont('PlexMono-Regular.ttf', 'PlexMono', 'normal');
    pdf.addFileToVFS('PlexMono-Medium.ttf', plexDaten.bold);
    pdf.addFont('PlexMono-Medium.ttf', 'PlexMono', 'bold');
    PDF_MONO = 'PlexMono';
  } catch (fehler) {
    PDF_MONO = 'courier';
  }
}

// Farbiges Symbol einer Kategorie ins PDF zeichnen (Mitte bei cx, cy; in mm)
function pdfSymbol(pdf, kat, cx, cy) {
  pdf.setFillColor.apply(pdf, hexZuRgb(kat.farbe));
  pdf.setDrawColor.apply(pdf, hexZuRgb(kat.kontur));
  pdf.setLineWidth(0.25);
  const r = 1.6;
  if (kat.form === 'kreis') pdf.circle(cx, cy, r, 'FD');
  if (kat.form === 'quadrat') pdf.rect(cx - r, cy - r, 2 * r, 2 * r, 'FD');
  if (kat.form === 'dreieck') pdf.triangle(cx, cy - r - 0.2, cx + r + 0.2, cy + r, cx - r - 0.2, cy + r, 'FD');
  if (kat.form === 'flaeche') pdf.rect(cx - r - 0.5, cy - r + 0.3, 2 * r + 1, 2 * r - 0.6, 'FD');
}

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
  pdf.setTextColor(110, 110, 115);
  pdf.text(text, x, y, versalien === false ? {} : { charSpace: 0.6 });
}

// Abschnitts-Überschrift mit schwarzer Linie darunter; gibt neue y-Position zurück
function abschnitt(pdf, titel, x, xr, y) {
  grauerText(pdf, titel.toUpperCase(), x, y);
  pdf.setDrawColor(29, 29, 31);
  pdf.setLineWidth(0.3);
  pdf.line(x, y + 2.5, xr, y + 2.5);
  return y + 8;
}

// Tabellenkopf: erste Spalte links-, alle anderen rechtsbündig
function tabellenKopf(pdf, texte, spalten, y) {
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8);
  pdf.setTextColor(110, 110, 115);
  texte.forEach(function (text, i) {
    pdf.text(text, spalten[i], y, i === 0 ? {} : { align: 'right' });
  });
}

// Tabellenzeile in Monospace + feine graue Linie darunter
//   ersteSpalteNormal: true = erste Spalte in normaler Schrift (z. B. Kategorie-Name)
function tabellenZeile(pdf, texte, spalten, x, xr, y, ersteSpalteNormal) {
  pdf.setFontSize(10);
  pdf.setTextColor(29, 29, 31);
  texte.forEach(function (text, i) {
    pdf.setFont(i === 0 && ersteSpalteNormal ? 'helvetica' : PDF_MONO, 'normal');
    pdf.text(String(text), spalten[i], y, i === 0 ? {} : { align: 'right' });
  });
  pdf.setDrawColor(229, 229, 234);
  pdf.setLineWidth(0.2);
  pdf.line(x, y + 2.5, xr, y + 2.5);
}

// Zahl aus dem Panel holen; "…" (lädt noch) oder "–" werden zu "–"
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
      'name TEXT, lat REAL, lon REAL, ost_m REAL, nord_m REAL, ' +
      'punkte INTEGER, punkte_max INTEGER, prozent INTEGER, bewertung TEXT');
    fuegeEin(db, 'standort', wkbPunkt(mitte), {
      name: letzteAdresse || '',
      lat: runde(letzterPunkt.lat, 6), lon: runde(letzterPunkt.lng, 6),
      ost_m: runde(mitte[0], 1), nord_m: runde(mitte[1], 1),
      // 15-Minuten-Bewertung (leer, wenn außerhalb des Datengebiets)
      punkte: letzteBewertung ? letzteBewertung.punkte : null,
      punkte_max: letzteBewertung ? letzteBewertung.maximum : null,
      prozent: letzteBewertung ? letzteBewertung.prozent : null,
      bewertung: letzteBewertung ? letzteBewertung.stufe : null
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

  // Legende an die Radien anpassen
  document.getElementById('legende-innen').textContent = deutsch(e.radiusInnen, 0) + ' m';
  document.getElementById('legende-aussen').textContent = deutsch(e.radiusAussen, 0) + ' m';
  document.getElementById('legende-innen-min').textContent = '≈ ' + deutsch(e.radiusInnen / GEHTEMPO_M_PRO_MIN, 0) + ' Min.';
  document.getElementById('legende-aussen-min').textContent = '≈ ' + deutsch(e.radiusAussen / GEHTEMPO_M_PRO_MIN, 0) + ' Min.';

  // Bedienelemente auf die aktuellen Werte setzen
  document.getElementById('farbe-frei').value = e.farbe.toLowerCase();
  document.querySelectorAll('.farbfeld').forEach(function (feld) {
    feld.classList.toggle('aktiv', feld.dataset.farbe.toLowerCase() === e.farbe.toLowerCase());
  });
  document.querySelectorAll('.stil-knopf').forEach(function (knopf) {
    const an = knopf.dataset.stil === e.kartenstil;
    knopf.classList.toggle('aktiv', an);
    knopf.setAttribute('aria-checked', an ? 'true' : 'false');
  });
  document.getElementById('deckkraft').value = Math.round(e.deckkraft * 100);
  document.getElementById('deckkraft-wert').textContent = Math.round(e.deckkraft * 100) + ' %';
  document.getElementById('radius-innen').value = e.radiusInnen;
  document.getElementById('radius-aussen').value = e.radiusAussen;
  // Gehzeit neben den Radien (mit Umwegfaktor, wie im Zeitstrahl)
  document.getElementById('radius-innen-min').textContent = '≈ ' + deutsch(e.radiusInnen * UMWEGFAKTOR / GEHTEMPO_M_PRO_MIN, 1) + ' Min.';
  document.getElementById('radius-aussen-min').textContent = '≈ ' + deutsch(e.radiusAussen * UMWEGFAKTOR / GEHTEMPO_M_PRO_MIN, 1) + ' Min.';

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

// Kartenstil: drei Knöpfe nebeneinander (wie ein Umschalter bei Apple)
document.querySelectorAll('.stil-knopf').forEach(function (knopf) {
  knopf.addEventListener('click', function () { aendere({ kartenstil: knopf.dataset.stil }); });
});

// Darstellungs-Fenster öffnen / schließen
const darstellungFenster = document.getElementById('darstellung');
const darstellungKnopf = document.getElementById('darstellung-knopf');
function zeigeDarstellung(offen) {
  darstellungFenster.hidden = !offen;
  darstellungKnopf.setAttribute('aria-expanded', offen ? 'true' : 'false');
}
darstellungKnopf.addEventListener('click', function () { zeigeDarstellung(darstellungFenster.hidden); });
document.getElementById('darstellung-zu').addEventListener('click', function () { zeigeDarstellung(false); });
// Esc-Taste oder Klick daneben schließt das Fenster
document.addEventListener('keydown', function (event) {
  if (event.key === 'Escape') zeigeDarstellung(false);
});
document.addEventListener('pointerdown', function (event) {
  if (darstellungFenster.hidden) return;
  if (darstellungFenster.contains(event.target) || darstellungKnopf.contains(event.target)) return;
  zeigeDarstellung(false);
});

// Plus/Minus-Knöpfe bei den Radien (50-m-Schritte)
document.querySelectorAll('.stepper-knopf').forEach(function (knopf) {
  knopf.addEventListener('click', function () {
    const feld = document.getElementById(knopf.dataset.ziel);
    feld.value = Math.min(1500, Math.max(100, Number(feld.value) + Number(knopf.dataset.schritt)));
    radienGeaendert();
  });
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

  // Gibt es schon einen Standort? Dann neu analysieren (neue Kreise, neue Zählung).
  // Kurz warten, falls mehrmals schnell auf +/− geklickt wird.
  if (heatAn) zeigeHeatmap();   // Versorgungskarte mit neuen Radien
  clearTimeout(radienTimer);
  if (letzterPunkt) radienTimer = setTimeout(function () { analysiereStandort(letzterPunkt); }, 350);
}
let radienTimer = null;
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

// ------------------------------------------------------------
// Versorgungskarte (Heatmap): die 15-Minuten-Bewertung für ganz
// Oldenburg + Umland – nicht nur für einen Punkt.
//
// So funktioniert es:
//   1. Das Datengebiet wird in ein Raster aus 50-m-Feldern geteilt.
//   2. Um jedes Ziel (Haltestelle, Supermarkt …) werden alle Felder im
//      inneren Kreis mit "2 Punkten", im äußeren mit "1 Punkt" markiert.
//      (Gleiche Regel wie bei der Bewertung im Panel.)
//   3. Pro Feld werden die Punkte der 4 Kategorien addiert (0–8) und
//      als Farbe gemalt: rot = schwach, grün = sehr gut versorgt.
// ------------------------------------------------------------
const HEAT_RASTER = 50;   // Meter pro Rasterfeld
// Farben für 1–8 Punkte (Apple-Systemfarben von Rot über Gelb zu Grün)
const HEAT_FARBEN = [null,
  [255, 59, 48], [255, 100, 40], [255, 149, 0], [255, 179, 0],
  [255, 204, 0], [190, 210, 60], [110, 200, 80], [52, 199, 89]];

// Eigene Ebene unter den Kreisen, damit diese oben bleiben
map.createPane('heatmap');
map.getPane('heatmap').style.zIndex = 350;
map.getPane('heatmap').style.pointerEvents = 'none';

let heatEbene = null;
let heatAn = false;

function berechneHeatmap() {
  const g = OSM_DATEN.gebiet;                      // [West, Süd, Ost, Nord]
  const breiteMitte = (g[1] + g[3]) / 2 * Math.PI / 180;
  const mY = 111320;                                // Meter pro Grad Breite
  const mX = 111320 * Math.cos(breiteMitte);        // Meter pro Grad Länge
  const R = HEAT_RASTER;
  const spalten = Math.ceil((g[2] - g[0]) * mX / R);
  const zeilen = Math.ceil((g[3] - g[1]) * mY / R);
  const rI = einstellungen.radiusInnen, rA = einstellungen.radiusAussen;
  const rI2 = rI * rI, rA2 = rA * rA;

  // Für jede Kategorie ein Feld mit 0, 1 oder 2 Punkten pro Rasterfeld
  const punkte = {};
  KATEGORIEN.forEach(function (k) { punkte[k.id] = new Uint8Array(spalten * zeilen); });

  // Umrechnung Grad → Meter (x nach Osten, y nach Süden; Zeile 0 = Norden)
  const zuX = function (lng) { return (lng - g[0]) * mX; };
  const zuY = function (lat) { return (g[3] - lat) * mY; };

  // Alle Felder um einen Punkt (x, y) markieren
  function markiere(feld, x, y) {
    const c0 = Math.max(0, Math.floor((x - rA) / R)), c1 = Math.min(spalten - 1, Math.floor((x + rA) / R));
    const z0 = Math.max(0, Math.floor((y - rA) / R)), z1 = Math.min(zeilen - 1, Math.floor((y + rA) / R));
    for (let z = z0; z <= z1; z++) {
      const dy = (z + 0.5) * R - y;
      for (let c = c0; c <= c1; c++) {
        const dx = (c + 0.5) * R - x;
        const d2 = dx * dx + dy * dy;
        if (d2 > rA2) continue;
        const wert = d2 <= rI2 ? 2 : 1;
        const i = z * spalten + c;
        if (wert > feld[i]) feld[i] = wert;
      }
    }
  }

  OSM_DATEN.features.forEach(function (ort) {
    const feld = punkte[ort.properties.kat];
    const geo = ort.geometry;
    if (geo.type === 'Point') {
      markiere(feld, zuX(geo.coordinates[0]), zuY(geo.coordinates[1]));
      return;
    }
    // Parks: vom Rand aus messen (Ecken des Umrisses) …
    const polygone = geo.type === 'Polygon' ? [geo.coordinates] : geo.coordinates;
    polygone.forEach(function (polygon) {
      let lx = null, ly = null, minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      polygon[0].forEach(function (ecke) {
        const x = zuX(ecke[0]), y = zuY(ecke[1]);
        minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        // dicht beieinander liegende Ecken überspringen (spart Rechenzeit)
        if (lx === null || (x - lx) * (x - lx) + (y - ly) * (y - ly) > R * R / 4) {
          markiere(feld, x, y);
          lx = x; ly = y;
        }
      });
      // … und Felder im Park selbst zählen voll (2 Punkte)
      for (let z = Math.max(0, Math.floor(minY / R)); z <= Math.min(zeilen - 1, Math.floor(maxY / R)); z++) {
        for (let c = Math.max(0, Math.floor(minX / R)); c <= Math.min(spalten - 1, Math.floor(maxX / R)); c++) {
          const mitte = { lng: g[0] + (c + 0.5) * R / mX, lat: g[3] - (z + 0.5) * R / mY };
          if (punktInPolygon(mitte, polygon)) feld[z * spalten + c] = 2;
        }
      }
    });
  });

  // Malen: ein Pixel pro Rasterfeld, Farbe nach Summe der Punkte
  const leinwand = document.createElement('canvas');
  leinwand.width = spalten;
  leinwand.height = zeilen;
  const ctx = leinwand.getContext('2d');
  const bild = ctx.createImageData(spalten, zeilen);
  const statistik = new Array(9).fill(0);
  for (let i = 0; i < spalten * zeilen; i++) {
    let summe = 0;
    KATEGORIEN.forEach(function (k) { summe += punkte[k.id][i]; });
    statistik[summe]++;
    if (summe === 0) continue;   // gar nichts erreichbar → durchsichtig
    const f = HEAT_FARBEN[summe];
    bild.data[i * 4] = f[0]; bild.data[i * 4 + 1] = f[1]; bild.data[i * 4 + 2] = f[2];
    // je besser versorgt, desto kräftiger (schwache Flächen bleiben zurückhaltend)
    bild.data[i * 4 + 3] = Math.round(255 * (0.3 + 0.7 * summe / 8));
  }
  ctx.putImageData(bild, 0, 0);

  return {
    url: leinwand.toDataURL(),
    // Grenzen des Bildes (das Raster ist minimal größer als das Datengebiet)
    grenzen: [[g[3] - zeilen * R / mY, g[0]], [g[3], g[0] + spalten * R / mX]],
    statistik: statistik
  };
}

function zeigeHeatmap() {
  if (heatEbene) { map.removeLayer(heatEbene); heatEbene = null; }
  if (!heatAn || !window.OSM_DATEN) return;
  const ergebnis = berechneHeatmap();
  heatEbene = L.imageOverlay(ergebnis.url, ergebnis.grenzen, {
    pane: 'heatmap', opacity: 0.6, className: 'heatmap', interactive: false
  }).addTo(map);
}

function schalteHeatmap() {
  heatAn = !heatAn;
  heatKnopf.classList.toggle('aktiv', heatAn);
  heatKnopf.setAttribute('aria-pressed', heatAn ? 'true' : 'false');
  document.getElementById('legende-heat').hidden = !heatAn;
  if (heatAn) {
    heatKnopf.classList.add('rechnet');
    // kurz warten, damit der Knopf schon reagiert, bevor gerechnet wird
    setTimeout(function () {
      zeigeHeatmap();
      heatKnopf.classList.remove('rechnet');
      // Nur wer sehr nah dran ist (Straßen-Ebene), wird eine Stufe
      // herausgezoomt – sonst bleibt der Ausschnitt, wie er ist
      if (map.getZoom() >= 16) map.setZoom(map.getZoom() - 1);
    }, 30);
  } else {
    zeigeHeatmap();
  }
}

// Knopf "Versorgungskarte" auf der Karte (oben links, unter dem Zoom)
let heatKnopf = null;
const HeatSteuerung = L.Control.extend({
  options: { position: 'topleft' },
  onAdd: function () {
    heatKnopf = L.DomUtil.create('button', 'heat-knopf');
    heatKnopf.type = 'button';
    heatKnopf.title = '15-Minuten-Bewertung für ganz Oldenburg einblenden';
    heatKnopf.setAttribute('aria-pressed', 'false');
    heatKnopf.innerHTML = '<span class="heat-symbol" aria-hidden="true"></span><span>Versorgungskarte</span>';
    L.DomEvent.disableClickPropagation(heatKnopf);
    L.DomEvent.on(heatKnopf, 'click', schalteHeatmap);
    return heatKnopf;
  }
});
new HeatSteuerung().addTo(map);

// Beim Laden der Seite einmal anwenden (gespeicherte Einstellungen)
wendeDarstellungAn();
