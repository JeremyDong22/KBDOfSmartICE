# Local Tiles Setup Guide

## Option 1: PMTiles + MapLibre GL (Recommended)

**File size:** ~8-12MB for China (zoom 0-14)
**Pros:** Smallest size, best performance, modern
**Cons:** Requires switching from Leaflet to MapLibre GL

### Steps:

1. **Get China PMTiles:**
   ```bash
   # Download from Protomaps or generate from Geofabrik
   wget https://download.geofabrik.de/asia/china-latest.osm.pbf

   # Convert to PMTiles (requires tippecanoe)
   tippecanoe -o china.pmtiles \
     --force \
     --maximum-zoom=14 \
     --drop-densest-as-needed \
     china-latest.osm.pbf
   ```

2. **Upload to Supabase:**
   ```bash
   supabase storage cp ./china.pmtiles ss:///KBD/maps/china.pmtiles \
     --experimental --linked \
     --content-type application/vnd.pmtiles \
     --cache-control "max-age=31536000, immutable"
   ```

3. **Update main.html:**
   - Replace Leaflet CSS/JS with MapLibre GL
   - Update map initialization code

## Option 2: MBTiles + Tile Server (Medium Complexity)

**File size:** ~30-50MB for China (zoom 0-12)
**Pros:** Works with Leaflet, reasonable size
**Cons:** Needs tile server or extraction

### Steps:

1. **Generate MBTiles:**
   ```bash
   # Use MOBAC or tilemaker
   tilemaker --input china-latest.osm.pbf \
     --output china.mbtiles \
     --config resources/config-openmaptiles.json
   ```

2. **Serve tiles:**
   - Option A: Use tileserver-gl
   - Option B: Extract to directory structure and upload to Supabase

## Option 3: Directory-Based Raster Tiles (Simplest)

**File size:** ~100-200MB for China (zoom 0-12)
**Pros:** Works with existing Leaflet code, no changes needed
**Cons:** Largest file size

### Steps:

1. **Download tiles using MOBAC:**
   - Download Mobile Atlas Creator
   - Select China region
   - Choose zoom levels 0-12
   - Export as "OSM Tile Storage"

2. **Upload to Supabase:**
   ```bash
   # Upload tile directory structure
   supabase storage cp ./tiles/ ss:///KBD/maps/tiles/ \
     -r --experimental --linked \
     --cache-control "max-age=31536000"
   ```

3. **Update map.js tile URL:**
   ```javascript
   const SUPABASE_STORAGE_URL = 'https://wdpeoyugsxqnpwwtkqsl.supabase.co/storage/v1/object/public/KBD/maps/tiles';

   L.tileLayer(`${SUPABASE_STORAGE_URL}/{z}/{x}/{y}.png`, {
       maxZoom: 12,
       attribution: '© OpenStreetMap'
   }).addTo(this.map);
   ```

## Recommended Approach

For your use case (China-only, ~10MB target), **Option 1 (PMTiles)** is best:
- Smallest file size
- Best performance
- Single file to manage
- Modern and future-proof

The migration from Leaflet to MapLibre GL is straightforward and worth the effort.
