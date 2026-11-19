#!/bin/bash
# Wie extrahiere2.sh, zusätzlich: Art des Ortes (typ) und Buslinien (route_ref).
set -euo pipefail
S=/private/tmp/claude-501/-Users-felix-meiners--claude-spares-spare-YHayiA/1110be69-e7b5-4961-acbb-9cd1403c6fb3/scratchpad
Q=/Applications/QGIS.app/Contents
export GDAL_DATA=$Q/Resources/qgis/gdal
export PROJ_DATA=$Q/Resources/qgis/proj
export OSM_CONFIG_FILE=$S/tools/osmconf3.ini
export OGR_INTERLEAVED_READING=YES
PBF=$S/geofabrik/niedersachsen.osm.pbf
OUT=$S/geofabrik/olb3.gpkg
BBOX="7.95 52.98 8.45 53.30"
GES="'doctors','pharmacy','dentist','clinic','hospital'"
KUL="'cafe','library','theatre','cinema','arts_centre','community_centre'"
rm -f $OUT
$Q/MacOS/ogr2ogr -f GPKG $OUT $PBF points -spat $BBOX -nln punkte \
  -where "highway='bus_stop' OR public_transport='platform' OR railway IN ('station','halt','tram_stop') OR shop IN ('supermarket','bakery') OR amenity IN ('kindergarten','school',$GES,$KUL) OR leisure='playground'"
$Q/MacOS/ogr2ogr -update $OUT $PBF multipolygons -spat $BBOX -nln flaechen -nlt MULTIPOLYGON \
  -where "shop IN ('supermarket','bakery') OR amenity IN ('kindergarten','school',$GES,$KUL) OR leisure IN ('park','playground')"
rm -f $S/geofabrik/oldenburg3.geojson
KAT="CASE
         WHEN shop IN ('supermarket','bakery') THEN 'versorgung'
         WHEN amenity IN ('kindergarten','school') THEN 'bildung'
         WHEN amenity IN ($GES) THEN 'gesundheit'
         WHEN amenity IN ($KUL) THEN 'kultur'
         WHEN leisure = 'playground' THEN 'spielplatz'
         ELSE 'oepnv' END"
$Q/MacOS/ogr2ogr -f GeoJSON $S/geofabrik/oldenburg3.geojson $OUT -dialect SQLite -nln oldenburg \
  -lco COORDINATE_PRECISION=6 -lco RFC7946=YES -sql "
SELECT $KAT AS kat, name, 'node/' || osm_id AS osm_id,
       COALESCE(shop, amenity, leisure, railway, highway, public_transport) AS typ,
       route_ref AS linien, geom FROM punkte
UNION ALL
SELECT $KAT, name,
       CASE WHEN osm_id IS NOT NULL THEN 'relation/' || osm_id ELSE 'way/' || osm_way_id END,
       COALESCE(shop, amenity, leisure), NULL,
       ST_PointOnSurface(geom)
  FROM flaechen WHERE leisure IS NULL OR leisure <> 'park'
UNION ALL
SELECT 'gruen', name,
       CASE WHEN osm_id IS NOT NULL THEN 'relation/' || osm_id ELSE 'way/' || osm_way_id END,
       'park', NULL,
       ST_SimplifyPreserveTopology(geom, 0.00008)
  FROM flaechen WHERE leisure = 'park'"
ls -l $S/geofabrik/oldenburg3.geojson
