// ============================================================
// 15-Minuten-Stadt-Scanner
// ============================================================

// Akzentfarbe (gleich wie in style.css)
const ACCENT = '#FF4F00';
const INK = '#111111';

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
  maxZoom: 19
}).addTo(map);

// 3) Eine "Ebene" (wie ein Layer in CAD), in die wir Marker + Kreise legen.
//    So können wir beim nächsten Klick alles auf einmal löschen.
const analyse = L.layerGroup().addTo(map);

// 4) Beim Klick auf die Karte: Standort an der angeklickten Stelle analysieren
map.on('click', function (event) {
  document.getElementById('suche-status').textContent = '';
  analysiereStandort(event.latlng);
});

// 5) Kern-Funktion: zeichnet Marker + Kreise und füllt das Panel.
//    Wird vom Klick UND von der Adresssuche benutzt.
function analysiereStandort(punkt) {
  // Alte Kreise und alten Marker entfernen
  analyse.clearLayers();

  // 800-m-Kreis (ca. 10 Min. zu Fuß): gestrichelte Linie, keine Füllung
  const kreis800 = L.circle(punkt, {
    radius: 800,
    color: ACCENT,
    weight: 1.5,
    dashArray: '6 6',
    fill: false
  }).addTo(analyse);

  // 400-m-Kreis (ca. 5 Min. zu Fuß): Linie + leichte Füllung
  L.circle(punkt, {
    radius: 400,
    color: ACCENT,
    weight: 1.5,
    fillColor: ACCENT,
    fillOpacity: 0.1
  }).addTo(analyse);

  // Standort-Marker: kleiner orangefarbener Punkt mit schwarzem Rand
  standortMarker = L.circleMarker(punkt, {
    radius: 6,
    color: INK,
    weight: 1.5,
    fillColor: ACCENT,
    fillOpacity: 1
  }).addTo(analyse);

  // Karte so zoomen, dass der große Kreis ganz zu sehen ist
  map.fitBounds(kreis800.getBounds(), { padding: [40, 40] });

  // Kennzahlen im Side-Panel aktualisieren
  zeigeKennzahlen(punkt);

  // Echte Infrastruktur-Daten aus OpenStreetMap nachladen
  ladeOepnv(punkt);
}

// ------------------------------------------------------------
// Infrastruktur: ÖPNV-Haltepunkte über die Overpass-API laden
// ------------------------------------------------------------
let standortMarker = null;   // damit der Standort-Punkt oben bleibt
let anfrageNummer = 0;       // zählt Anfragen mit (siehe unten)

async function ladeOepnv(punkt) {
  // Jede Analyse bekommt eine Nummer. Klickt man schnell zweimal,
  // kommt die alte Antwort evtl. später an – die ignorieren wir dann.
  const meineNummer = ++anfrageNummer;

  const zelle400 = document.getElementById('oepnv-400');
  const zelle800 = document.getElementById('oepnv-800');
  const status = document.getElementById('infra-status');
  zelle400.textContent = '…';
  zelle800.textContent = '…';
  status.textContent = 'Lade Daten aus OpenStreetMap …';

  // Abfrage in der Overpass-Sprache: alle Bus-, Tram- und Bahn-
  // Haltepunkte im Umkreis von 800 m um den Standort
  const umkreis = '(around:800,' + punkt.lat + ',' + punkt.lng + ')';
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

    let anzahl400 = 0;
    let anzahl800 = 0;

    daten.elements.forEach(function (element) {
      const ort = L.latLng(element.lat, element.lon);
      const entfernung = map.distance(punkt, ort); // Luftlinie in Metern

      if (entfernung <= 800) anzahl800++;
      if (entfernung <= 400) anzahl400++;

      // Punkt auf die Karte zeichnen (klein, schwarz)
      const kreis = L.circleMarker(ort, {
        radius: 3.5,
        stroke: false,
        fillColor: INK,
        fillOpacity: 1
      }).addTo(analyse);

      // Name beim Darüberfahren mit der Maus anzeigen
      const name = document.createElement('span');
      name.textContent = (element.tags && element.tags.name) || 'Haltepunkt';
      kreis.bindTooltip(name, { direction: 'top' });
    });

    zelle400.textContent = anzahl400;
    zelle800.textContent = anzahl800;
    status.textContent = '';
    if (standortMarker) standortMarker.bringToFront();
  } catch (fehler) {
    if (meineNummer !== anfrageNummer) return;
    zelle400.textContent = '–';
    zelle800.textContent = '–';
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
  const zeilen = [400, 800].map(function (radius) {
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
