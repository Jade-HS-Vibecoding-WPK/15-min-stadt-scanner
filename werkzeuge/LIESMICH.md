# Werkzeuge (Datenaufbereitung)

Mit diesen Skripten wurden die Daten in `daten/` aus dem OpenStreetMap-Auszug
**Niedersachsen von Geofabrik** (`niedersachsen.osm.pbf`, Stand 16.11.2026) erzeugt.
Für die App selbst werden sie nicht gebraucht.

| Datei | Zweck |
|---|---|
| `osmconf3.ini` | GDAL-Einstellung: welche OSM-Merkmale übernommen werden (u. a. `route_ref` für Buslinien) |
| `extrahiere3.sh` | schneidet Oldenburg + Umland aus und filtert die 7 Kategorien (GDAL aus QGIS) → GeoJSON |
| `zu_js.py` | wandelt das GeoJSON in `daten/oldenburg-osm.js` um |
| `netz.py` | baut aus den Wegen (GDAL-Ebene „lines“) das Fußwegenetz `daten/oldenburg-wege.js` |
| `extrahiere-nds.sh`, `kacheln.py` | Versuch für ganz Niedersachsen + Bremen in Kacheln (wurde nicht übernommen) |
| `server.py` | kleiner Test-Server (http://127.0.0.1:8765), speichert POST-Anfragen als Datei |

**Hinweis:** In den Skripten stehen noch die Pfade des Arbeitsordners, in dem sie entstanden sind
(`…/scratchpad/…`). Vor einer erneuten Nutzung die Pfade oben im Skript anpassen.
Benötigt: QGIS (für `ogr2ogr`), Python 3.
