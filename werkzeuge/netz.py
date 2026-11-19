"""Baut aus wege.geojson ein kompaktes Fußwegenetz für den Browser.
Aufruf: python3 -I netz.py <wege.geojson> <ausgabe.js> <datenstand>"""
import json, sys, math
ein, aus, stand = sys.argv[1], sys.argv[2], sys.argv[3]
d = json.load(open(ein))
LAT0 = 53.14
MX = 111320 * math.cos(math.radians(LAT0)); MY = 111320
def key(c): return (round(c[0] * 1e5), round(c[1] * 1e5))   # ~1 m Raster

linien = []
zaehl = {}
for f in d['features']:
    g = f['geometry']
    if not g or g['type'] != 'LineString': continue
    pts = [key(c) for c in g['coordinates']]
    # doppelte Folgepunkte entfernen
    p2 = [pts[0]] + [p for i, p in enumerate(pts[1:], 1) if p != pts[i - 1]]
    if len(p2) < 2: continue
    linien.append(p2)
    for i, p in enumerate(p2):
        w = 2 if i in (0, len(p2) - 1) else 1
        zaehl[p] = zaehl.get(p, 0) + w

def rdp(pts, tol):
    if len(pts) < 3: return pts
    (x1, y1), (x2, y2) = pts[0], pts[-1]
    ax, ay = (x2 - x1) * MX / 1e5, (y2 - y1) * MY / 1e5
    l2 = ax * ax + ay * ay
    best, idx = -1, 0
    for i in range(1, len(pts) - 1):
        px, py = (pts[i][0] - x1) * MX / 1e5, (pts[i][1] - y1) * MY / 1e5
        if l2 == 0: dist = math.hypot(px, py)
        else:
            t = max(0, min(1, (px * ax + py * ay) / l2))
            dist = math.hypot(px - t * ax, py - t * ay)
        if dist > best: best, idx = dist, i
    if best <= tol: return [pts[0], pts[-1]]
    return rdp(pts[:idx + 1], tol)[:-1] + rdp(pts[idx:], tol)

knoten = {}; nliste = []; kanten = set()
def kid(p):
    if p not in knoten:
        knoten[p] = len(nliste); nliste.append(p)
    return knoten[p]
for p2 in linien:
    # an Kreuzungen (Punkt in mehreren Wegen) aufteilen, dann vereinfachen
    stueck = [p2[0]]
    for p in p2[1:]:
        stueck.append(p)
        if zaehl.get(p, 0) >= 2 or p == p2[-1]:
            s = rdp(stueck, 2.5)
            for a, b in zip(s, s[1:]):
                ia, ib = kid(a), kid(b)
                if ia != ib: kanten.add((min(ia, ib), max(ia, ib)))
            stueck = [p]

# Koordinaten relativ zu einem Ursprung (kleinere Zahlen = kleinere Datei)
x0 = min(p[0] for p in nliste); y0 = min(p[1] for p in nliste)
koord = []
for p in nliste: koord += [p[0] - x0, p[1] - y0]
kl = []
for a, b in sorted(kanten): kl += [a, b]
kopf = ("// Fußwegenetz für Oldenburg und Umgebung (Straßen, Wege, Pfade)\n"
        "// Quelle: © OpenStreetMap-Mitwirkende, Lizenz ODbL 1.0, Extrakt von Geofabrik\n"
        f"// Datenstand: {stand} – automatisch erzeugt, nicht von Hand ändern.\n"
        "// knoten: [x, y, x, y, …] in 1/100000 Grad ab ursprung; kanten: [a, b, a, b, …]\n")
with open(aus, 'w') as f:
    f.write(kopf + 'window.WEGE_NETZ = ')
    json.dump({'datenstand': stand, 'ursprung': [x0, y0], 'knoten': koord, 'kanten': kl}, f, separators=(',', ':'))
    f.write(';\n')
print(len(nliste), 'Knoten', len(kanten), 'Kanten')
