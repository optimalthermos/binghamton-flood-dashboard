/** Binghamton gauge, just downstream of the Susquehanna–Chenango junction. */
export const BASIN_CENTER = { latitude: 42.0925, longitude: -75.915 };

/** Broome County, NY. The radar view is fit to this box. */
export const BROOME_COUNTY = {
  name: "Broome County, NY",
  north: 42.353,
  south: 41.998,
  west: -76.145,
  east: -75.322,
};

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
  zoom = 10,
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

export function fitCounty(
  bounds = BROOME_COUNTY,
  width = RADAR_WIDTH,
  height = RADAR_HEIGHT,
  padding = 28,
) {
  const centerLat = (bounds.north + bounds.south) / 2;
  const centerLon = (bounds.west + bounds.east) / 2;
  for (let zoom = 12; zoom >= 8; zoom--) {
    const view = basinView(centerLat, centerLon, zoom, width, height);
    const nw = worldPixel(bounds.north, bounds.west, zoom);
    const se = worldPixel(bounds.south, bounds.east, zoom);
    const fits = nw.x >= view.left + padding && se.x <= view.left + view.width - padding
      && nw.y >= view.top + padding && se.y <= view.top + view.height - padding;
    if (fits) return view;
  }
  return basinView(centerLat, centerLon, 8, width, height);
}

/** Wider than the county, still centered on Binghamton, so rain east of Broome is in frame. */
export function stormApproachView(width = RADAR_WIDTH, height = RADAR_HEIGHT) {
  return basinView(BASIN_CENTER.latitude, BASIN_CENTER.longitude, 9, width, height);
}

export function unproject(pixelX: number, pixelY: number, zoom: number) {
  const scale = 2 ** zoom * TILE;
  const longitude = pixelX / scale * 360 - 180;
  const n = Math.PI - 2 * Math.PI * pixelY / scale;
  const latitude = Math.atan(Math.sinh(n)) * 180 / Math.PI;
  return { latitude, longitude };
}

export function viewExtent(view: { left: number; top: number; width: number; height: number; zoom: number }) {
  const nw = unproject(view.left, view.top, view.zoom);
  const se = unproject(view.left + view.width, view.top + view.height, view.zoom);
  return { north: nw.latitude, west: nw.longitude, south: se.latitude, east: se.longitude };
}

function mercatorMeters(latitude: number, longitude: number) {
  const x = longitude * 20037508.34 / 180;
  const y = Math.log(Math.tan(Math.PI / 4 + latitude * Math.PI / 360)) * 20037508.34 / Math.PI;
  return { x, y };
}

export type RadarFrame =
  | { kind: "observed"; minutesAgo: number }
  | { kind: "forecast"; minutesAhead: number };

/** Observed NEXRAD, then the HRRR simulated-reflectivity forecast through 18 hours. */
export const RADAR_FRAMES: RadarFrame[] = [
  { kind: "observed", minutesAgo: 60 },
  { kind: "observed", minutesAgo: 30 },
  { kind: "observed", minutesAgo: 0 },
  ...[60, 120, 180, 240, 360, 480, 720, 1080].map(minutesAhead => ({ kind: "forecast" as const, minutesAhead })),
];

export function frameLabel(frame: RadarFrame) {
  if (frame.kind === "observed") return frame.minutesAgo <= 0 ? "now" : `${frame.minutesAgo} min ago`;
  const hours = frame.minutesAhead / 60;
  return `+${Number.isInteger(hours) ? hours : hours.toFixed(1)} h HRRR forecast`;
}

/** HRRR layer name. 60 minutes ahead is refd_0060. */
export function forecastLayer(minutesAhead: number) {
  return `refd_${String(Math.max(0, minutesAhead)).padStart(4, "0")}`;
}

function overlayUrl(endpoint: string, layer: string, view: { left: number; top: number; width: number; height: number; zoom: number }) {
  const extent = viewExtent(view);
  const sw = mercatorMeters(extent.south, extent.west);
  const ne = mercatorMeters(extent.north, extent.east);
  const params = new URLSearchParams({
    SERVICE: "WMS",
    REQUEST: "GetMap",
    VERSION: "1.1.1",
    LAYERS: layer,
    SRS: "EPSG:3857",
    BBOX: `${sw.x},${sw.y},${ne.x},${ne.y}`,
    WIDTH: String(view.width),
    HEIGHT: String(view.height),
    FORMAT: "image/png",
    TRANSPARENT: "TRUE",
  });
  return `${endpoint}?${params.toString()}`;
}

/** One radar image in the same web-mercator box as the basemap, so it cannot drift onto another state. */
export function radarOverlayUrl(frame: RadarFrame, view = fitCounty()) {
  if (frame.kind === "forecast") {
    return overlayUrl("https://mesonet.agron.iastate.edu/cgi-bin/wms/hrrr/refd.cgi", forecastLayer(frame.minutesAhead), view);
  }
  return overlayUrl("https://mesonet.agron.iastate.edu/cgi-bin/wms/nexrad/n0q.cgi", radarLayer(frame.minutesAgo), view);
}

export function markerPercent(latitude: number, longitude: number, view = fitCounty()) {
  const point = worldPixel(latitude, longitude, view.zoom);
  return {
    left: (point.x - view.left) / view.width * 100,
    top: (point.y - view.top) / view.height * 100,
  };
}

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
