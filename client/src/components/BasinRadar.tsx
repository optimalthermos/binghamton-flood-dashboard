import { useEffect, useState } from "react";
import { BASIN_CENTER, BROOME_COUNTY, RADAR_FRAMES, basemapTileUrl, fitCounty, markerPercent, radarOverlayUrl } from "@shared/radar";
import type { GaugeData } from "@shared/schema";

const view = fitCounty();

export function BasinRadar({ gauges = [], refreshKey = 0 }: { gauges?: GaugeData[]; refreshKey?: number }) {
  const [frame, setFrame] = useState(RADAR_FRAMES.length - 1);
  const [playing, setPlaying] = useState(true);
  const [broken, setBroken] = useState(false);

  useEffect(() => setBroken(false), [refreshKey]);

  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => {
      setFrame(current => (current + 1) % RADAR_FRAMES.length);
    }, 700);
    return () => clearInterval(timer);
  }, [playing]);

  const minutesAgo = RADAR_FRAMES[frame];
  const markers = gauges.filter(gauge =>
    typeof gauge.latitude === "number" && typeof gauge.longitude === "number" && !gauge.isReservoir,
  );

  return (
    <div>
      <div className="relative overflow-hidden rounded-lg bg-[#0b1220]" style={{ aspectRatio: `${view.width} / ${view.height}` }}>
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
        {!broken && (
          <img
            key={`radar-${minutesAgo}-${refreshKey}`}
            src={radarOverlayUrl(minutesAgo, view)}
            alt="NEXRAD reflectivity over Broome County, New York"
            className="absolute inset-0 h-full w-full mix-blend-screen"
          />
        )}
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
              <div className={`h-2.5 w-2.5 rounded-full border border-white ${gauge.isBinghamton ? "bg-amber-400" : "bg-sky-400"}`} />
              {["01503500", "01503000", "01512500", "01513500", "01502731"].includes(gauge.id) && (
                <div className="mt-0.5 whitespace-nowrap text-[9px] font-medium text-white drop-shadow">{gauge.name}</div>
              )}
            </div>
          );
        })}
        <div
          className="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-amber-300"
          style={{ left: `${markerPercent(BASIN_CENTER.latitude, BASIN_CENTER.longitude, view).left}%`, top: `${markerPercent(BASIN_CENTER.latitude, BASIN_CENTER.longitude, view).top}%` }}
          title="Susquehanna and Chenango meet at Binghamton"
        />
        {broken && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-sm text-white">Basemap unavailable. Try refreshing.</div>
        )}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
        <span>NEXRAD over {BROOME_COUNTY.name} · {minutesAgo === 0 ? "current" : `${minutesAgo} min ago`}</span>
        <button type="button" className="rounded border border-border px-2 py-0.5" onClick={() => setPlaying(value => !value)}>
          {playing ? "Pause" : "Play"}
        </button>
      </div>
      <p className="mt-1 text-[10px] text-muted-foreground">Broome County, New York, including Binghamton where the Chenango joins the Susquehanna. © OpenStreetMap © CARTO · Iowa Environmental Mesonet</p>
    </div>
  );
}
