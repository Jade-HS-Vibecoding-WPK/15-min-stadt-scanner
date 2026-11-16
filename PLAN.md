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
  - Darstellung einstellbar (aufklappbar im Panel): Akzentfarbe, Kartenstil (hell-grau/farbig/dunkel), Füllung, Radien (100–1.500 m); wird im Browser gespeichert und in PNG/PDF/GeoJSON übernommen.
  - GeoJSON-Export für QGIS: Standort, 400/800-m-Kreise (Flächen) und ÖPNV-Haltepunkte mit Attributen (WGS 84 / EPSG:4326); mit QGIS-GDAL geprüft.
  - PDF-Export: Planblatt A3 quer (Karte + Plankopf mit Standort, Einzugsbereichen, ÖPNV-Zahlen, Datum, OSM-Quelle) via jsPDF.
  - Begonnen (Mi): ÖPNV-Haltepunkte per Overpass inkl. automatischer Wiederholung – live noch ungetestet, da Overpass am 16.11. überlastet war.
  - Layout geordnet: Panel passt ohne Scrollen auf 1280×800 (Legende als Planlegende auf der Karte, Flächen + Fußweg in einer Tabelle, Hinweistext verschwindet nach der Analyse).
- [ ] **Di 17.11.:** UI-Design im Architektur-Layout polieren, Adresssuche einbauen, Radien-Darstellung verfeinern.
- [ ] **Mi 18.11.:** Overpass-API anbinden (echte Infrastrukturdaten laden, zählen und filtern).
- [ ] **Do 19.11.:** Bugfixing, Export-Funktion (falls Zeit), auf GitHub hochladen & GitHub Pages aktivieren (Freeze bis 18 Uhr).
- [ ] **Fr 20.11.:** README schreiben lassen, Poster gestalten und bis 16 Uhr in der GitHub-Organisation abgeben.