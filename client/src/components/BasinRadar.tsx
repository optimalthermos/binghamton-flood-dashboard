import { useEffect, useState } from "react";
import { BASIN_CENTER, BROOME_COUNTY, RADAR_FRAMES, RADAR_PLACES, approachRadarView, basemapTileUrl, frameLabel, markerPercent, radarOverlayUrl } from "@shared/radar";
import type { GaugeData } from "@shared/schema";

const view = approachRadarView();
const countyCorners = [
  markerPercent(BROOME_COUNTY.north, BROOME_COUNTY.west, view),
  markerPercent(BROOME_COUNTY.north, BROOME_COUNTY.east, view),
  markerPercent(BROOME_COUNTY.south, BROOME_COUNTY.east, view),
  markerPercent(BROOME_COUNTY.south, BROOME_COUNTY.west, view),
];
const countyPoints = countyCorners.map(corner => `${corner.left},${corner.top}`).join(" ");
const places = RADAR_PLACES.flatMap(place => {
  const spot = markerPercent(place.latitude, place.longitude, view);
  if (spot.left < 2 || spot.left > 98 || spot.top < 2 || spot.top > 98) return [];
  return [{ ...place, ...spot }];
});

const REFLECTIVITY = [
  { color: "#9be7a3", label: "Light" },
  { color: "#3fbf3f", label: "Moderate" },
  { color: "#f7e35a", label: "Heavy" },
  { color: "#e23b2f", label: "Intense" },
];

export function BasinRadar({ gauges = [], refreshKey = 0 }: { gauges?: GaugeData[]; refreshKey?: number }) {
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [broken, setBroken] = useState(false);
  const [overlayFailed, setOverlayFailed] = useState(false);
  const [liveTick, setLiveTick] = useState(0);

  useEffect(() => setBroken(false), [refreshKey, liveTick]);
  useEffect(() => setOverlayFailed(false), [frame, refreshKey, liveTick]);

  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => {
      setFrame(current => (current + 1) % RADAR_FRAMES.length);
    }, 700);
    return () => clearInterval(timer);
  }, [playing]);

  useEffect(() => {
    const timer = setInterval(() => setLiveTick(tick => tick + 1), 120_000);
    return () => clearInterval(timer);
  }, []);

  const current = RADAR_FRAMES[frame];
  const markers = gauges.filter(gauge =>
    typeof gauge.latitude === "number" && typeof gauge.longitude === "number" && !gauge.isReservoir,
  );

  return (
    <div>
      <div className="relative overflow-hidden rounded-lg bg-[#e8eef4]" style={{ aspectRatio: `${view.width} / ${view.height}` }}>
        {view.tiles.map(tile => (
          <img
            key={`base-${tile.x}-${tile.y}`}
            src={basemapTileUrl(view.zoom, tile.x, tile.y)}
            alt=""
            className="absolute max-w-none"
            style={{ width: `${(256 / view.width) * 100}%`, height: `${(256 / view.height) * 100}%`, left: `${(tile.left / view.width) * 100}%`, top: `${(tile.top / view.height) * 100}%` }}
            onError={() => setBroken(true)}
          />
        ))}
        {!broken && !overlayFailed && (
          <img
            key={`radar-${frameLabel(current)}-${refreshKey}-${liveTick}`}
            src={radarOverlayUrl(current, view)}
            alt="Radar reflectivity centered on Binghamton, New York"
            className="absolute inset-0 h-full w-full"
            onError={() => setOverlayFailed(true)}
          />
        )}
        <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <polygon points={countyPoints} fill="none" stroke="rgba(180,83,9,0.95)" strokeWidth="0.45" />
        </svg>
        {places.map(place => (
          <div
            key={place.name}
            className="pointer-events-none absolute -translate-x-1/2 text-[10px] font-semibold text-slate-900"
            style={{ left: `${place.left}%`, top: `${place.top}%`, textShadow: "0 0 3px #fff, 0 0 3px #fff" }}
          >
            {place.name}
          </div>
        ))}
        {markers.map(gauge => {
          const spot = markerPercent(gauge.latitude!, gauge.longitude!, view);
          if (spot.left < 0 || spot.left > 100 || spot.top < 0 || spot.top > 100) return null;
          return (
            <div
              key={gauge.id}
              className="absolute -translate-x-1/2 -translate-y-1/2"
              style={{ left: `${spot.left}%`, top: `${spot.top}%` }}
              title={`${gauge.name}: ${gauge.stage ?? "—"} ft`}
            >
              <div className={`h-2 w-2 rounded-full border border-white ${gauge.isBinghamton ? "bg-amber-500" : "bg-sky-600"}`} />
              {gauge.id !== "01503500" && ["01503000", "01512500", "01513500", "01502731"].includes(gauge.id) && (
                <div className="mt-0.5 hidden whitespace-nowrap text-[9px] font-medium text-slate-900 drop-shadow sm:block">{gauge.name}</div>
              )}
            </div>
          );
        })}
        <div
          className="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-amber-700"
          style={{ left: `${markerPercent(BASIN_CENTER.latitude, BASIN_CENTER.longitude, view).left}%`, top: `${markerPercent(BASIN_CENTER.latitude, BASIN_CENTER.longitude, view).top}%` }}
          title="Susquehanna and Chenango meet at Binghamton"
        />
        {broken && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/70 text-sm text-slate-800">Basemap unavailable. Try refreshing.</div>
        )}
        {!broken && overlayFailed && (
          <div className="absolute inset-x-0 bottom-2 text-center text-[10px] text-slate-800">This frame is unavailable from the provider.</div>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
        <span className="mr-auto">Centered on Binghamton · {frameLabel(current)}</span>
        {REFLECTIVITY.map(step => (
          <span key={step.label} className="inline-flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-sm border border-black/10" style={{ background: step.color }} />
            {step.label}
          </span>
        ))}
      </div>
      <div className="mt-2 flex items-center justify-end">
        <button type="button" className="h-11 rounded border border-border px-4 text-sm" onClick={() => setPlaying(value => !value)}>
          {playing ? "Pause" : "Play"}
        </button>
      </div>
      <p className="mt-1 text-[10px] text-muted-foreground">Centered on Binghamton. The amber box is Broome County. Past frames are observed NEXRAD every 10 minutes. Future frames are the HRRR simulated reflectivity forecast, not a warning. © OpenStreetMap © CARTO · Iowa Environmental Mesonet</p>
    </div>
  );
}
