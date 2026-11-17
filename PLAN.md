# Umsetzungsplan: 15-Minuten-Stadt-Scanner

## Funktionsumfang (MoSCoW)
### Must (Muss bis Donnerstag laufen)
- Vollbild-Karte (Startansicht z. B. Oldenburg) mit Adresssuche (Nominatim-API).
- Klick auf ein Grundstück setzt einen Marker und zeichnet zwei konzentrische Gehzeit-Radien: 400 m (ca. 5 Min.) und 800 m (ca. 10 Min.).
- Side-Panel mit den wichtigsten Kennzahlen (Koordinaten, Fläche der Radien, Luftlinien-Vergleich).
- Korrekte OpenStreetMap-Namensnennung.

### Should (Mittwoch – Echte Daten von außen)
- Anbindung der Overpass-API (OpenStreetMap): Automatisches Abfragen und Zählen von Infrastruktur im 400-m- und 800-m-Radius (ÖPNV-Haltestellen, Supermärkte/Bäcker, Parks/Grünflächen, Kitas/Schulen).
- Übersichtliche Balken- oder Kennzahlen-Auswertung im Side-Panel + Ein-/Ausblenden der Kategorien auf der Karte.

### Could (Wenn Donnerstag noch Zeit bleibt)
- Umschalter für „Schwarzplan-Modus“ (Gebäudegrundrisse stark kontrastiert).
- Export der aktuellen Kartenansicht inkl. Legende als PNG/SVG für das Entwurfsposter.

## Etappenplan
- [x] **Mo 16.11.:** Ordner, `CLAUDE.md` und `PLAN.md` stehen; erstes Grundgerüst (Karte + Klick-Radien) läuft lokal.
  - Hinweis: CartoDB Positron verlangt inzwischen einen API-Key → stattdessen OSM-Standardkacheln mit CSS-Graufilter.
  - Schon erledigt (vorgezogen): Side-Panel mit Koordinaten, Flächen und Luftlinien-Vergleich (Umwegfaktor 1,3; 4,8 km/h) sowie Adresssuche (Nominatim). **Must-Bereich komplett.**
  - Vorgezogen: Online auf GitHub Pages → https://jade-hs-vibecoding-wpk.github.io/15-min-stadt-scanner/ (Änderungen per „Add file → Upload files“ hochladen).
  - Vorgezogen (Could): PNG-Export der Kartenansicht inkl. Legende, Maßstabsleiste und OSM-Namensnennung (doppelte Auflösung).
  - Darstellung einstellbar (aufklappbar im Panel): Akzentfarbe, Kartenstil (hell-grau/farbig/dunkel), Füllung, Radien (100–1.500 m); wird im Browser gespeichert und in PNG/PDF/GeoPackage übernommen.
  - GeoPackage-Export für QGIS (ersetzt GeoJSON): 4 Ebenen – standort, einzugsbereiche, infrastruktur, parks – in ETRS89 / UTM 32N (EPSG:25832); mit QGIS-GDAL geprüft.
  - PDF-Export: Planblatt A3 quer (Karte + Plankopf mit Standort, Einzugsbereichen, ÖPNV-Zahlen, Datum, OSM-Quelle) via jsPDF.
  - Infrastruktur (Mi, vorgezogen): Overpass war den ganzen Tag überlastet → stattdessen OSM-Auszug von Geofabrik (Niedersachsen, Stand 16.11.2026) einmal heruntergeladen, Oldenburg + Umland ausgeschnitten und als `daten/oldenburg-osm.js` mitgeliefert (2.837 Orte). Kategorien: ÖPNV-Haltepunkte, Supermärkte & Bäcker, Kitas & Schulen, Parks. Zählung sofort, ohne Server. Gegenprobe: 37 Haltepunkte im 800-m-Kreis Innenstadt = gleiches Ergebnis wie Overpass.
  - 15-Minuten-Bewertung: je Kategorie 2 Punkte (Ziel im inneren Kreis) bzw. 1 Punkt (nur äußerer Kreis), max. 8 → Stufen sehr gut / gut / teilweise / schwach versorgt; im Panel, im PDF und im GeoPackage (Ebene standort).
  - Wettbewerbs-Look (Entscheidung 16.11.): Schriften Inter + IBM Plex Mono (im Ordner `fonts/`, SIL OFL); warmer Papiergrund #F3F1EC, Akzent Korall #E8836B; Kategorien in Pastell (ÖPNV Himmelblau, Versorgung Aprikose, Bildung Flieder, Parks Salbei) mit feiner Kontur; Abschnitte nummeriert 01/02/03 (auch im PDF, dort Zahlen in Plex Mono).
  - Layout überarbeitet („cleaner“): Ergebnis zuerst (Bewertung groß), dann Infrastruktur, dann Einzugsbereiche; eine Linienart; Suche nur mit Unterstrich; Export als Text-Knöpfe; Leaflet-Zoom/Tooltips/Namensnennung im gleichen Stil; PDF-Plankopf in derselben Reihenfolge.
  - Layout geordnet: Panel passt ohne Scrollen auf 1280×800 (Legende als Planlegende auf der Karte, Flächen + Fußweg in einer Tabelle, Hinweistext verschwindet nach der Analyse).
- [ ] **Di 17.11.:** UI-Design im Architektur-Layout polieren, Adresssuche einbauen, Radien-Darstellung verfeinern.
  - Glas-Look (Entscheidung 17.11., wie bei neuen Apple-Geräten / „Glassmorphism“ aus den Folien): Karte füllt das ganze Fenster; Panel, Legende, Zoom-Knöpfe, Suche und Export-Knöpfe schweben als mattiertes Glas darüber (Unschärfe, halbtransparent, feiner heller Rand, weicher Schatten, runde Ecken). Kreise werden im freien Kartenteil links vom Panel zentriert. PNG/PDF zeigen genau diesen freien Teil; beim Export wird die Unschärfe kurz ausgeschaltet. Auf dem Handy liegt das Panel als Blatt unten.
  - Apple-Farben + Frosted Glass (17.11.): Apple-Systemfarben statt Pastell – Hintergrund #F2F2F7, Text #1D1D1F, Akzent Systemblau #007AFF; Kategorien ÖPNV Teal #30B0C7, Versorgung Orange #FF9500, Bildung Lila #AF52DE, Parks Grün #34C759, Symbole mit weißem Rand wie in Apple Karten. Glas stärker mattiert (mehr Unschärfe, milchiger). Karte neutral-grau statt warm. Gilt auch für PNG/PDF.
  - Animationen wie bei Apple (17.11.): Panel/Legende gleiten beim Laden herein; nach Klick fliegt die Karte weich zum Standort, Kreise wachsen mit leichtem Nachfedern, Symbole ploppen wellenartig vom Standort nach außen auf, Panel-Abschnitte gleiten nacheinander herein, Bewertung zählt hoch; Knöpfe reagieren beim Drücken; „Darstellung“ klappt weich auf. Respektiert „Bewegung reduzieren“ im Betriebssystem. Export wartet, bis alle Animationen fertig sind.
  - Kreis-Animation flüssiger: erst schwenkt/zoomt die Karte (Leaflet-eigene Animation, 0,55 s), danach wachsen die Kreise und ploppen die Symbole auf. Vorher lief beides gleichzeitig mit „flyTo“ – Leaflet zeichnet Kreise während der Kamerafahrt nur gestreckt, daher das Haken.
- [ ] **Mi 18.11.:** Overpass-API anbinden (echte Infrastrukturdaten laden, zählen und filtern).
- [ ] **Do 19.11.:** Bugfixing, Export-Funktion (falls Zeit), auf GitHub hochladen & GitHub Pages aktivieren (Freeze bis 18 Uhr).
- [ ] **Fr 20.11.:** README schreiben lassen, Poster gestalten und bis 16 Uhr in der GitHub-Organisation abgeben.