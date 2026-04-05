import { useState, useRef, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, ChevronUp, Radio, AlertTriangle, ExternalLink, Zap, Play, Pause, Volume2, VolumeX, Loader2, WifiOff } from "lucide-react";

// === Static emergency frequency data for Binghamton/Broome County ===

const SKYWARN_FREQUENCIES = [
  { freq: "146.820", offset: "−0.6", pl: "146.2", call: "WA2QEL", name: "Broome SKYWARN Primary", location: "Kopernik Obs, Vestal", isPrimary: true },
  { freq: "146.865", offset: "−0.6", pl: "146.2", call: "WA2QEL", name: "Broome SKYWARN Alt", location: "Airport, Binghamton", isPrimary: true },
  { freq: "147.345", offset: "+0.6", pl: "146.2", call: "WA2QEL", name: "Linked (Hancock)", location: "Hancock, NY", isPrimary: false },
  { freq: "444.100", offset: "+5", pl: "146.2", call: "WA2QEL", name: "Linked UHF", location: "Vestal", isPrimary: false },
];

const LOCAL_REPEATERS = [
  { freq: "146.640", offset: "−0.6", pl: "141.3", call: "N2VFD", name: "Binghamton Univ.", note: "" },
  { freq: "146.730", offset: "−0.6", pl: "100.0", call: "K2TDV", name: "Ingraham Hill", note: "Also P-25; linked to Ithaca 146.895" },
  { freq: "147.075", offset: "+0.6", pl: "CSQ", call: "W3SW", name: "Binghamton", note: "" },
  { freq: "147.120", offset: "+0.6", pl: "100.0", call: "K2ZG", name: "Vestal", note: "" },
  { freq: "147.255", offset: "+0.6", pl: "100.0", call: "WA2VCS", name: "Endicott", note: "" },
  { freq: "145.390", offset: "−0.6", pl: "123.0", call: "N2YR", name: "Endicott", note: "" },
  { freq: "444.300", offset: "+5", pl: "173.8", call: "N2YOW", name: "Endicott", note: "Linked to 147.255" },
];

const EMERGENCY_FREQUENCIES = [
  { freq: "146.520", mode: "FM Simplex", name: "National Calling Frequency", note: "VHF — no repeater needed" },
  { freq: "446.000", mode: "FM Simplex", name: "UHF National Simplex", note: "UHF — no repeater needed" },
  { freq: "3958 kHz", mode: "LSB", name: "NY ARES/RACES Primary", note: "HF — statewide" },
  { freq: "7245 kHz", mode: "LSB", name: "NY ARES/RACES Alt", note: "HF — 40m daytime" },
  { freq: "3925 kHz", mode: "LSB", name: "NY ARES/RACES Alt 2", note: "HF — 75m" },
];

const NOAA_WEATHER_RADIO = {
  freq: "162.475",
  call: "WXL-42",
  name: "NOAA Weather Radio — Binghamton",
  note: "24/7 automated forecasts, watches, warnings from NWS BGM",
};

// === Live Scanner Feeds ===

interface ScannerFeed {
  id: number;
  name: string;
  description: string;
  listeners: number;
  tags: string[];
}

const SCANNER_FEEDS: ScannerFeed[] = [
  {
    id: 39447,
    name: "Broome County Public Safety (P25)",
    description: "Police/Fire/EMS dispatch — primary Broome County feed",
    listeners: 30,
    tags: ["Police", "Fire", "EMS"],
  },
  {
    id: 43682,
    name: "Broome County Battalion 2",
    description: "Fire/EMS + Binghamton PD — Battalion 2 operations",
    listeners: 4,
    tags: ["Fire", "EMS", "BPD"],
  },
  {
    id: 39886,
    name: "Broome County Fire/EMS (P25)",
    description: "Fire and EMS only — dedicated P25 trunked system",
    listeners: 1,
    tags: ["Fire", "EMS"],
  },
];

type PlayerState = "idle" | "connecting" | "playing" | "error";

interface AudioPlayerRowProps {
  feed: ScannerFeed;
  isActive: boolean;
  onActivate: (id: number) => void;
  onDeactivate: () => void;
}

function AudioPlayerRow({ feed, isActive, onActivate, onDeactivate }: AudioPlayerRowProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playerState, setPlayerState] = useState<PlayerState>("idle");
  const [volume, setVolume] = useState(0.8);
  const [isMuted, setIsMuted] = useState(false);

  const streamUrl = `https://broadcastify.cdnstream1.com/${feed.id}`;
  const webPlayerUrl = `https://www.broadcastify.com/webPlayer/${feed.id}`;

  // When isActive changes, start or stop
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isActive) {
      setPlayerState("connecting");
      audio.src = streamUrl;
      audio.load();
      const playPromise = audio.play();
      if (playPromise) {
        playPromise
          .then(() => setPlayerState("playing"))
          .catch(() => setPlayerState("error"));
      }
    } else {
      audio.pause();
      audio.src = "";
      setPlayerState("idle");
    }
  }, [isActive, streamUrl]);

  // Apply volume changes
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = isMuted ? 0 : volume;
  }, [volume, isMuted]);

  const handlePlayPause = useCallback(() => {
    if (isActive) {
      onDeactivate();
    } else {
      onActivate(feed.id);
    }
  }, [isActive, feed.id, onActivate, onDeactivate]);

  const handleError = useCallback(() => {
    setPlayerState("error");
  }, []);

  const handlePlaying = useCallback(() => {
    setPlayerState("playing");
  }, []);

  const handleWaiting = useCallback(() => {
    if (isActive) setPlayerState("connecting");
  }, [isActive]);

  const stateColor = playerState === "playing"
    ? "text-emerald-400"
    : playerState === "connecting"
    ? "text-amber-400"
    : playerState === "error"
    ? "text-red-400"
    : "text-muted-foreground";

  const stateLabel = playerState === "playing"
    ? "Playing"
    : playerState === "connecting"
    ? "Connecting…"
    : playerState === "error"
    ? "Error"
    : "Idle";

  return (
    <div className={`rounded-lg border p-3 transition-all ${
      isActive
        ? "bg-primary/10 border-primary/30"
        : "bg-accent/30 border-border hover:border-border/80"
    }`}>
      {/* Hidden audio element */}
      <audio
        ref={audioRef}
        preload="none"
        onError={handleError}
        onPlaying={handlePlaying}
        onWaiting={handleWaiting}
        onStalled={handleError}
      />

      {/* Top row: play button + name + LIVE badge */}
      <div className="flex items-start gap-3">
        {/* Play/Pause button */}
        <button
          onClick={handlePlayPause}
          className={`shrink-0 h-9 w-9 rounded-full flex items-center justify-center transition-all ${
            isActive
              ? "bg-primary text-primary-foreground hover:bg-primary/90"
              : "bg-accent hover:bg-accent/80 text-foreground"
          }`}
          aria-label={isActive ? "Pause stream" : "Play stream"}
        >
          {playerState === "connecting" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : isActive && playerState === "playing" ? (
            <Pause className="h-4 w-4" />
          ) : (
            <Play className="h-4 w-4 ml-0.5" />
          )}
        </button>

        {/* Feed info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-xs leading-tight">{feed.name}</span>
            <span className="flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse shrink-0" />
              <span className="text-[10px] font-bold text-red-400 tracking-wide">LIVE</span>
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{feed.description}</p>

          {/* Tags + listener count */}
          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
            {feed.tags.map(tag => (
              <Badge key={tag} variant="outline" className="text-[9px] px-1 py-0 h-4">{tag}</Badge>
            ))}
            <span className="text-[10px] text-muted-foreground ml-auto">{feed.listeners} listening</span>
          </div>
        </div>

        {/* External link */}
        <a
          href={webPlayerUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 text-muted-foreground hover:text-primary transition-colors p-1"
          title="Open in Broadcastify web player"
          onClick={(e) => e.stopPropagation()}
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>

      {/* Volume + status row (only visible when active) */}
      {isActive && (
        <div className="mt-2.5 flex items-center gap-2">
          {/* Status */}
          <span className={`text-[10px] font-medium ${stateColor} shrink-0`}>
            {playerState === "connecting" && <Loader2 className="h-3 w-3 inline mr-1 animate-spin" />}
            {playerState === "error" && <WifiOff className="h-3 w-3 inline mr-1" />}
            {stateLabel}
          </span>

          {/* Volume toggle */}
          <button
            onClick={() => setIsMuted(m => !m)}
            className="text-muted-foreground hover:text-foreground transition-colors"
            aria-label={isMuted ? "Unmute" : "Mute"}
          >
            {isMuted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
          </button>

          {/* Volume slider */}
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={isMuted ? 0 : volume}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              setVolume(v);
              if (v > 0) setIsMuted(false);
            }}
            className="flex-1 h-1 accent-primary cursor-pointer"
            aria-label="Volume"
          />
        </div>
      )}

      {/* Error fallback */}
      {playerState === "error" && (
        <div className="mt-2 text-[11px] text-red-400 flex items-center gap-1.5">
          <WifiOff className="h-3 w-3 shrink-0" />
          <span>
            Stream unavailable —{" "}
            <a
              href={webPlayerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-red-300"
            >
              listen on Broadcastify
            </a>
          </span>
        </div>
      )}
    </div>
  );
}

// === Main HamRadioPanel ===

export default function HamRadioPanel() {
  const [open, setOpen] = useState(false);
  const [showAllRepeaters, setShowAllRepeaters] = useState(false);
  const [activeFeedId, setActiveFeedId] = useState<number | null>(null);

  const handleActivate = useCallback((id: number) => {
    setActiveFeedId(id);
  }, []);

  const handleDeactivate = useCallback(() => {
    setActiveFeedId(null);
  }, []);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card className="bg-card border-border">
        <CollapsibleTrigger className="w-full">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <Radio className="h-4 w-4" />
                Ham Radio Emergency
                <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-400">SKYWARN</Badge>
                {activeFeedId && (
                  <span className="flex items-center gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    <span className="text-[10px] text-emerald-400 font-medium">STREAMING</span>
                  </span>
                )}
              </CardTitle>
              {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </div>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="space-y-4 text-xs">

            {/* === Live Scanner Feeds === */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="font-semibold flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
                  Live Scanner Feeds — Broome County
                </span>
                <a
                  href="https://www.broadcastify.com/listen/ctid/1828"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline flex items-center gap-1 text-[10px]"
                >
                  All feeds <ExternalLink className="h-3 w-3" />
                </a>
              </div>
              <p className="text-muted-foreground mb-2.5 leading-snug">
                Live Broome County public safety audio via Broadcastify. One stream plays at a time.
                Streams may require a moment to connect. CORS policy may block playback in some browsers — use the external link as fallback.
              </p>
              <div className="space-y-2">
                {SCANNER_FEEDS.map(feed => (
                  <AudioPlayerRow
                    key={feed.id}
                    feed={feed}
                    isActive={activeFeedId === feed.id}
                    onActivate={handleActivate}
                    onDeactivate={handleDeactivate}
                  />
                ))}
              </div>
            </div>

            <div className="border-t border-border" />

            {/* NOAA Weather Radio */}
            <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-2.5">
              <div className="flex items-center gap-2 mb-1">
                <Zap className="h-3.5 w-3.5 text-blue-400" />
                <span className="font-semibold text-blue-400">NOAA Weather Radio</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="font-mono font-bold text-lg text-blue-300">{NOAA_WEATHER_RADIO.freq} MHz</span>
                <Badge variant="outline" className="text-[10px]">{NOAA_WEATHER_RADIO.call}</Badge>
              </div>
              <p className="text-muted-foreground mt-0.5">{NOAA_WEATHER_RADIO.note}</p>
            </div>

            {/* SKYWARN / NWS Liaison */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
                <span className="font-semibold">SKYWARN Net — NWS Binghamton</span>
              </div>
              <p className="text-muted-foreground mb-2">
                NWS BGM activates SKYWARN net during severe weather. Report: sky, precip, temp, wind, damage.
              </p>
              <div className="space-y-1.5">
                {SKYWARN_FREQUENCIES.map(f => (
                  <div key={f.freq} className={`flex items-center gap-2 p-1.5 rounded ${f.isPrimary ? "bg-amber-500/10 border border-amber-500/20" : "bg-accent/30"}`}>
                    <span className="font-mono font-bold text-sm w-20 shrink-0">{f.freq}</span>
                    <span className="text-muted-foreground w-10 shrink-0">{f.offset}</span>
                    <span className="text-muted-foreground w-12 shrink-0">PL {f.pl}</span>
                    <span className="font-medium flex-1 truncate">{f.name}</span>
                    <Badge variant="outline" className="text-[9px] shrink-0">{f.call}</Badge>
                  </div>
                ))}
              </div>
              <div className="text-muted-foreground mt-2">
                Phone reports to NWS: <span className="font-mono font-medium text-foreground">1-800-792-2257</span>
              </div>
            </div>

            {/* National / State Emergency */}
            <div>
              <span className="font-semibold">Emergency Simplex & HF Nets</span>
              <div className="space-y-1 mt-1.5">
                {EMERGENCY_FREQUENCIES.map(f => (
                  <div key={f.freq} className="flex items-center gap-2 p-1.5 rounded bg-red-500/5 border border-red-500/10">
                    <span className="font-mono font-bold text-sm w-20 shrink-0">{f.freq}</span>
                    <span className="text-muted-foreground w-14 shrink-0">{f.mode}</span>
                    <span className="flex-1 truncate">{f.name}</span>
                    <span className="text-muted-foreground text-[10px] shrink-0">{f.note}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Local Repeaters */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="font-semibold">Local Repeaters — Binghamton Area</span>
                <button onClick={() => setShowAllRepeaters(!showAllRepeaters)} className="text-primary text-[10px] hover:underline">
                  {showAllRepeaters ? "Show fewer" : `Show all (${LOCAL_REPEATERS.length})`}
                </button>
              </div>
              <div className="space-y-1">
                {(showAllRepeaters ? LOCAL_REPEATERS : LOCAL_REPEATERS.slice(0, 4)).map(f => (
                  <div key={f.freq} className="flex items-center gap-2 p-1.5 rounded bg-accent/30">
                    <span className="font-mono font-bold text-sm w-20 shrink-0">{f.freq}</span>
                    <span className="text-muted-foreground w-10 shrink-0">{f.offset}</span>
                    <span className="text-muted-foreground w-12 shrink-0">PL {f.pl}</span>
                    <span className="flex-1 truncate">{f.name}</span>
                    <Badge variant="outline" className="text-[9px] shrink-0">{f.call}</Badge>
                  </div>
                ))}
              </div>
            </div>

            {/* BARA Club Info */}
            <div className="border-t border-border pt-2 flex items-center justify-between text-muted-foreground">
              <div>
                <span className="font-medium text-foreground">BARA</span> — Binghamton Amateur Radio Association (W2OW)
              </div>
              <a href="https://w2ow.org" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline flex items-center gap-1">
                w2ow.org <ExternalLink className="h-3 w-3" />
              </a>
            </div>

          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
