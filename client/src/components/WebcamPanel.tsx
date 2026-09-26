import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Camera, ChevronDown, ChevronUp, Waves, RefreshCw } from "lucide-react";
import type { Webcam } from "@shared/schema";
import { apiUrl } from "@/lib/queryClient";

interface WebcamPanelProps {
  webcamsData: { cameras: Webcam[] } | undefined;
  isLoading: boolean;
  refreshToken?: number;
}

function useCameraFrame(imageUrl: string, refreshInterval: number, fallbackPublishedAt?: string | null, refreshToken = 0) {
  const [src, setSrc] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [publishedAt, setPublishedAt] = useState<string | null>(fallbackPublishedAt ?? null);
  const [checkedAt, setCheckedAt] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    async function load() {
      try {
        const response = await fetch(`${apiUrl(imageUrl)}?fresh=1&_=${Date.now()}`, { cache: "no-store" });
        if (!response.ok) throw new Error("unavailable");
        const blob = await response.blob();
        if (cancelled) return;
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
        setPublishedAt(response.headers.get("last-modified") || fallbackPublishedAt || null);
        setCheckedAt(Date.now());
        setOffline(false);
        setLoaded(true);
      } catch {
        if (!cancelled) setOffline(true);
      }
    }
    load();
    const interval = setInterval(load, Math.max(refreshInterval, 30) * 1000);
    return () => {
      cancelled = true;
      clearInterval(interval);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [imageUrl, refreshInterval, fallbackPublishedAt, refreshToken]);

  return { src, offline, loaded, publishedAt, checkedAt };
}

function formatStamp(value: string | null) {
  if (!value || Number.isNaN(Date.parse(value))) return null;
  return new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function CameraThumb({
  cam,
  size = "normal",
  onClick,
  isSelected,
  refreshToken = 0,
}: {
  cam: Webcam;
  size?: "large" | "normal" | "small";
  onClick: () => void;
  isSelected: boolean;
  refreshToken?: number;
}) {
  const frame = useCameraFrame(cam.imageUrl, cam.refreshInterval, cam.publishedAt, refreshToken);
  const { src, offline, loaded, publishedAt, checkedAt } = frame;

  const category = cam.category || "traffic";
  const isRiver = category === "river";
  const imageAge = publishedAt ? Date.now() - Date.parse(publishedAt) : null;
  const publishedLabel = formatStamp(publishedAt);
  const checkedLabel = checkedAt ? formatStamp(new Date(checkedAt).toISOString()) : null;

  return (
    <button type="button" aria-label={`Enlarge ${cam.name}`} aria-pressed={isSelected}
      className={`relative overflow-hidden rounded-lg border cursor-pointer group transition-all ${
        isRiver
          ? "border-primary/30 hover:border-primary/60"
          : isSelected
          ? "border-primary/40"
          : "border-border hover:border-border/70"
      }`}
      onClick={onClick}
    >
      <div className="aspect-video bg-muted/30 relative">
        {offline ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-muted/50 text-xs text-muted-foreground gap-1">
            <Camera className="h-6 w-6 opacity-40" />
            <span>Camera offline</span>
          </div>
        ) : (
          <img
            src={src || undefined}
            alt={cam.name}
            className="w-full h-full object-cover"
            width="640" height="360" decoding="async"
            loading="lazy"
          />
        )}

        {/* LIVE indicator */}
        <div className="absolute top-2 left-2 flex items-center gap-1 bg-black/60 rounded px-1.5 py-0.5">
          <span className="text-xs font-semibold text-white tracking-wide">{offline ? "UNAVAILABLE" : !loaded ? "LOADING" : imageAge !== null && imageAge > 2 * 3600_000 ? "OLDER IMAGE" : "SNAPSHOT"}</span>
        </div>

        {/* Camera name + description overlay */}
        <div className="absolute bottom-0 left-0 right-0 px-2 py-1.5 bg-gradient-to-t from-black/80 to-transparent">
          <div className="text-[11px] font-medium text-white/90 line-clamp-1">{cam.name}</div>
          {cam.description && size !== "small" && (
            <div className="text-[9px] text-white/55 line-clamp-1 mt-0.5">{cam.description}</div>
          )}
          {publishedLabel && <div className="text-[10px] text-white/90">Image {publishedLabel}</div>}
          {checkedLabel && <div className="text-[9px] text-white/70">Checked {checkedLabel}</div>}
        </div>

        {/* Hover overlay */}
        <div className="absolute inset-0 bg-primary/0 group-hover:bg-primary/5 transition-colors" />
      </div>
    </button>
  );
}

function ExpandedCamera({ cam, failed, onFail, refreshToken = 0 }: { cam: Webcam; failed: boolean; onFail: () => void; refreshToken?: number }) {
  const { src, offline, publishedAt } = useCameraFrame(cam.imageUrl, cam.refreshInterval, cam.publishedAt, refreshToken);
  const publishedLabel = formatStamp(publishedAt);
  if (failed || offline) {
    return <div className="aspect-video flex items-center justify-center text-muted-foreground">Camera unavailable. Try again later.</div>;
  }
  return (
    <>
      <img
        src={src || undefined}
        alt={cam.name}
        className="w-full object-contain max-h-80"
        width="640" height="360"
        onError={onFail}
      />
      <div className="absolute bottom-0 left-0 right-0 px-3 py-1.5 bg-gradient-to-t from-black/80 to-transparent">
        <div className="text-sm font-medium text-white/90">{cam.name}</div>
        {cam.description && <div className="text-xs text-white/60">{cam.description}</div>}
        {publishedLabel && <div className="text-[11px] text-white/80">Image {publishedLabel}</div>}
      </div>
    </>
  );
}

export function WebcamPanel({ webcamsData, isLoading, refreshToken = 0 }: WebcamPanelProps) {
  const [showAllTraffic, setShowAllTraffic] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [expandedFailed, setExpandedFailed] = useState(false);
  const [revision, setRevision] = useState(0);

  const cameras = webcamsData?.cameras || [];

  const riverCams = cameras.filter(c => c.category === "river");
  const weatherCams = cameras.filter(c => c.category === "weather");
  const trafficCams = cameras.filter(c => c.category === "traffic" || (!c.category && c.type === "dot"));
  const visibleTrafficCams = showAllTraffic ? trafficCams : trafficCams.slice(0, 4);

  const handleClick = useCallback((id: string) => {
    setExpandedFailed(false);
    setSelected(prev => prev === id ? null : id);
  }, []);

  const selectedCam = selected ? cameras.find(c => c.id === selected) : null;

  if (isLoading) {
    return (
      <Card className="bg-card border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Camera className="h-4 w-4 text-primary" />
            Area Cameras
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-2">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="aspect-video rounded-lg bg-muted/30 animate-pulse" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!cameras.length) return null;

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Camera className="h-4 w-4 text-primary" />
            Area Cameras
            <Badge variant="outline" className="text-[10px] px-1.5 py-0">{cameras.length}</Badge>
          </CardTitle>
          <Button variant="ghost" size="sm" aria-label="Refresh camera snapshots" onClick={() => { setRevision(v => v + 1); setExpandedFailed(false); }}>
            <RefreshCw className="h-3.5 w-3.5 mr-1" />Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-[10px] text-muted-foreground">Snapshots refresh on their own. The image time is the publisher&apos;s timestamp and stays visible when that file is older than the last check.</p>

        {/* Selected camera expanded view */}
        {selectedCam && (
          <div className="relative rounded-lg overflow-hidden border border-primary/30">
            <ExpandedCamera cam={selectedCam} failed={expandedFailed} refreshToken={refreshToken} onFail={() => setExpandedFailed(true)} />
            <button
              aria-label="Close expanded camera"
              onClick={() => setSelected(null)}
              className="absolute top-2 right-2 bg-black/60 text-white/80 text-[10px] px-2 py-0.5 rounded hover:bg-black/80 transition-colors"
            >
              ✕
            </button>
          </div>
        )}

        {/* RIVER CAMERAS — large 2-column, featured */}
        {riverCams.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Waves className="h-3.5 w-3.5 text-blue-400" />
              <span className="text-xs font-semibold text-blue-400 uppercase tracking-wide">River Cameras</span>
              <span className="text-[10px] text-muted-foreground">USGS · Chenango & Susquehanna</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {riverCams.map(cam => (
                <CameraThumb
                  key={`${cam.id}-${revision}-${refreshToken}`}
                  cam={cam}
                  refreshToken={refreshToken}
                  size="large"
                  isSelected={selected === cam.id}
                  onClick={() => handleClick(cam.id)}
                />
              ))}
            </div>
          </div>
        )}

        {/* NWS & WEATHER CAMERAS */}
        {weatherCams.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-semibold text-emerald-400 uppercase tracking-wide">NWS &amp; Weather</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {weatherCams.map(cam => (
                <CameraThumb
                  key={`${cam.id}-${revision}-${refreshToken}`}
                  cam={cam}
                  refreshToken={refreshToken}
                  size="normal"
                  isSelected={selected === cam.id}
                  onClick={() => handleClick(cam.id)}
                />
              ))}
            </div>
          </div>
        )}

        {/* TRAFFIC CAMERAS — compact grid, collapsible */}
        {trafficCams.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Traffic Cameras
                <span className="text-[10px] font-normal ml-1.5 normal-case">NYSDOT</span>
              </span>
              {trafficCams.length > 4 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-xs gap-1 px-2"
                  onClick={() => setShowAllTraffic(v => !v)}
                >
                  {showAllTraffic ? (
                    <><ChevronUp className="h-3 w-3" /> Show fewer</>
                  ) : (
                    <><ChevronDown className="h-3 w-3" /> Show all ({trafficCams.length})</>
                  )}
                </Button>
              )}
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
              {visibleTrafficCams.map(cam => (
                <CameraThumb
                  key={`${cam.id}-${revision}-${refreshToken}`}
                  cam={cam}
                  refreshToken={refreshToken}
                  size="small"
                  isSelected={selected === cam.id}
                  onClick={() => handleClick(cam.id)}
                />
              ))}
            </div>
          </div>
        )}

      </CardContent>
    </Card>
  );
}
