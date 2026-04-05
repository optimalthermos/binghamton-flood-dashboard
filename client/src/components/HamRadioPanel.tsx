import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, ChevronUp, Radio, AlertTriangle, ExternalLink, Zap } from "lucide-react";

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

export default function HamRadioPanel() {
  const [open, setOpen] = useState(false);
  const [showAllRepeaters, setShowAllRepeaters] = useState(false);

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
              </CardTitle>
              {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </div>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="space-y-4 text-xs">

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
