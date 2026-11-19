# Übergabe für den nächsten Chat (Stand: Do 19.11.2026, morgens)

Diese Datei fasst zusammen, wo das Projekt steht, damit ein neuer Chat direkt weiterarbeiten kann.
**Bitte zuerst lesen:** `CLAUDE.md` (Regeln), dann diese Datei, dann bei Bedarf `PLAN.md` (ausführliche Chronik aller Schritte).

---

## 1. Was das Projekt ist
„**Stadt in 15 Minuten**“ – ein 15-Minuten-Stadt-Scanner für die Standortanalyse (Architekturstudium, Jade Hochschule, WPK „Vibecoding“).
Klick auf die Karte oder Adresssuche → die App bewertet, was zu Fuß in 400 m / 800 m erreichbar ist.

- **Live:** https://jade-hs-vibecoding-wpk.github.io/15-min-stadt-scanner/
- **Repository:** https://github.com/Jade-HS-Vibecoding-WPK/15-min-stadt-scanner (Branch `main`)
- **Datengebiet:** Oldenburg + Umland (Bounding Box 7,95–8,45 °O / 52,98–53,30 °N)

## 2. Termine (aus PLAN.md)
- **Do 19.11., 18 Uhr: Freeze** (danach nur noch Bugfixes)
- **Fr 20.11., 16 Uhr: Abgabe** – **README schreiben** und **Poster gestalten** sind noch offen.

## 3. Wer der Nutzer ist & wie wir arbeiten
- Architekturstudent im 5. Semester, **kann nicht programmieren** → alles auf Deutsch, einfach erklären.
- **Ein kleines Feature pro Schritt, dann testen.** Nach jedem fertigen Feature: Commit anbieten.
- **Commits** macht Claude (nur wenn der Nutzer zustimmt) mit kurzer deutscher Nachricht und der Zeile
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Push** macht der Nutzer selbst in **GitHub Desktop** („Push origin“). Danach prüft Claude die Live-Seite
  (Dateien per `curl` mit lokalen vergleichen, `shasum`).
- **Versionsnummer hochzählen** bei jeder Änderung, die online geht: `?v=2026-11-18f` in `index.html` (2×: style.css, script.js, + oldenburg-osm.js)
  und in `script.js` beim Nachladen von `daten/oldenburg-wege.js`. Sonst zeigen Handys (Safari) die alte Version.
- Der Nutzer probiert viel auf dem **Handy** aus.

## 4. Dateien
| Datei | Inhalt |
|---|---|
| `index.html` | Aufbau: Karte (`#karte-bereich`), Panel (`#panel`), Fenster „Darstellung“ und „Variantenvergleich“ |
| `style.css` | Gestaltung (ca. 1.450 Zeilen, nummerierte Abschnitte; Handy ab Abschnitt 14 `@media (max-width: 700px)`) |
| `script.js` | gesamte Logik (ca. 2.770 Zeilen, ausführlich deutsch kommentiert) |
| `daten/oldenburg-osm.js` | 3.910 Orte (`window.OSM_DATEN`), 7 Kategorien, mit `typ` und `linien` |
| `daten/oldenburg-wege.js` | Fußwegenetz (`window.WEGE_NETZ`, 158.499 Knoten), wird im Hintergrund nachgeladen |
| `fonts/` | Inter + IBM Plex Mono (selbst gehostet, SIL OFL) |
| `werkzeuge/` | Skripte, mit denen die Daten aus dem Geofabrik-Auszug gebaut wurden (siehe `werkzeuge/LIESMICH.md`) |
| `PLAN.md` | Plan + ausführliche Chronik aller umgesetzten Funktionen |

## 5. Was die App kann (Stand jetzt, alles online)
- **Glas-Look** (Apple „Frosted Glass“), **Apple-Systemfarben** (Akzent #007AFF), Schriften Inter + IBM Plex Mono, weiche Animationen.
- **Profile:** Alltag / Familie / Senioren / Studierende (je 4–5 Kategorien, je 2 Punkte).
- **01 Bewertung:** Ring mit Punktzahl (als Bruch), „Aufschlüsselung“ → je Kategorie Punkte, Anzahl innen·außen, nächstes Ziel;
  Klick auf Kategorie → Liste aller Orte (Art, Entfernung, Gehzeit, Haltepunkte, Buslinien wo in OSM vorhanden).
- **02 Erreichbarkeit zu Fuß:** Zeitstrahl 0–15 Min.
- **Echte Fußwege** (Standard) statt Luftlinie: Dijkstra auf dem OSM-Wegenetz; Karte zeigt erreichbares Wegenetz;
  Knopf „Fußwege / Luftlinie“ auf der Karte.
- **Versorgungskarte** (Heatmap, vereinfacht mit Luftlinie) für das Datengebiet.
- **Variantenvergleich:** bis 3 Standorte (A/B/C), Glas-Fenster mit Tabelle + Fazit-Satz.
- **Darstellung anpassen** (Glas-Fenster): Kartenstil, Akzentfarbe, Füllung, Radien (−/+).
- **Sprache DE / EN** (Umschalter oben im Panel; Texte: `data-en` im HTML, `tx('de','en')` im JS).
- **Exporte:** PNG, PDF A3 (Planblatt), GeoPackage für QGIS (EPSG:25832).
- **Handy:** Panel als Blatt unten mit Griff (wischen/tippen), Kartenknöpfe als Leiste oben, große Tippflächen.
- **Mauszeiger** im iPad-Stil; Kartenknöpfe am Desktop eingeklappt, fahren beim Darüberfahren aus.
- Titel: „Stadt in 15 Minuten“ (EN „City in 15 Minutes“).

## 6. Wichtige Entscheidungen (bewusst so)
- Gestaltung weicht von `CLAUDE.md` ab (Nutzer hat Glas-Look + Apple-Farben gewählt) – CLAUDE.md-Palette gilt nicht mehr.
- Basemap: OSM-Standardkacheln mit CSS-Graufilter (CARTO bräuchte API-Key).
- Overpass war überlastet → Daten einmalig aus Geofabrik-Auszug (Niedersachsen, Stand 16.11.2026), mitgeliefert.
- **Erweiterung auf ganz Niedersachsen + Bremen** wurde am 18.11. gebaut, aber auf Wunsch des Nutzers **verworfen** (nicht committet).
  Skripte dafür liegen in `werkzeuge/` (`extrahiere-nds.sh`, `kacheln.py`), falls es doch noch gewünscht wird.

## 7. So testet Claude (bewährt)
- Der Desktop-Ordner ist für den Vorschau-Server nicht lesbar → Projekt in den Scratchpad kopieren
  (`index.html script.js style.css daten fonts`) und mit `python3 -I werkzeuge/server.py <ordner> <ausgabeordner>` auf
  `http://127.0.0.1:8765/` bereitstellen (POST-Anfragen landen als Datei im Ausgabeordner → so PDF/PNG prüfen).
- Wenn der Browser-Bereich **ausgeblendet** ist, laufen keine Animationen und die Fenstergröße ist 0 × 0:
  vorher `resize_window` setzen; in der Testkopie Animationen per CSS abschalten und `requestAnimationFrame` durch `setTimeout` ersetzen.
- Daten-Dateien beim Testen mit `?v=…` laden, sonst nimmt der Browser alte Versionen aus dem Zwischenspeicher.
- PDF-Vorschau: `qlmanage -t -s 1400 -o . planblatt.pdf`; GeoPackage prüfen mit QGIS-`ogrinfo`
  (`/Applications/QGIS.app/Contents/MacOS/ogrinfo`, dazu `GDAL_DATA`/`PROJ_DATA` aus `Contents/Resources/qgis`).

## 8. Nächste Schritte
1. **README.md** schreiben (für die Abgabe): Projektidee, Funktionen, Bedienung, Datenquellen + Lizenzen
   (OSM/ODbL, Geofabrik, Inter/IBM Plex Mono OFL, Leaflet, html-to-image, jsPDF, sql.js, proj4), Methodik
   (Punktesystem, Fußwege/Dijkstra, Gehtempo 4,8 km/h, Umwegfaktor 1,3 bei Luftlinie), Grenzen, Screenshots.
2. **Poster** (Idee: Versorgungskarte + Varianten A/B/C als PDF-Export, Profile im Vergleich).
3. Nach dem Freeze (18 Uhr) nur noch Fehler beheben.
