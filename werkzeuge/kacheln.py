"""Teilt Orte und Wegenetz für ganz Niedersachsen in Kacheln (0,1° × 0,1°).
Aufruf: python3 -I kacheln.py <nds-orte.geojson> <nds-wege.gpkg> <ausgabeordner> <datenstand>
Ausgabe:
  <aus>/index.json             – Liste der vorhandenen Kacheln
  <aus>/orte/<x>_<y>.json      – Orte (Haltestellen, Supermärkte …) der Kachel
  <aus>/wege/<x>_<y>.bin       – Fußwegenetz der Kachel (binär, kompakt)
Kachel-Nummer: x = floor(Länge*10), y = floor(Breite*10)."""
import json, sys, os, math, sqlite3, struct
from array import array

orte_datei, wege_datei, aus, stand = sys.argv[1:5]
os.makedirs(aus + '/orte', exist_ok=True); os.makedirs(aus + '/wege', exist_ok=True)

# ---------- Orte ----------
d = json.load(open(orte_datei))
orte = {}
def erster(c):
    while isinstance(c[0], list): c = c[0]
    return c
def runde(c):
    if isinstance(c[0], list): return [runde(x) for x in c]
    return [round(c[0], 6), round(c[1], 6)]
for f in d['features']:
    g = f['geometry']
    if not g: continue
    p = f['properties']
    eig = {'kat': p['kat'], 'osm_id': p['osm_id']}
    for k in ('name', 'typ', 'linien'):
        if p.get(k): eig[k] = p[k]
    c = erster(g['coordinates'])
    key = f"{math.floor(c[0]*10)}_{math.floor(c[1]*10)}"
    orte.setdefault(key, []).append({'type': 'Feature', 'properties': eig,
        'geometry': {'type': g['type'], 'coordinates': runde(g['coordinates'])}})
for key, liste in orte.items():
    with open(f'{aus}/orte/{key}.json', 'w') as fh:
        json.dump({'features': liste}, fh, ensure_ascii=False, separators=(',', ':'))
print(len(orte), 'Orts-Kacheln,', sum(len(v) for v in orte.values()), 'Orte')

# ---------- Wegenetz ----------
LAT0 = 52.6
MX = 111320 * math.cos(math.radians(LAT0)); MY = 111320
db = sqlite3.connect(wege_datei)
zeilen = db.execute("SELECT geom FROM wege WHERE highway NOT IN ('track','service','bridleway','road','corridor')")
def wkb_linie(blob):
    flags = blob[3]
    env = {0: 0, 1: 32, 2: 48, 3: 48, 4: 64}[(flags >> 1) & 7]
    o = 8 + env
    bo = '<' if blob[o] == 1 else '>'
    typ, n = struct.unpack_from(bo + 'II', blob, o + 1)
    if typ % 1000 != 2: return None
    werte = struct.unpack_from(bo + f'{2*n}d', blob, o + 9)
    return werte
linien = []; zaehl = {}
for (blob,) in zeilen:
    w = wkb_linie(blob)
    if not w: continue
    pts = array('i')
    lx = ly = None
    for i in range(0, len(w), 2):
        x = round(w[i] * 1e5); y = round(w[i+1] * 1e5)
        if x == lx and y == ly: continue
        pts.append(x); pts.append(y); lx, ly = x, y
    if len(pts) < 4: continue
    linien.append(pts)
    n = len(pts) // 2
    for i in range(n):
        k = pts[2*i] * 10000000 + pts[2*i+1]
        zaehl[k] = zaehl.get(k, 0) + (2 if i in (0, n - 1) else 1)
print(len(linien), 'Linien,', len(zaehl), 'Punkte gelesen')

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

kacheln = {}   # key -> {'knoten': {(x,y): idx}, 'liste': [], 'kanten': set()}
def kante(a, b):
    mx, my = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
    key = (math.floor(mx / 10000), math.floor(my / 10000))
    k = kacheln.get(key)
    if k is None: k = kacheln[key] = {'knoten': {}, 'liste': [], 'kanten': set()}
    def kid(p):
        i = k['knoten'].get(p)
        if i is None:
            i = k['knoten'][p] = len(k['liste']); k['liste'].append(p)
        return i
    ia, ib = kid(a), kid(b)
    if ia != ib: k['kanten'].add((min(ia, ib), max(ia, ib)))
def laenge(a, b): return math.hypot((a[0]-b[0]) * MX / 1e5, (a[1]-b[1]) * MY / 1e5)

for pts in linien:
    n = len(pts) // 2
    p2 = [(pts[2*i], pts[2*i+1]) for i in range(n)]
    stueck = [p2[0]]
    for p in p2[1:]:
        stueck.append(p)
        if zaehl.get(p[0] * 10000000 + p[1], 0) >= 2 or p == p2[-1]:
            s = rdp(stueck, 3.0)
            for a, b in zip(s, s[1:]):
                L = laenge(a, b)
                if L > 1500:   # lange Strecken teilen (kompakte Speicherung)
                    teile = math.ceil(L / 1500)
                    zw = [(round(a[0] + (b[0]-a[0]) * t / teile), round(a[1] + (b[1]-a[1]) * t / teile)) for t in range(teile + 1)]
                    for u, v in zip(zw, zw[1:]): kante(u, v)
                else:
                    kante(a, b)
            stueck = [p]

gesamt = 0; knoten_ges = 0; kanten_ges = 0
for (tx, ty), k in kacheln.items():
    cx, cy = tx * 10000 + 5000, ty * 10000 + 5000
    N, E = len(k['liste']), len(k['kanten'])
    gross = N > 65535
    buf = bytearray(struct.pack('<IIBxxx', N, E, 1 if gross else 0))
    xy = array('h')
    for (x, y) in k['liste']:
        dx, dy = x - cx, y - cy
        assert -32768 <= dx <= 32767 and -32768 <= dy <= 32767, (tx, ty, dx, dy)
        xy.append(dx); xy.append(dy)
    buf += xy.tobytes()
    ed = array('I' if gross else 'H')
    for a, b in sorted(k['kanten']): ed.append(a); ed.append(b)
    buf += ed.tobytes()
    with open(f'{aus}/wege/{tx}_{ty}.bin', 'wb') as fh: fh.write(buf)
    gesamt += len(buf); knoten_ges += N; kanten_ges += E
print(len(kacheln), 'Wege-Kacheln,', knoten_ges, 'Knoten,', kanten_ges, 'Kanten,', round(gesamt / 1e6, 1), 'MB')

# Abdeckung: 1-km-Raster (0,01°), in dem es Wege gibt → "im Datengebiet".
# Je Kachel 10 × 10 Zellen als 100-Bit-Zahl in Hex-Schreibweise.
zellen = set()
for (tx, ty), k in kacheln.items():
    for (x, y) in k['liste']: zellen.add((x // 1000, y // 1000))
abdeckung = {}
for (zx, zy) in zellen:
    key = f'{zx // 10}_{zy // 10}'
    bit = (zy % 10) * 10 + (zx % 10)
    abdeckung[key] = abdeckung.get(key, 0) | (1 << bit)
abdeckung = {k: format(v, 'x') for k, v in abdeckung.items()}
print(len(zellen), 'km²-Zellen mit Wegen')

json.dump({'datenstand': stand, 'groesse': 0.1,
           'abdeckung': abdeckung,
           'orte': sorted(orte.keys()), 'wege': sorted(f'{x}_{y}' for (x, y) in kacheln.keys())},
          open(f'{aus}/index.json', 'w'), separators=(',', ':'))
