"""Wandelt oldenburg.geojson in daten/oldenburg-osm.js um (für den Scanner).
Aufruf: python3 -I zu_js.py <eingabe.geojson> <ausgabe.js> <datenstand>"""
import json, sys
from collections import Counter

ein, aus, stand = sys.argv[1], sys.argv[2], sys.argv[3]
daten = json.load(open(ein, encoding='utf-8'))

features = []
for f in daten['features']:
    p = f['properties']
    if f['geometry'] is None:
        continue
    eig = {'kat': p['kat'], 'osm_id': p['osm_id']}
    if p.get('name'):
        eig['name'] = p['name']
    if p.get('typ'):
        eig['typ'] = p['typ']          # Art: bakery, school, bus_stop …
    if p.get('linien'):
        eig['linien'] = p['linien']    # Buslinien (route_ref), z. B. "271;272"
    features.append({'type': 'Feature', 'properties': eig, 'geometry': f['geometry']})

kopf = (
    "// OpenStreetMap-Auszug für Oldenburg und Umgebung\n"
    "// Haltestellen, Supermärkte & Bäcker, Kitas & Schulen, Parks,\n// Ärzte & Apotheken, Spielplätze, Cafés & Kultur\n"
    "// Quelle: © OpenStreetMap-Mitwirkende, Lizenz ODbL 1.0\n"
    "//         (openstreetmap.org/copyright), Extrakt von Geofabrik\n"
    f"// Datenstand: {stand}\n"
    "// Diese Datei wurde automatisch erzeugt – nicht von Hand ändern.\n"
)
inhalt = {
    'datenstand': stand,
    'gebiet': [7.95, 52.98, 8.45, 53.30],   # West, Süd, Ost, Nord
    'features': features,
}
with open(aus, 'w', encoding='utf-8') as f:
    f.write(kopf)
    f.write('window.OSM_DATEN = ')
    json.dump(inhalt, f, ensure_ascii=False, separators=(',', ':'))
    f.write(';\n')

print(len(features), 'Orte', dict(Counter(x['properties']['kat'] for x in features)))
