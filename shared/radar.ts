/** Binghamton gauge, just downstream of the Susquehanna–Chenango junction. */
export const BASIN_CENTER = { latitude: 42.0925, longitude: -75.915 };
export const RADAR_ZOOM = 10;
export const RADAR_WIDTH = 768;
export const RADAR_HEIGHT = 420;

const TILE = 256;

export function worldPixel(latitude: number, longitude: number, zoom: number) {
  const scale = 2 ** zoom * TILE;
  const latRad = latitude * Math.PI / 180;
  return {
    x: (longitude + 180) / 360 * scale,
    y: (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * scale,
  };
}

export interface RadarTile {
  x: number;
  y: number;
  left: number;
  top: number;
}

export function basinView(
  latitude = BASIN_CENTER.latitude,
  longitude = BASIN_CENTER.longitude,
  zoom = RADAR_ZOOM,
  width = RADAR_WIDTH,
  height = RADAR_HEIGHT,
) {
  const center = worldPixel(latitude, longitude, zoom);
  const left = center.x - width / 2;
  const top = center.y - height / 2;
  const x0 = Math.floor(left / TILE);
  const y0 = Math.floor(top / TILE);
  const x1 = Math.floor((left + width - 1) / TILE);
  const y1 = Math.floor((top + height - 1) / TILE);
  const tiles: RadarTile[] = [];
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      tiles.push({ x, y, left: x * TILE - left, top: y * TILE - top });
    }
  }
  return { zoom, left, top, width, height, tiles };
}

export function markerPercent(latitude: number, longitude: number, view = basinView()) {
  const point = worldPixel(latitude, longitude, view.zoom);
  return {
    left: (point.x - view.left) / view.width * 100,
    top: (point.y - view.top) / view.height * 100,
  };
}

/** IEM loop layers, oldest first. 0 is the current composite. */
export const RADAR_FRAMES = [50, 40, 30, 20, 10, 0];

export function radarLayer(minutesAgo: number) {
  if (minutesAgo <= 0) return "nexrad-n0q-900913";
  return `nexrad-n0q-900913-m${String(minutesAgo).padStart(2, "0")}m`;
}

export function radarTileUrl(minutesAgo: number, zoom: number, x: number, y: number) {
  return `https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/${radarLayer(minutesAgo)}/${zoom}/${x}/${y}.png`;
}

export function basemapTileUrl(zoom: number, x: number, y: number) {
  return `https://basemaps.cartocdn.com/dark_all/${zoom}/${x}/${y}.png`;
}
