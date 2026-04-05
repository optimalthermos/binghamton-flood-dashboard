import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Camera, ChevronDown, ChevronUp } from "lucide-react";
import type { Webcam } from "@shared/schema";

interface WebcamPanelProps {
  webcamsData: { cameras: Webcam[] } | undefined;
  isLoading: boolean;
}

function CameraThumb({ cam, enlarged, onClick }: { cam: Webcam; enlarged: boolean; onClick: () => void }) {
  const [src, setSrc] = useState(`${cam.imageUrl}?_=${Date.now()}`);
  const [offline, setOffline] = useState(false);

  // Auto-refresh on interval
  useEffect(() => {
    const interval = setInterval(() => {
      setSrc(`${cam.imageUrl}?_=${Date.now()}`);
      setOffline(false);
    }, cam.refreshInterval * 1000);
    return () => clearInterval(interval);
  }, [cam.imageUrl, cam.refreshInterval]);

  return (
    <div
      className={`relative overflow-hidden rounded-lg border border-border cursor-pointer group transition-all ${enlarged ? "col-span-3" : ""}`}
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
            src={src}
            alt={cam.name}
            className="w-full h-full object-cover"
            onError={() => setOffline(true)}
            loading="lazy"
          />
        )}
        {/* LIVE indicator */}
        <div className="absolute top-2 left-2 flex items-center gap-1 bg-black/60 rounded px-1.5 py-0.5">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-[10px] font-semibold text-emerald-400 tracking-wide">LIVE</span>
        </div>
        {/* Camera name overlay */}
        <div className="absolute bottom-0 left-0 right-0 px-2 py-1 bg-gradient-to-t from-black/80 to-transparent">
          <span className="text-[11px] font-medium text-white/90 line-clamp-1">{cam.name}</span>
        </div>
        {/* Hover overlay hint */}
        <div className="absolute inset-0 bg-primary/0 group-hover:bg-primary/5 transition-colors" />
      </div>
    </div>
  );
}

export function WebcamPanel({ webcamsData, isLoading }: WebcamPanelProps) {
  const [showAll, setShowAll] = useState(false);
  const [enlarged, setEnlarged] = useState<string | null>(null);

  const cameras = webcamsData?.cameras || [];
  const displayCameras = showAll ? cameras : cameras.slice(0, 4);

  const handleClick = useCallback((id: string) => {
    setEnlarged(prev => prev === id ? null : id);
  }, []);

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
          </CardTitle>
          {cameras.length > 4 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={() => setShowAll(v => !v)}
            >
              {showAll ? (
                <><ChevronUp className="h-3.5 w-3.5" /> Show less</>
              ) : (
                <><ChevronDown className="h-3.5 w-3.5" /> Show all ({cameras.length})</>
              )}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className={`grid gap-2 ${showAll ? "grid-cols-3" : "grid-cols-2"}`}>
          {displayCameras.map(cam => (
            <CameraThumb
              key={cam.id}
              cam={cam}
              enlarged={enlarged === cam.id}
              onClick={() => handleClick(cam.id)}
            />
          ))}
        </div>
        {enlarged && (
          <div className="mt-3">
            {(() => {
              const cam = cameras.find(c => c.id === enlarged);
              if (!cam) return null;
              return (
                <div className="relative rounded-lg overflow-hidden border border-border">
                  <img
                    src={`${cam.imageUrl}?_=${Date.now()}`}
                    alt={cam.name}
                    className="w-full object-contain max-h-80"
                    onError={() => {}}
                  />
                  <div className="absolute bottom-0 left-0 right-0 px-3 py-1.5 bg-gradient-to-t from-black/80 to-transparent">
                    <span className="text-sm font-medium text-white/90">{cam.name}</span>
                  </div>
                </div>
              );
            })()}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
