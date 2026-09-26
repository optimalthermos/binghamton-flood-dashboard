import { useState, useEffect } from "react";
import { useDashboardData } from "@/hooks/use-dashboard-data";
import { apiUrl } from "@/lib/queryClient";
import { WebcamPanel } from "@/components/WebcamPanel";
import { BasinRadar } from "@/components/BasinRadar";
import { CommunityFeedPanel } from "@/components/CommunityFeedPanel";
import HamRadioPanel from "@/components/HamRadioPanel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { Progress } from "@/components/ui/progress";
import {
  RefreshCw, Sun, Moon, Waves, TrendingUp, TrendingDown, Minus,
  Thermometer, CloudRain, Snowflake, Activity, ChevronDown, ChevronUp,
  ExternalLink, AlertTriangle, CheckCircle, XCircle, Clock, WifiOff, Wifi,
  Droplets, ArrowDownUp, Newspaper, ShieldAlert, Gauge,
  Mountain, Wind, MapPin, Eye, BarChart3, Layers, Radio,
  Brain, TrendingUp as TrendIcon, History, TriangleAlert, ArrowUp, ArrowDown,
} from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, ReferenceLine,
  Legend, ResponsiveContainer, LineChart, Line, BarChart, Bar, Tooltip as RechartsTooltip,
} from "recharts";
import { STORM_SEARCH_URL } from "@shared/stormPosts";
import type {
  GaugeData, WeatherData, GaugesResponse, EnsembleData, NewsData,
  GroundwaterData, SurfaceObs, GridpointData, HistoricalStats, HistoricalStatEntry, SoilMoisture,
  PredictiveOutlook, ForecastData, StormPosts,
} from "@shared/schema";

// === Utility helpers ===

function formatTimeAgo(dateStr: string | null): string {
  if (!dateStr) return "Unknown";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ${mins % 60}m ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function freshnessMins(dateStr: string | null): number {
  if (!dateStr) return 999;
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000);
}

function stageColor(stage: number | null, thresholds: GaugeData["thresholds"]): string {
  if (stage === null) return "text-muted-foreground";
  if (thresholds.minor && stage >= thresholds.minor) return "text-red-500";
  if (thresholds.action && stage >= thresholds.action) return "text-orange-500";
  if (thresholds.action && stage >= thresholds.action - 2) return "text-amber-400";
  return "text-emerald-400";
}

function trendIcon(trend: string) {
  switch (trend) {
    case "Rising": return <TrendingUp className="h-4 w-4 text-red-400" />;
    case "Falling": return <TrendingDown className="h-4 w-4 text-emerald-400" />;
    case "Steady": return <Minus className="h-4 w-4 text-blue-400" />;
    default: return <Minus className="h-4 w-4 text-muted-foreground" />;
  }
}

function formatCountdown(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// === Mini sparkline ===
const GAUGE_COLORS = [
  "hsl(195, 80%, 55%)", "hsl(173, 58%, 50%)", "hsl(38, 90%, 60%)", "hsl(280, 60%, 60%)",
  "hsl(145, 60%, 50%)", "hsl(12, 80%, 60%)", "hsl(220, 70%, 65%)", "hsl(50, 80%, 55%)",
  "hsl(330, 60%, 62%)", "hsl(95, 45%, 50%)", "hsl(260, 40%, 70%)",
];

function MiniSparkline({ data, thresholdAction, sparkId }: { data: Array<{ timestamp: string; value: number | null }>; thresholdAction?: number; sparkId: string }) {
  const pts = data.filter(d => d.value !== null).slice(-72);
  if (pts.length < 2) return <div className="h-12 flex items-center justify-center text-xs text-muted-foreground">No data</div>;
  const chartData = pts.map(p => ({ t: new Date(p.timestamp).getTime(), v: p.value }));
  const gradId = `spark-${sparkId}`;
  return (
    <ResponsiveContainer width="100%" height={48}>
      <AreaChart data={chartData} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="hsl(195, 80%, 45%)" stopOpacity={0.3} />
            <stop offset="95%" stopColor="hsl(195, 80%, 45%)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area type="monotone" dataKey="v" stroke="hsl(195, 80%, 45%)" fill={`url(#${gradId})`} strokeWidth={1.5} dot={false} isAnimationActive />
        {thresholdAction && <ReferenceLine y={thresholdAction} stroke="hsl(38, 90%, 55%)" strokeDasharray="3 3" strokeWidth={1} />}
      </AreaChart>
    </ResponsiveContainer>
  );
}

function StageTrack({ stage, action, minor }: { stage: number | null; action?: number; minor?: number }) {
  const ceiling = minor || (action ? action * 1.2 : null);
  if (stage === null || !ceiling || ceiling <= 0) return null;
  const pct = Math.max(2, Math.min(100, (stage / ceiling) * 100));
  const actionPct = action ? Math.max(0, Math.min(100, (action / ceiling) * 100)) : null;
  const hot = action !== undefined && stage >= action;
  return (
    <div className="relative mt-2 h-1.5 rounded-full bg-muted/60" title={action ? `Action stage ${action} ft` : undefined}>
      <div className={`stage-fill absolute inset-y-0 left-0 rounded-full ${hot ? "bg-red-400" : "bg-primary"}`} style={{ width: `${pct}%` }} />
      {actionPct !== null && <div className="absolute inset-y-0 w-px bg-amber-400" style={{ left: `${actionPct}%` }} />}
    </div>
  );
}

// === Header ===
function DashboardHeader({ countdown, lastRefresh, onRefresh, isLoading, connectionStatus, isDark, toggleDark, crestPct, crestLabel, basinTrend }: {
  countdown: number; lastRefresh: Date; onRefresh: () => void; isLoading: boolean;
  connectionStatus: "live" | "stale" | "offline"; isDark: boolean; toggleDark: () => void;
  crestPct: number | null; crestLabel: string; basinTrend: string;
}) {
  const statusColors = { live: "bg-emerald-400", stale: "bg-amber-400", offline: "bg-red-500" };
  const statusLabels = { live: "Live", stale: "Stale", offline: "Offline" };
  const waveClass = basinTrend === "Loading" ? "header-river-loading" : basinTrend === "Draining" ? "header-river-draining" : "";
  const waveFill = basinTrend === "Loading" ? "hsl(12, 80%, 55%)" : basinTrend === "Draining" ? "hsl(173, 58%, 45%)" : "hsl(195, 80%, 45%)";
  const waveHeight = crestPct === null ? 8 : Math.max(6, Math.min(18, 6 + (crestPct / 100) * 12));

  return (
    <header className="border-b border-border bg-card px-4 py-3">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Waves className="h-7 w-7 text-primary" />
          <div>
            <h1 className="text-lg font-bold tracking-tight">BGM Flood Monitor</h1>
            <p className="text-xs text-muted-foreground">Binghamton Basin Compound Flood Risk</p>
            <div className={`header-river mt-1 w-40 ${waveClass}`} aria-hidden="true">
              <svg viewBox="0 0 480 22" preserveAspectRatio="none">
                <path
                  d={`M0 ${22 - waveHeight} Q 20 ${22 - waveHeight - 4} 40 ${22 - waveHeight} T 80 ${22 - waveHeight} T 120 ${22 - waveHeight} T 160 ${22 - waveHeight} T 200 ${22 - waveHeight} T 240 ${22 - waveHeight} V 22 H 0 Z`}
                  fill={waveFill} opacity="0.85" />
                <path
                  d={`M240 ${22 - waveHeight} Q 260 ${22 - waveHeight - 4} 280 ${22 - waveHeight} T 320 ${22 - waveHeight} T 360 ${22 - waveHeight} T 400 ${22 - waveHeight} T 440 ${22 - waveHeight} T 480 ${22 - waveHeight} V 22 H 240 Z`}
                  fill={waveFill} opacity="0.85" />
              </svg>
            </div>
            <p className="text-[10px] text-muted-foreground">{crestLabel}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <div className={`h-2 w-2 rounded-full ${statusColors[connectionStatus]} animate-pulse`} />
            <span>{statusLabels[connectionStatus]}</span>
          </div>
          <div className="text-xs text-muted-foreground">
            Next: {formatCountdown(countdown)}
          </div>
          <div className="text-xs text-muted-foreground">
            Updated: {lastRefresh.getTime() ? lastRefresh.toLocaleTimeString() : "Checking"}
          </div>
          <Button variant="outline" size="sm" onClick={onRefresh} disabled={isLoading}>
            <RefreshCw className={`h-3.5 w-3.5 mr-1 ${isLoading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={toggleDark} aria-label="Toggle light and dark theme">
            {isDark ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </div>
    </header>
  );
}

// === Section Label divider for right column ===
function SectionLabel({ label }: { label: string }) {
  return (
    <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50 px-1 pt-3 pb-1">
      {label}
    </div>
  );
}

// === KPI Cards (v2: discharge-weighted basin trend, QPF countdown) ===
function KPICards({ gaugesResp, weather, outlookData }: { gaugesResp: GaugesResponse | undefined; weather: WeatherData | undefined; outlookData?: PredictiveOutlook }) {
  const gauges = gaugesResp?.gauges || [];
  const onlineGauges = gauges.filter(g => !g.isOffline && !g.isReservoir);

  // Highest stage relative to action
  const highestPct = onlineGauges.reduce((best, g) => {
    if (g.stage === null || !g.thresholds.action) return best;
    const pct = (g.stage / g.thresholds.action) * 100;
    return pct > best.pct ? { name: g.name, pct, stage: g.stage, action: g.thresholds.action } : best;
  }, { name: "N/A", pct: 0, stage: 0, action: 0 });

  // Basin trend (v2: discharge-weighted from backend)
  const bt = gaugesResp?.basinTrend;
  const btDirection = bt?.direction || "N/A";
  const btColor = btDirection === "Loading" ? "text-red-400" : btDirection === "Draining" ? "text-emerald-400" : "text-blue-400";
  const btIcon = btDirection === "Loading" ? <TrendingUp className="h-5 w-5" /> : btDirection === "Draining" ? <TrendingDown className="h-5 w-5" /> : <Minus className="h-5 w-5" />;

  // Temp
  const temp = weather?.current?.temp;

  // QPF (v2: countdown + amount)
  const qpf = weather?.qpf;
  let qpfValue = weather ? "None" : "N/A";
  let qpfSub = weather ? "No precip in forecast" : "Forecast unavailable";
  let qpfColor = "text-muted-foreground";
  if (qpf) {
    if (qpf.hoursUntil >= 0) {
      qpfValue = `${qpf.amount} / ${qpf.hoursUntil}h`;
      qpfSub = qpf.description;
      qpfColor = qpf.hoursUntil < 6 ? "text-red-400" : qpf.hoursUntil < 12 ? "text-amber-400" : "text-blue-400";
    } else {
      qpfValue = "Expected";
      qpfSub = qpf.description;
      qpfColor = "text-blue-400";
    }
  }

  // Frost
  const frost = weather?.frostData;
  const frostSig = frost?.significance || "NONE";

  // Data freshness
  const freshCount = onlineGauges.filter(g => freshnessMins(g.lastUpdated) < 120).length;

  // Risk Score from predictive outlook
  const riskScore = outlookData?.compositeScore ?? null;
  const riskLevel = outlookData?.riskLevel ?? null;
  const riskScoreColor = riskLevel === "HIGH" ? "text-red-400" : riskLevel === "ELEVATED" ? "text-orange-400" : riskLevel === "MODERATE" ? "text-amber-400" : riskLevel === "LOW" ? "text-emerald-400" : "text-muted-foreground";

  const kpis: Array<{ label: string; value: string; sub: string; icon: React.ReactNode; color: string }> = [
    {
      label: "Highest Stage",
      value: highestPct.action ? `${Math.round(highestPct.pct)}%` : "N/A",
      sub: highestPct.action ? `${highestPct.name} (${highestPct.stage?.toFixed(1)}/${highestPct.action}ft)` : "No usable stage reading",
      icon: <Activity className="h-5 w-5" />,
      color: highestPct.pct >= 100 ? "text-red-500" : highestPct.pct >= 80 ? "text-amber-400" : "text-emerald-400",
    },
    {
      label: "Basin Trend",
      value: btDirection,
      sub: bt ? `Net: ${bt.netDischarge.toLocaleString()} cfs (w=${bt.weightedTrend.toFixed(2)})` : "Loading...",
      icon: btIcon,
      color: btColor,
    },
    {
      label: "Temperature",
      value: temp !== null && temp !== undefined ? `${temp}°F` : "N/A",
      sub: weather?.current?.conditions || "Loading...",
      icon: <Thermometer className="h-5 w-5" />,
      color: temp !== null && temp !== undefined && temp <= 32 ? "text-blue-400" : "text-foreground",
    },
    {
      label: "QPF",
      value: qpfValue,
      sub: qpfSub,
      icon: <CloudRain className="h-5 w-5" />,
      color: qpfColor,
    },
    {
      label: "Frost Depth",
      value: frost ? `${frost.estimatedDepthInches.toFixed(1)}"` : "N/A",
      sub: frost ? `FDH: ${frost.cumulativeFDH} — ${frostSig}` : "Estimate unavailable",
      icon: <Snowflake className="h-5 w-5" />,
      color: frostSig === "HYDROLOGIC" ? "text-red-400" : frostSig === "NUISANCE" ? "text-amber-400" : "text-muted-foreground",
    },
    {
      label: "Data Fresh",
      value: onlineGauges.length ? `${freshCount}/${onlineGauges.length}` : "N/A",
      sub: onlineGauges.length ? `${onlineGauges.length - freshCount} stale gauge(s)` : "No current gauge data",
      icon: <Wifi className="h-5 w-5" />,
      color: freshCount === onlineGauges.length ? "text-emerald-400" : "text-amber-400",
    },
    {
      label: "Risk Score",
      value: riskScore !== null ? `${riskScore}` : "—",
      sub: riskLevel ? `${riskLevel} risk level` : "Predictive analysis",
      icon: <Brain className="h-5 w-5" />,
      color: riskScoreColor,
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3">
      {kpis.map(kpi => (
        <Card key={kpi.label} className="bg-card border-border">
          <CardContent className="p-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-muted-foreground">{kpi.label}</span>
              <span className={kpi.color}>{kpi.icon}</span>
            </div>
            <div className={`text-xl font-bold tabular-nums ${kpi.color}`}>{kpi.value}</div>
            <div className="text-xs text-muted-foreground truncate">{kpi.sub}</div>
            {kpi.label === "Highest Stage" && highestPct.action > 0 && (
              <div className="relative mt-2 h-1.5 rounded-full bg-muted/60">
                <div className="stage-fill absolute inset-y-0 left-0 rounded-full bg-primary" style={{ width: `${Math.max(4, Math.min(100, highestPct.pct))}%` }} />
              </div>
            )}
            {kpi.label === "Risk Score" && riskScore !== null && (
              <div className="relative mt-2 h-1.5 rounded-full bg-muted/60">
                <div className={`stage-fill absolute inset-y-0 left-0 rounded-full ${riskLevel === "HIGH" ? "bg-red-400" : riskLevel === "ELEVATED" ? "bg-orange-400" : riskLevel === "MODERATE" ? "bg-amber-400" : "bg-emerald-400"}`} style={{ width: `${Math.max(4, Math.min(100, riskScore))}%` }} />
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// === Confluence Sync Panel (v2 feature 4) ===
function ConfluenceSyncPanel({ gaugesResp }: { gaugesResp?: GaugesResponse }) {
  const cs = gaugesResp?.confluenceSync;
  if (!cs) return null;

  const stateConfig: Record<string, { bg: string; border: string; label: string; desc: string; icon: React.ReactNode }> = {
    BOTH_RISING: { bg: "bg-red-500/10", border: "border-red-500/30", label: "Both stems rising", desc: "The Susquehanna at Conklin and the Chenango at Chenango Forks are both rising toward their junction in Binghamton.", icon: <AlertTriangle className="h-5 w-5 text-red-400" /> },
    BOTH_FALLING: { bg: "bg-emerald-500/10", border: "border-emerald-500/30", label: "Both stems falling", desc: "Both rivers above the Binghamton junction are falling.", icon: <CheckCircle className="h-5 w-5 text-emerald-400" /> },
    SUSQ_RISING_CHEN_FALLING: { bg: "bg-amber-500/10", border: "border-amber-500/30", label: "Susquehanna rising", desc: "The Susquehanna at Conklin is rising while the Chenango at Chenango Forks is not.", icon: <ArrowDownUp className="h-5 w-5 text-amber-400" /> },
    CHEN_RISING_SUSQ_FALLING: { bg: "bg-amber-500/10", border: "border-amber-500/30", label: "Chenango rising", desc: "The Chenango at Chenango Forks is rising while the Susquehanna at Conklin is not.", icon: <ArrowDownUp className="h-5 w-5 text-amber-400" /> },
    STABLE: { bg: "bg-blue-500/10", border: "border-blue-500/30", label: "Steady into the junction", desc: "Neither stem shows a rising or falling trend into the Binghamton confluence.", icon: <Minus className="h-5 w-5 text-blue-400" /> },
  };

  const cfg = stateConfig[cs.state] || stateConfig.STABLE;

  return (
    <Card className={`${cfg.bg} ${cfg.border} border`}>
      <CardContent className="p-3">
        <div className="flex items-center gap-3">
          {cfg.icon}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-semibold text-sm">{cfg.label}</span>
              <Badge variant="outline" className="text-[10px]">{cs.riskLevel}</Badge>
            </div>
            <p className="text-xs text-muted-foreground">{cfg.desc}</p>
          </div>
          <div className="text-right text-xs space-y-0.5 shrink-0">
            <div className="flex items-center gap-1 justify-end">
              <span className="text-muted-foreground">Conklin:</span>
              <span className="font-medium">{cs.conklinTrend}</span>
              {trendIcon(cs.conklinTrend)}
            </div>
            <div className="flex items-center gap-1 justify-end">
              <span className="text-muted-foreground">Chenango:</span>
              <span className="font-medium">{cs.chenangoTrend}</span>
              {trendIcon(cs.chenangoTrend)}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// === Whitney Point Dam Card (v2 feature 1) ===
function ReservoirCard({ gauge }: { gauge: GaugeData }) {
  const categories = [
    ["Action", gauge.thresholds.action],
    ["Minor", gauge.thresholds.minor],
    ["Moderate", gauge.thresholds.moderate],
    ["Major", gauge.thresholds.major],
  ].filter((entry): entry is [string, number] => typeof entry[1] === "number");

  return (
    <Card className="bg-card border-border col-span-1">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Gauge className="h-5 w-5 text-primary" />
            <div>
              <h3 className="font-semibold text-sm">{gauge.name}</h3>
              <p className="text-xs text-muted-foreground">{gauge.river}</p>
            </div>
          </div>
          <Badge variant="outline" className="text-xs">
            Observed pool elevation
          </Badge>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-3xl font-bold tabular-nums">
              {gauge.poolElevation?.toFixed(2) ?? "—"}
              <span className="text-sm font-normal ml-1">ft</span>
            </div>
            <div className="mt-2 flex gap-1 flex-wrap">
              {categories.length ? categories.map(([label, stage]) => (
                <Badge key={label} variant="outline" className="text-[10px] px-1 py-0">
                  {label}: {stage} ft
                </Badge>
              )) : (
                <span className="text-xs text-muted-foreground">Official flood categories unavailable</span>
              )}
            </div>
            {gauge.recessionRate !== null && gauge.recessionRate !== undefined && (
              <div className="mt-2 flex items-center gap-2 text-xs">
                <span className="text-muted-foreground">Rate:</span>
                <span className="font-medium">{gauge.recessionRate > 0 ? "↓" : "↑"} {Math.abs(gauge.recessionRate).toFixed(2)} ft/day</span>
              </div>
            )}
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-1">3-Day Pool Elevation</div>
            <MiniSparkline data={gauge.stageTimeSeries} sparkId={gauge.id} />
            <StageTrack stage={gauge.poolElevation ?? null} action={gauge.thresholds.action} minor={gauge.thresholds.minor} />
            <div className="text-xs text-muted-foreground mt-1">
              <Clock className="h-3 w-3 inline mr-0.5" />
              {formatTimeAgo(gauge.lastUpdated)}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// === Historical Percentile Badge for Gauge Cards ===
function HistoricalBadge({ flow, stat }: { flow: number; stat: HistoricalStatEntry }) {
  if (stat.mean === null) return null;
  let pctLabel = "";
  let pctColor = "";
  if (stat.max !== null && flow >= stat.max) { pctLabel = "RECORD"; pctColor = "bg-red-500/30 text-red-300 border-red-500/40"; }
  else if (stat.p95 !== null && flow >= stat.p95) { pctLabel = ">95th"; pctColor = "bg-red-500/20 text-red-400 border-red-500/30"; }
  else if (stat.p90 !== null && flow >= stat.p90) { pctLabel = ">90th"; pctColor = "bg-orange-500/20 text-orange-400 border-orange-500/30"; }
  else if (stat.p75 !== null && flow >= stat.p75) { pctLabel = ">75th"; pctColor = "bg-amber-500/20 text-amber-400 border-amber-500/30"; }
  else if (flow >= stat.mean) { pctLabel = ">Mean"; pctColor = "bg-blue-500/20 text-blue-400 border-blue-500/30"; }
  else { pctLabel = "<Mean"; pctColor = "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"; }

  return (
    <Tooltip>
      <TooltipTrigger>
        <Badge variant="outline" className={`text-[10px] px-1 py-0 border ${pctColor}`}>{pctLabel}</Badge>
      </TooltipTrigger>
      <TooltipContent className="text-xs">
        <div>Today's historical flow ({stat.count || "N/A"} yrs)</div>
        <div>Mean: {stat.mean?.toLocaleString()} cfs</div>
        {stat.p75 !== null && <div>75th: {stat.p75.toLocaleString()} cfs</div>}
        {stat.p90 !== null && <div>90th: {stat.p90.toLocaleString()} cfs</div>}
        {stat.max !== null && <div>Max: {stat.max.toLocaleString()} cfs ({stat.maxYear})</div>}
      </TooltipContent>
    </Tooltip>
  );
}

// === Gauge Card (v2: recession rate + ensemble badge, v3: historical percentile) ===
function GaugeCard({ gauge, expanded, onToggle, ensembleBounds, historicalStat }: {
  gauge: GaugeData; expanded: boolean; onToggle: () => void;
  ensembleBounds?: { p10: number; p50: number; p90: number };
  historicalStat?: HistoricalStatEntry;
}) {
  const mins = freshnessMins(gauge.lastUpdated);
  const freshnessColor = mins > 180 ? "text-red-500" : mins > 120 ? "text-orange-400" : "text-muted-foreground";
  const aboveEnsemble = ensembleBounds && gauge.stage !== null && gauge.stage > ensembleBounds.p10;

  if (gauge.isOffline) {
    return (
      <Card className="bg-card border-border opacity-75">
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-2">
            <div>
              <h3 className="font-semibold text-sm">{gauge.name}</h3>
              <p className="text-xs text-muted-foreground">{gauge.river}</p>
            </div>
            <Badge variant="destructive" className="text-xs">
              <WifiOff className="h-3 w-3 mr-1" /> OFFLINE
            </Badge>
          </div>
          <div className="text-center py-4 text-muted-foreground text-sm">
            No current observation available
          </div>
        </CardContent>
      </Card>
    );
  }

  const phaseColors: Record<string, string> = {
    FAST_RECESSION: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    BASEFLOW: "bg-amber-500/20 text-amber-400 border-amber-500/30",
    LOADING: "bg-red-500/20 text-red-400 border-red-500/30",
  };

  return (
    <Card className="bg-card border-border cursor-pointer transition-all hover:border-primary/30" onClick={onToggle}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h3 className="font-semibold text-sm">{gauge.name}</h3>
            <p className="text-xs text-muted-foreground">{gauge.river}</p>
          </div>
          <div className="flex items-center gap-2">
            {historicalStat && gauge.flow !== null && (
              <HistoricalBadge flow={gauge.flow} stat={historicalStat} />
            )}
            {aboveEnsemble && (
              <Badge variant="destructive" className="text-[10px] px-1 py-0">ABOVE 10% GEFS</Badge>
            )}
            {trendIcon(gauge.trend)}
            <span className="text-xs text-muted-foreground">{gauge.trend}</span>
          </div>
        </div>
        <div className="flex items-end justify-between">
          <div>
            <div className={`text-3xl font-bold tabular-nums ${stageColor(gauge.stage, gauge.thresholds)}`}>
              {gauge.stage !== null ? gauge.stage.toFixed(2) : "—"}
              <span className="text-sm font-normal ml-1">ft</span>
            </div>
            <div className="text-sm text-muted-foreground">
              {gauge.flow !== null ? `${Math.round(gauge.flow).toLocaleString()} cfs` : "— cfs"}
            </div>
            {/* v2: Recession rate */}
            {gauge.recessionRate !== null && gauge.recessionRate !== undefined && (
              <div className="flex items-center gap-1.5 mt-1">
                <span className="text-xs text-muted-foreground">
                  {gauge.recessionRate > 0 ? "↓" : "↑"} {Math.abs(gauge.recessionRate).toFixed(2)} ft/day
                </span>
                {gauge.recessionPhase && (
                  <Badge variant="outline" className={`text-[10px] px-1 py-0 border ${phaseColors[gauge.recessionPhase] || ""}`}>
                    {gauge.recessionPhase === "FAST_RECESSION" ? "FAST RECESSION" : gauge.recessionPhase}
                  </Badge>
                )}
              </div>
            )}
          </div>
          <div className="text-right">
            <div className="flex gap-1 flex-wrap justify-end mb-1">
              {gauge.thresholds.action && (
                <Badge variant="outline" className="text-[10px] px-1 py-0 border-amber-500/40 text-amber-400">
                  Act: {gauge.thresholds.action}ft
                </Badge>
              )}
              {gauge.thresholds.minor && (
                <Badge variant="outline" className="text-[10px] px-1 py-0 border-red-500/40 text-red-400">
                  Min: {gauge.thresholds.minor}ft
                </Badge>
              )}
            </div>
            <span className={`text-xs ${freshnessColor}`}>
              <Clock className="h-3 w-3 inline mr-0.5" />
              {formatTimeAgo(gauge.lastUpdated)}
            </span>
          </div>
        </div>
        <div className="mt-2">
          <MiniSparkline data={gauge.stageTimeSeries} thresholdAction={gauge.thresholds.action} sparkId={gauge.id} />
          <StageTrack stage={gauge.stage} action={gauge.thresholds.action} minor={gauge.thresholds.minor} />
        </div>
        {expanded && (
          <div className="mt-3 pt-3 border-t border-border">
            <h4 className="text-xs font-semibold mb-2 text-muted-foreground">3-Day Stage History</h4>
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={gauge.stageTimeSeries.filter(p => p.value !== null).map(p => ({
                time: new Date(p.timestamp).getTime(),
                stage: p.value,
              }))} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(210, 15%, 20%)" />
                <XAxis dataKey="time" type="number" domain={["dataMin", "dataMax"]}
                  tickFormatter={(v) => new Date(v).toLocaleDateString(undefined, { weekday: "short", hour: "numeric" })}
                  tick={{ fontSize: 10, fill: "hsl(210, 10%, 60%)" }} />
                <YAxis tick={{ fontSize: 10, fill: "hsl(210, 10%, 60%)" }} />
                <RechartsTooltip
                  contentStyle={{ background: "hsl(210, 20%, 11%)", border: "1px solid hsl(210, 20%, 20%)", borderRadius: 8, fontSize: 12 }}
                  labelFormatter={(v) => new Date(v).toLocaleString()} />
                <Area type="monotone" dataKey="stage" stroke="hsl(195, 80%, 45%)" fill="hsl(195, 80%, 45%)" fillOpacity={0.15} strokeWidth={2} dot={false} />
                {gauge.thresholds.action && <ReferenceLine y={gauge.thresholds.action} stroke="hsl(38, 90%, 55%)" strokeDasharray="5 5" label={{ value: "Action", fill: "hsl(38, 90%, 55%)", fontSize: 10 }} />}
                {gauge.thresholds.minor && <ReferenceLine y={gauge.thresholds.minor} stroke="hsl(0, 80%, 55%)" strokeDasharray="5 5" label={{ value: "Minor", fill: "hsl(0, 80%, 55%)", fontSize: 10 }} />}
                {ensembleBounds && <ReferenceLine y={ensembleBounds.p10} stroke="hsl(0, 70%, 50%)" strokeDasharray="3 6" label={{ value: "10% GEFS", fill: "hsl(0, 70%, 50%)", fontSize: 9 }} />}
                {ensembleBounds && <ReferenceLine y={ensembleBounds.p50} stroke="hsl(210, 70%, 55%)" strokeDasharray="3 6" label={{ value: "50% GEFS", fill: "hsl(210, 70%, 55%)", fontSize: 9 }} />}
              </AreaChart>
            </ResponsiveContainer>
            <h4 className="text-xs font-semibold mb-2 mt-3 text-muted-foreground">3-Day Flow History</h4>
            <ResponsiveContainer width="100%" height={140}>
              <AreaChart data={gauge.flowTimeSeries.filter(p => p.value !== null).map(p => ({
                time: new Date(p.timestamp).getTime(),
                flow: p.value,
              }))} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(210, 15%, 20%)" />
                <XAxis dataKey="time" type="number" domain={["dataMin", "dataMax"]}
                  tickFormatter={(v) => new Date(v).toLocaleDateString(undefined, { weekday: "short", hour: "numeric" })}
                  tick={{ fontSize: 10, fill: "hsl(210, 10%, 60%)" }} />
                <YAxis tick={{ fontSize: 10, fill: "hsl(210, 10%, 60%)" }} />
                <RechartsTooltip
                  contentStyle={{ background: "hsl(210, 20%, 11%)", border: "1px solid hsl(210, 20%, 20%)", borderRadius: 8, fontSize: 12 }}
                  labelFormatter={(v) => new Date(v).toLocaleString()} />
                <Area type="monotone" dataKey="flow" stroke="hsl(173, 58%, 50%)" fill="hsl(173, 58%, 50%)" fillOpacity={0.15} strokeWidth={2} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// === Full Stage Chart (v2: ensemble reference lines) ===
function StageChart({ gauges, ensembleBounds }: { gauges: GaugeData[]; ensembleBounds?: EnsembleData["ensembleBounds"] }) {
  const online = gauges.filter(g => !g.isOffline && !g.isReservoir && g.stageTimeSeries.length > 0);
  if (online.length === 0) return null;

  const allTimes = new Set<number>();
  for (const g of online) {
    for (const p of g.stageTimeSeries) {
      if (p.value !== null) allTimes.add(new Date(p.timestamp).getTime());
    }
  }
  const sortedTimes = Array.from(allTimes).sort((a, b) => a - b);
  const step = Math.max(1, Math.floor(sortedTimes.length / 300));
  const sampledTimes = sortedTimes.filter((_, i) => i % step === 0);

  const chartData = sampledTimes.map(t => {
    const row: Record<string, any> = { time: t };
    for (const g of online) {
      const closest = g.stageTimeSeries.reduce((best, p) => {
        if (p.value === null) return best;
        const d = Math.abs(new Date(p.timestamp).getTime() - t);
        return d < best.d ? { v: p.value, d } : best;
      }, { v: null as number | null, d: Infinity });
      if (closest.d < 3600000) row[g.name] = closest.v;
    }
    return row;
  });

  const colors = GAUGE_COLORS;

  // Collect ensemble p10 lines for displayed gauges
  const ensembleLines: Array<{ value: number; label: string; color: string }> = [];
  if (ensembleBounds) {
    for (const g of online) {
      const eb = ensembleBounds[g.id];
      if (eb) {
        ensembleLines.push({ value: eb.p10, label: `${g.name} 10%`, color: "hsl(0, 60%, 45%)" });
      }
    }
  }

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Stage History — All Gauges (3 Day)</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(210, 15%, 20%)" />
            <XAxis dataKey="time" type="number" domain={["dataMin", "dataMax"]}
              tickFormatter={(v) => new Date(v).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "numeric" })}
              tick={{ fontSize: 10, fill: "hsl(210, 10%, 60%)" }} />
            <YAxis tick={{ fontSize: 10, fill: "hsl(210, 10%, 60%)" }} label={{ value: "Stage (ft)", angle: -90, position: "insideLeft", style: { fontSize: 10, fill: "hsl(210, 10%, 60%)" } }} />
            <RechartsTooltip
              contentStyle={{ background: "hsl(210, 20%, 11%)", border: "1px solid hsl(210, 20%, 20%)", borderRadius: 8, fontSize: 12 }}
              labelFormatter={(v) => new Date(v).toLocaleString()} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {online.map((g, i) => (
              <Line key={g.id} type="monotone" dataKey={g.name} stroke={colors[i % colors.length]}
                strokeWidth={2} dot={false} connectNulls isAnimationActive animationDuration={700} />
            ))}
            {ensembleLines.map((el, i) => (
              <ReferenceLine key={`ens-${i}`} y={el.value} stroke={el.color} strokeDasharray="4 6" strokeWidth={1}
                label={{ value: el.label, fill: el.color, fontSize: 9, position: "right" }} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

function FlowChart({ gauges, ensembleData }: { gauges: GaugeData[]; ensembleData?: any }) {
  const [showEnsembles, setShowEnsembles] = useState(false);
  const online = gauges.filter(g => !g.isOffline && !g.isReservoir && g.flowTimeSeries.length > 0);
  if (online.length === 0) return null;

  const allTimes = new Set<number>();
  for (const g of online) {
    for (const p of g.flowTimeSeries) {
      if (p.value !== null) allTimes.add(new Date(p.timestamp).getTime());
    }
  }
  const sortedTimes = Array.from(allTimes).sort((a, b) => a - b);
  const step = Math.max(1, Math.floor(sortedTimes.length / 300));
  const sampledTimes = sortedTimes.filter((_, i) => i % step === 0);

  const chartData = sampledTimes.map(t => {
    const row: Record<string, any> = { time: t };
    for (const g of online) {
      const closest = g.flowTimeSeries.reduce((best, p) => {
        if (p.value === null) return best;
        const d = Math.abs(new Date(p.timestamp).getTime() - t);
        return d < best.d ? { v: p.value, d } : best;
      }, { v: null as number | null, d: Infinity });
      if (closest.d < 3600000) row[g.name] = closest.v;
    }
    return row;
  });

  const colors = GAUGE_COLORS;

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Discharge History — All Gauges (3 Day)</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={250}>
          <LineChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(210, 15%, 20%)" />
            <XAxis dataKey="time" type="number" domain={["dataMin", "dataMax"]}
              tickFormatter={(v) => new Date(v).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "numeric" })}
              tick={{ fontSize: 10, fill: "hsl(210, 10%, 60%)" }} />
            <YAxis tick={{ fontSize: 10, fill: "hsl(210, 10%, 60%)" }} label={{ value: "Flow (cfs)", angle: -90, position: "insideLeft", style: { fontSize: 10, fill: "hsl(210, 10%, 60%)" } }} />
            <RechartsTooltip
              contentStyle={{ background: "hsl(210, 20%, 11%)", border: "1px solid hsl(210, 20%, 20%)", borderRadius: 8, fontSize: 12 }}
              labelFormatter={(v) => new Date(v).toLocaleString()} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {online.map((g, i) => (
              <Line key={g.id} type="monotone" dataKey={g.name} stroke={colors[i % colors.length]}
                strokeWidth={2} dot={false} connectNulls isAnimationActive animationDuration={700} />
            ))}
          </LineChart>
        </ResponsiveContainer>
        {ensembleData?.flowEnsembles?.length > 0 && (
          <div className="mt-3 border-t border-border pt-2 text-xs">
            <button type="button" className="text-primary py-2" onClick={() => setShowEnsembles(v => !v)}>
              {showEnsembles ? "Hide" : "Show"} NOAA HEFS flow guidance · next 72h
            </button>
            {showEnsembles && (
              <>
                <p className="text-muted-foreground mb-2">10% / 50% / 90% exceedance flow, in cfs. These are not crest probabilities or stage heights.</p>
                {ensembleData.flowEnsembles.map((site: any) => {
                  const points = (site.points || []).map((p: any) => ({ time: new Date(p.time).getTime(), p10: p.p10, p50: p.p50, p90: p.p90 }));
                  return (
                    <div key={site.id} className="py-2 border-b border-border">
                      <div className="font-medium">{site.name}</div>
                      <div className="text-muted-foreground">Issued: {site.issuedAt ? new Date(site.issuedAt).toLocaleString() : "not reported"}</div>
                      {site.stale || points.length < 2 ? <div>Current guidance unavailable</div> : (
                        <ResponsiveContainer width="100%" height={90}>
                          <LineChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                            <XAxis dataKey="time" type="number" domain={["dataMin", "dataMax"]} hide />
                            <RechartsTooltip
                              contentStyle={{ background: "hsl(210, 20%, 11%)", border: "1px solid hsl(210, 20%, 20%)", borderRadius: 8, fontSize: 11 }}
                              labelFormatter={(v) => new Date(v as number).toLocaleString()}
                              formatter={(v: any, name: any) => [`${Math.round(Number(v)).toLocaleString()} cfs`, name]} />
                            <Line type="monotone" dataKey="p90" stroke="hsl(210, 15%, 55%)" strokeWidth={1} dot={false} name="90%" />
                            <Line type="monotone" dataKey="p50" stroke="hsl(195, 80%, 55%)" strokeWidth={2} dot={false} name="50%" />
                            <Line type="monotone" dataKey="p10" stroke="hsl(12, 80%, 60%)" strokeWidth={1} dot={false} name="10%" />
                          </LineChart>
                        </ResponsiveContainer>
                      )}
                    </div>
                  );
                })}
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// === V3: Groundwater Panel ===
function GroundwaterPanel({ data }: { data?: GroundwaterData }) {
  if (!data) return null;
  const depth = data.depth;
  const depthColor = depth === null ? "text-muted-foreground" :
    depth < 2 ? "text-red-400" : depth < 5 ? "text-orange-400" : depth < 10 ? "text-amber-400" : "text-emerald-400";

  return (
    <Card className="bg-card border-border">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-primary" />
            <div>
              <h3 className="font-semibold text-sm">Groundwater</h3>
              <p className="text-[10px] text-muted-foreground">Cn-12, Bainbridge floodplain</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {trendIcon(data.trend)}
            <span className="text-xs text-muted-foreground">{data.trend}</span>
          </div>
        </div>
        <div className="flex items-end justify-between">
          <div>
            <div className={`text-2xl font-bold tabular-nums ${depthColor}`}>
              {depth !== null ? depth.toFixed(2) : "—"}
              <span className="text-sm font-normal ml-1">ft depth</span>
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">{data.interpretation}</div>
          </div>
          <div className="text-right text-xs text-muted-foreground">
            <Clock className="h-3 w-3 inline mr-0.5" />
            {formatTimeAgo(data.lastUpdated)}
          </div>
        </div>
        {data.timeSeries.length > 0 && (
          <div className="mt-2">
            <div className="text-[10px] text-muted-foreground mb-1">7-Day Water Table</div>
            <MiniSparkline data={data.timeSeries} sparkId="groundwater" />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// === V3: Soil Moisture Panel ===
function SoilMoisturePanel({ data }: { data?: SoilMoisture }) {
  if (!data) return null;
  const pct = data.percentile;
  const pctColor = pct === null ? "text-muted-foreground" :
    pct > 90 ? "text-red-400" : pct > 70 ? "text-orange-400" : pct > 30 ? "text-emerald-400" : "text-amber-400";
  const barColor = pct === null ? "bg-muted" :
    pct > 90 ? "bg-red-500" : pct > 70 ? "bg-orange-500" : pct > 30 ? "bg-emerald-500" : "bg-amber-500";

  return (
    <Card className="bg-card border-border">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-2">
          <Droplets className="h-4 w-4 text-primary" />
          <div>
            <h3 className="font-semibold text-sm">Soil Moisture</h3>
            <p className="text-[10px] text-muted-foreground">CPC Percentile — Binghamton area</p>
          </div>
        </div>
        <div className="flex items-end justify-between mb-2">
          <div>
            <div className={`text-2xl font-bold tabular-nums ${pctColor}`}>
              {pct !== null ? `${pct.toFixed(0)}th` : "—"}
              <span className="text-sm font-normal ml-1">percentile</span>
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">{data.interpretation}</div>
          </div>
          {data.date && <div className="text-xs text-muted-foreground">{data.date}</div>}
        </div>
        <div className="h-2.5 bg-muted rounded-full overflow-hidden">
          <div className={`h-full ${barColor} rounded-full transition-all`} style={{ width: `${Math.min(100, pct || 0)}%` }} />
        </div>
        {data.error && <div className="text-[10px] text-amber-400 mt-1">{data.error}</div>}
      </CardContent>
    </Card>
  );
}

// === V3: Atmospheric Conditions Panel ===
function AtmosphericPanel({ surfaceObs: obs, gridpoint }: { surfaceObs?: SurfaceObs; gridpoint?: GridpointData }) {
  if (!obs && !gridpoint) return null;

  const qpfData = gridpoint?.qpfTimeline?.map(p => ({
    time: new Date(p.time).getTime(),
    precip: p.value,
  })) || [];

  const totalQPF = (gridpoint as any)?.precipitation?.next48h?.inches ?? null;

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Wind className="h-4 w-4" />
          Atmospheric Conditions
          {obs?.isRaining && <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30 border text-[10px]">RAIN</Badge>}
          {obs?.isSnowing && <Badge className="bg-cyan-500/20 text-cyan-400 border-cyan-500/30 border text-[10px]">SNOW</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {obs && (
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div className="bg-accent/50 rounded p-2">
              <div className="text-muted-foreground">Dewpoint</div>
              <div className="font-bold text-lg">{obs.dewpoint !== null ? `${obs.dewpoint}°F` : "N/A"}</div>
            </div>
            <div className="bg-accent/50 rounded p-2">
              <div className="text-muted-foreground">Dew Depression</div>
              <div className={`font-bold text-lg ${obs.dewpointDepression !== null && obs.dewpointDepression < 5 ? "text-amber-400" : ""}`}>
                {obs.dewpointDepression !== null ? `${obs.dewpointDepression}°F` : "N/A"}
              </div>
            </div>
            <div className="bg-accent/50 rounded p-2">
              <div className="text-muted-foreground">Visibility</div>
              <div className="font-bold text-lg">{obs.visibility !== null ? `${obs.visibility} mi` : "N/A"}</div>
            </div>
            <div className="bg-accent/50 rounded p-2">
              <div className="text-muted-foreground">Wind</div>
              <div className="font-medium">{obs.windSpeed !== null ? `${obs.windSpeed} mph ${obs.windDirectionCardinal || ""}` : "Calm"}</div>
              {obs.windGust !== null && <div className="text-muted-foreground">Gust: {obs.windGust} mph</div>}
            </div>
            <div className="bg-accent/50 rounded p-2">
              <div className="text-muted-foreground">Humidity</div>
              <div className="font-bold text-lg">{obs.relativeHumidity !== null ? `${obs.relativeHumidity}%` : "N/A"}</div>
            </div>
            <div className="bg-accent/50 rounded p-2">
              <div className="text-muted-foreground">Conditions</div>
              <div className="font-medium">{obs.textDescription || "N/A"}</div>
            </div>
          </div>
        )}

        {gridpoint?.rainSnowTransition && (
          <div className="bg-cyan-500/10 border border-cyan-500/20 rounded-lg p-2 text-xs">
            <span className="font-semibold text-cyan-400">Rain/Snow Transition:</span>{" "}
            <span className="text-muted-foreground">
              {gridpoint.rainSnowTransition.hoursUntil > 0
                ? `In ~${gridpoint.rainSnowTransition.hoursUntil}h`
                : "Now"}
            </span>
          </div>
        )}

        {qpfData.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-semibold text-muted-foreground">48hr QPF Forecast</span>
              <Badge variant="outline" className="text-[10px]">{totalQPF === null ? "Total unavailable" : `${totalQPF.toFixed(2)} in · next 48h`}</Badge>
            </div>
            <ResponsiveContainer width="100%" height={100}>
              <BarChart data={qpfData} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
                <Bar dataKey="precip" fill="hsl(195, 80%, 45%)" radius={[2, 2, 0, 0]} />
                <XAxis dataKey="time" type="number" domain={["dataMin", "dataMax"]}
                  tickFormatter={(v) => new Date(v).toLocaleDateString(undefined, { weekday: "short", hour: "numeric" })}
                  tick={{ fontSize: 9, fill: "hsl(210, 10%, 60%)" }} />
                <RechartsTooltip
                  contentStyle={{ background: "hsl(210, 20%, 11%)", border: "1px solid hsl(210, 20%, 20%)", borderRadius: 8, fontSize: 11 }}
                  labelFormatter={(v) => new Date(v as number).toLocaleString()}
                  formatter={(v: any) => [`${Number(v).toFixed(3)} in`, "QPF"]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// === V3: Radar Panel ===
function RadarPanel() {
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => setRefreshKey(k => k + 1), 300000);
    return () => clearInterval(interval);
  }, []);

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Radio className="h-4 w-4" />
            NEXRAD Radar
          </CardTitle>
          <Button variant="ghost" size="sm" className="h-6 px-2" onClick={() => setRefreshKey(k => k + 1)}>
            <RefreshCw className="h-3 w-3" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="relative bg-muted/30 rounded-lg overflow-hidden">
          <img
            src={`/api/radar-image?fresh=1&_=${refreshKey}`}
            alt="NEXRAD radar over Broome County, New York"
            className="w-full h-auto"
            style={{ minHeight: 200 }}
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
          <div className="absolute bottom-1 left-1 text-[9px] bg-black/60 px-1.5 py-0.5 rounded text-white/70">
            NEXRAD framed on Broome County, NY
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// === V3: SPC Upper Air Images ===
function SPCImagesPanel() {
  const [activeTab, setActiveTab] = useState<"pwat" | "850mb">("pwat");

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Mountain className="h-4 w-4" />
            Upper Air Analysis
          </CardTitle>
          <div className="flex gap-1">
            <Button variant={activeTab === "pwat" ? "default" : "ghost"} size="sm" className="h-6 px-2 text-xs"
              onClick={() => setActiveTab("pwat")}>PWAT</Button>
            <Button variant={activeTab === "850mb" ? "default" : "ghost"} size="sm" className="h-6 px-2 text-xs"
              onClick={() => setActiveTab("850mb")}>850mb</Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="bg-muted/30 rounded-lg overflow-hidden">
          <img
            src={`/api/spc-images/${activeTab}`}
            alt={activeTab === "pwat" ? "Precipitable Water" : "850mb Analysis"}
            className="w-full h-auto"
            style={{ minHeight: 180 }}
          />
        </div>
        <p className="text-[10px] text-muted-foreground mt-1">
          {activeTab === "pwat" ? "Precipitable Water — SPC Mesoanalysis Sector 14 (NE US)" : "850mb Wind/Temperature — SPC Mesoanalysis Sector 14 (NE US)"}
        </p>
      </CardContent>
    </Card>
  );
}

// === V3: Confluence Hydraulics Panel ===
function stemLine(gauge?: GaugeData) {
  if (!gauge || gauge.stage === null) return "stage unavailable";
  const flow = gauge.flow !== null ? ` · ${Math.round(gauge.flow).toLocaleString()} cfs` : "";
  return `${gauge.stage.toFixed(2)} ft · ${gauge.trend}${flow}`;
}

function nextImpact(gauge?: GaugeData) {
  if (!gauge || gauge.stage === null || !gauge.impacts?.length) return null;
  return gauge.impacts.find(impact => impact.stage > gauge.stage!) ?? null;
}

function ConfluenceHydraulicsPanel({ gaugesResp }: { gaugesResp?: GaugesResponse }) {
  if (!gaugesResp) return null;
  const gauges = gaugesResp.gauges;
  const conklin = gauges.find(g => g.id === "01503000");
  const chenango = gauges.find(g => g.id === "01512500");
  const binghamton = gauges.find(g => g.id === "01503500");
  const vestal = gauges.find(g => g.id === "01513500");
  const gaugedInflow = conklin?.flow != null && chenango?.flow != null ? conklin.flow + chenango.flow : null;
  const places = [chenango, binghamton, conklin].filter((gauge): gauge is GaugeData => !!gauge);
  const upcoming = places.map(gauge => ({ gauge, impact: nextImpact(gauge) })).filter(item => item.impact);

  return (
    <Card className="bg-card border-border">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <ArrowDownUp className="h-4 w-4 text-primary" />
          <h3 className="font-semibold text-sm">Where the rivers meet</h3>
        </div>
        <p className="text-xs text-muted-foreground">
          The Chenango comes south through Chenango Forks and joins the Susquehanna in Binghamton. The Susquehanna arrives from Windsor and Conklin, on the east. The Binghamton gauge sits on the Susquehanna just downstream of that junction. Vestal is the next gauge downstream, to the west.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
          <div className="rounded bg-emerald-500/10 p-2">
            <div className="text-muted-foreground">Chenango, upstream</div>
            <div className="font-medium">Chenango Forks</div>
            <div>{stemLine(chenango)}</div>
          </div>
          <div className="rounded bg-amber-500/10 p-2">
            <div className="text-muted-foreground">Junction gauge</div>
            <div className="font-medium">Binghamton</div>
            <div>{stemLine(binghamton)}</div>
          </div>
          <div className="rounded bg-sky-500/10 p-2">
            <div className="text-muted-foreground">Susquehanna, upstream</div>
            <div className="font-medium">Conklin</div>
            <div>{stemLine(conklin)}</div>
          </div>
        </div>
        <div className="text-xs text-muted-foreground">
          {gaugedInflow !== null
            ? `Gauged flow on the two stems is ${Math.round(gaugedInflow).toLocaleString()} cfs. That sum is not the Binghamton discharge: Castle Creek and other ungauged tributaries join before the city gauge, and the stems do not arrive at the same moment.`
            : "Combined stem flow is unavailable until both Conklin and Chenango Forks report discharge."}
          {binghamton?.flow != null ? ` Binghamton is observing ${Math.round(binghamton.flow).toLocaleString()} cfs.` : ""}
          {vestal?.flow != null ? ` Vestal, downstream, is ${Math.round(vestal.flow).toLocaleString()} cfs (${vestal.trend}).` : ""}
        </div>
        {upcoming.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs font-medium">Next published impact above the current stage</div>
            {upcoming.map(({ gauge, impact }) => (
              <div key={gauge.id} className="rounded border border-border bg-accent/30 p-2 text-xs">
                <div className="font-medium">{gauge.name} at {impact!.stage} ft</div>
                <p className="mt-1 text-muted-foreground">{impact!.statement}</p>
              </div>
            ))}
          </div>
        )}
        {binghamton?.recordCrest && (
          <div className="text-[11px] text-muted-foreground">
            Binghamton record crest on file: {binghamton.recordCrest.stage} ft on {new Date(binghamton.recordCrest.occurredTime).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// === Compound Risk Panel (v2: frost depth sub-card, remove Whitney Point data gap) ===
function CompoundRiskPanel({ gauges, weather, groundwater, soilMoisture }: {
  gauges?: GaugeData[]; weather?: WeatherData; groundwater?: GroundwaterData; soilMoisture?: SoilMoisture;
}) {
  const onlineGauges = (gauges || []).filter(g => !g.isOffline && !g.isReservoir);
  const anyAboveAction = onlineGauges.some(g => g.stage !== null && g.thresholds.action && g.stage >= g.thresholds.action);
  const anyNearAction = onlineGauges.some(g => g.stage !== null && g.thresholds.action && g.stage >= g.thresholds.action - 2);
  const frost = weather?.frostData;
  const frostRisk = frost && frost.significance !== "NONE";
  const precipExpected = weather?.forecast?.some(p => p.shortForecast.match(/rain|snow|shower/i));
  const gwSaturated = groundwater && groundwater.depth !== null && groundwater.depth < 3;
  const soilWet = soilMoisture && soilMoisture.percentile !== null && soilMoisture.percentile > 70;

  let riskLevel: "LOW" | "MODERATE" | "ELEVATED" | "HIGH" = "LOW";
  if (anyAboveAction) riskLevel = "HIGH";
  else if (anyNearAction && (frostRisk || precipExpected)) riskLevel = "ELEVATED";
  else if (gwSaturated && precipExpected) riskLevel = "ELEVATED";
  else if (frostRisk || precipExpected || anyNearAction || soilWet) riskLevel = "MODERATE";

  const riskColors = {
    LOW: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    MODERATE: "bg-amber-500/20 text-amber-400 border-amber-500/30",
    ELEVATED: "bg-orange-500/20 text-orange-400 border-orange-500/30",
    HIGH: "bg-red-500/20 text-red-400 border-red-500/30",
  };

  const riskFactors = [
    { label: "Main-stem stage", status: anyAboveAction ? "At or above an official action stage" : anyNearAction ? "Within 2 ft of an action stage" : "Below action stage", active: anyAboveAction || anyNearAction },
    { label: "Groundwater", status: gwSaturated ? `Shallow — ${groundwater?.depth?.toFixed(1)} ft to the water table` : groundwater?.depth !== null && groundwater?.depth !== undefined ? `${groundwater.depth.toFixed(1)} ft to the water table` : "Unknown", active: !!gwSaturated },
    { label: "Soil moisture", status: soilWet ? `${soilMoisture?.percentile?.toFixed(0)}th percentile — less room for rain to soak in` : soilMoisture?.percentile !== null && soilMoisture?.percentile !== undefined ? `${soilMoisture.percentile.toFixed(0)}th percentile` : "Unknown", active: !!soilWet },
    { label: "Precipitation", status: precipExpected ? "Rain or snow is in the forecast" : "No rain or snow named in the forecast period", active: !!precipExpected },
    { label: "Frozen ground", status: frostRisk && precipExpected ? "Frost estimate plus precipitation in the forecast" : frostRisk ? "Frost estimate is present, without forecast precipitation" : "No hydrologic frost signal", active: !!(frostRisk && precipExpected) },
    { label: "Runoff response", status: frostRisk ? "Frozen ground would shed rain instead of soaking it in" : gwSaturated ? "A shallow water table leaves less room for infiltration" : "No frozen-ground or shallow-water-table signal", active: !!(frostRisk || gwSaturated) },
    { label: "Small tributaries", status: "Castle Creek and Thomas Creek are not in this gauge set", active: !!precipExpected },
  ];

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">Compound Risk Assessment</CardTitle>
          <Badge className={`${riskColors[riskLevel]} border text-xs font-bold`}>{riskLevel}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {/* v2: Frost Depth Sub-Card */}
        {frost && (
          <div className={`rounded-lg p-2.5 border text-xs ${
            frost.significance === "HYDROLOGIC" ? "bg-red-500/10 border-red-500/30" :
            frost.significance === "NUISANCE" ? "bg-amber-500/10 border-amber-500/30" :
            "bg-muted/30 border-border"
          }`}>
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-1.5 font-semibold">
                <Snowflake className="h-3.5 w-3.5" />
                Frost Depth Estimate
              </div>
              <Badge variant="outline" className={`text-[10px] px-1 py-0 ${
                frost.significance === "HYDROLOGIC" ? "border-red-500/40 text-red-400" :
                frost.significance === "NUISANCE" ? "border-amber-500/40 text-amber-400" :
                "border-emerald-500/40 text-emerald-400"
              }`}>
                {frost.significance}
              </Badge>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <span className="text-muted-foreground">Depth:</span>{" "}
                <span className="font-medium">{frost.estimatedDepthInches.toFixed(1)} inches</span>
              </div>
              <div>
                <span className="text-muted-foreground">FDH:</span>{" "}
                <span className="font-medium">{frost.cumulativeFDH}</span>
              </div>
            </div>
          </div>
        )}

        {riskFactors.map(f => (
          <div key={f.label} className="flex items-start gap-2 text-xs">
            {f.active ? (
              <AlertTriangle className="h-3.5 w-3.5 text-amber-400 mt-0.5 shrink-0" />
            ) : (
              <CheckCircle className="h-3.5 w-3.5 text-emerald-400 mt-0.5 shrink-0" />
            )}
            <div>
              <span className="font-medium">{f.label}:</span>{" "}
              <span className="text-muted-foreground">{f.status}</span>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

// === Local Reports Panel (v2 feature 8) ===
function LocalReportsPanel({ newsData, isError }: { newsData?: NewsData; isError?: boolean }) {
  const [open, setOpen] = useState(true);
  if (!newsData) return <Card><CardContent className="p-4 text-xs text-muted-foreground">Local Reports & Alerts: {isError ? "NWS feed unavailable; alert status is unconfirmed." : "Checking NWS alerts…"}</CardContent></Card>;

  const severityColors: Record<string, string> = {
    warning: "bg-red-500/20 text-red-400 border-red-500/30",
    watch: "bg-amber-500/20 text-amber-400 border-amber-500/30",
    advisory: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
    info: "bg-blue-500/10 text-blue-300 border-blue-500/20",
  };

  const severityIcons: Record<string, React.ReactNode> = {
    warning: <ShieldAlert className="h-3.5 w-3.5 text-red-400 shrink-0" />,
    watch: <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0" />,
    advisory: <AlertTriangle className="h-3.5 w-3.5 text-yellow-400 shrink-0" />,
    info: <Newspaper className="h-3.5 w-3.5 text-blue-300 shrink-0" />,
  };

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card className="bg-card border-border">
        <CollapsibleTrigger className="w-full">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <Newspaper className="h-4 w-4" />
                Local Reports & Alerts
                {newsData.alerts.length > 0 && (
                  <Badge variant="destructive" className="text-[10px] px-1.5 py-0">{newsData.alerts.length} active</Badge>
                )}
              </CardTitle>
              {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </div>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="space-y-2">
            <p className="text-xs text-muted-foreground">
              {isError || newsData.stale || newsData.error ? "Alert feed is stale or unavailable. Check NWS directly." :
                newsData.alerts.length ? "Active NWS alerts for Broome, Tioga, Chenango and Delaware counties, NY." : "No active NWS alerts returned for the monitored counties. This is not an all-clear for every location."}
            </p>
            {newsData.alerts.map((alert, i) => (
              <div key={`alert-${i}`} className={`rounded-lg p-2.5 border text-xs ${severityColors[alert.severity || "info"]}`}>
                <div className="flex items-start gap-2">
                  {severityIcons[alert.severity || "info"]}
                  <div className="flex-1 min-w-0">
                    <div className="font-medium leading-tight">{alert.headline}</div>
                    <div className="flex items-center gap-2 mt-1 text-muted-foreground flex-wrap">
                      <span>{alert.source}</span>
                      <span>·</span>
                      <span>{new Date(alert.date).toLocaleString()}</span>
                      {alert.expires && <span>· until {new Date(alert.expires).toLocaleString()}</span>}
                      <a href={alert.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline ml-auto">
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                    {alert.area && <div className="text-muted-foreground mt-1">{alert.area}</div>}
                    {alert.description && <p className="mt-1 whitespace-pre-wrap leading-relaxed text-foreground/80">{alert.description}</p>}
                    {alert.instruction && <p className="mt-1 whitespace-pre-wrap leading-relaxed">{alert.instruction}</p>}
                  </div>
                </div>
              </div>
            ))}

            {newsData.alerts.length > 0 && newsData.curatedReports.length > 0 && (
              <div className="border-t border-border my-1" />
            )}

            {newsData.curatedReports.map((item, i) => (
              <div key={`report-${i}`} className="flex items-start gap-2 text-xs p-2 rounded bg-accent/30">
                {severityIcons[item.severity || "info"]}
                <div className="flex-1 min-w-0">
                  <div className="font-medium leading-tight">{item.headline}</div>
                  <div className="flex items-center gap-2 mt-1 text-muted-foreground">
                    <span>{item.source}</span>
                    <span>·</span>
                    <span>{item.date}</span>
                    <a href={item.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline ml-auto">
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

// === Weather Panel ===
function WeatherPanel({ weather }: { weather?: WeatherData }) {
  const [open, setOpen] = useState(true);
  const [selected, setSelected] = useState(0);
  if (!weather) return null;
  const temps = weather.forecast.map(p => p.temp).filter((t): t is number => t !== null);
  const tempMin = temps.length ? Math.min(...temps) : 0;
  const tempMax = temps.length ? Math.max(...temps) : 1;
  const span = Math.max(1, tempMax - tempMin);
  const period = weather.forecast[selected];

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card className="bg-card border-border">
        <CollapsibleTrigger className="w-full">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">NWS Weather</CardTitle>
              {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </div>
            {weather.forecastIssuedAt && (
              <p className="text-[10px] text-muted-foreground text-left">Forecast updated {new Date(weather.forecastIssuedAt).toLocaleString()}</p>
            )}
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="bg-accent/50 rounded p-2">
                <div className="text-muted-foreground">Temperature</div>
                <div className="font-bold text-lg tabular-nums">{weather.current.temp !== null ? `${weather.current.temp}°F` : "N/A"}</div>
              </div>
              <div className="bg-accent/50 rounded p-2">
                <div className="text-muted-foreground">Conditions</div>
                <div className="font-medium">{weather.current.conditions || "N/A"}</div>
              </div>
              <div className="bg-accent/50 rounded p-2">
                <div className="text-muted-foreground">Wind</div>
                <div className="font-medium">{weather.current.windSpeed || "N/A"} {weather.current.windDir || ""}</div>
              </div>
              <div className="bg-accent/50 rounded p-2">
                <div className="text-muted-foreground">Humidity</div>
                <div className="font-medium">{weather.current.humidity !== null ? `${weather.current.humidity}%` : "N/A"}</div>
              </div>
              {weather.current.pressure && (
                <div className="bg-accent/50 rounded p-2 col-span-2">
                  <div className="text-muted-foreground">Pressure</div>
                  <div className="font-medium">{weather.current.pressure} mb</div>
                </div>
              )}
            </div>
            {weather.qpf && (
              <div className="rounded-lg border border-blue-500/20 bg-blue-500/10 p-2 text-xs">
                <div className="font-semibold">Precipitation</div>
                <div>{weather.qpf.hoursUntil >= 0 ? `${weather.qpf.amount} · ${weather.qpf.hoursUntil}h` : weather.qpf.amount}</div>
                <div className="text-muted-foreground">{weather.qpf.description}</div>
              </div>
            )}
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground mb-2">Forecast periods</h4>
              <div className="flex gap-1.5 overflow-x-auto pb-1">
                {weather.forecast.map((p, i) => {
                  const hasPrecip = /rain|snow|shower|thunderstorm|drizzle/i.test(p.shortForecast);
                  const height = p.temp === null ? 12 : 12 + ((p.temp - tempMin) / span) * 36;
                  return (
                    <button
                      key={`${p.name}-${i}`}
                      type="button"
                      onClick={() => setSelected(i)}
                      className={`shrink-0 w-20 rounded-lg border p-1.5 text-left ${i === selected ? "border-primary bg-primary/10" : hasPrecip ? "border-blue-500/30 bg-blue-500/10" : "border-border bg-accent/30"}`}
                    >
                      <div className="text-[10px] leading-tight line-clamp-2 h-8 break-words">{p.name}</div>
                      <div className="mt-1 flex items-end h-12">
                        <div className={`w-full rounded-sm ${p.temp !== null && p.temp <= 32 ? "bg-cyan-400/80" : hasPrecip ? "bg-blue-400/80" : "bg-primary/70"}`} style={{ height }} />
                      </div>
                      <div className={`text-xs font-bold tabular-nums mt-1 ${p.temp !== null && p.temp <= 32 ? "text-cyan-300" : ""}`}>
                        {p.temp !== null ? `${p.temp}°` : "—"}
                      </div>
                      {typeof p.precipProbability === "number" && (
                        <div className="text-[10px] text-blue-300">{p.precipProbability}%</div>
                      )}
                    </button>
                  );
                })}
              </div>
              {period && (
                <div className="mt-2 rounded-lg bg-accent/30 p-2 text-xs">
                  <div className="font-medium">{period.name} · {period.shortForecast}</div>
                  {(period.windSpeed || period.windDirection) && (
                    <div className="text-muted-foreground mt-0.5">Wind {period.windSpeed || ""} {period.windDirection || ""}</div>
                  )}
                  <p className="text-muted-foreground mt-1 leading-relaxed">{period.detailedForecast}</p>
                </div>
              )}
            </div>
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

// === AFD Panel ===
function AFDPanel({ forecast }: { forecast?: ForecastData }) {
  const [open, setOpen] = useState(false);
  if (!forecast) return null;

  const highlightKeywords = (text: string) => {
    return text.replace(/(flood|ice|freeze|rain|snow|runoff|warning|watch|advisory)/gi,
      '<mark class="bg-amber-500/30 text-amber-200 rounded px-0.5">$1</mark>'
    );
  };

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card className="bg-card border-border">
        <CollapsibleTrigger className="w-full">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">Area Forecast Discussion</CardTitle>
              {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </div>
            <p className="text-xs text-muted-foreground text-left">Issued: {forecast.afd.issuedAt}</p>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="space-y-3 text-xs">
            {(forecast.afd.sections?.length ? forecast.afd.sections : [
              forecast.afd.synopsis ? { heading: "Synopsis", text: forecast.afd.synopsis } : null,
              forecast.afd.shortTerm ? { heading: "Short Term", text: forecast.afd.shortTerm } : null,
              forecast.afd.longTerm ? { heading: "Long Term", text: forecast.afd.longTerm } : null,
            ].filter((section): section is { heading: string; text: string } => !!section)).map(section => (
              <div key={section.heading}>
                <h4 className="font-semibold text-muted-foreground mb-1">{section.heading}</h4>
                <p className="text-foreground/80 whitespace-pre-wrap leading-relaxed"
                  dangerouslySetInnerHTML={{ __html: highlightKeywords(section.text) }} />
              </div>
            ))}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

// === Data Source Status (v3: expanded) ===
function DataSourceStatus({ gauges, forecast, weather, ensemble, groundwater, surfaceObs, gridpoint, soilMoisture }: {
  gauges: { isError: boolean };
  forecast: { isError: boolean };
  weather: { isError: boolean };
  ensemble: { isError: boolean };
  groundwater: { isError: boolean };
  surfaceObs: { isError: boolean };
  gridpoint: { isError: boolean };
  soilMoisture: { isError: boolean };
}) {
  const [open, setOpen] = useState(false);
  const sources = [
    { name: "USGS Water Services API", status: gauges.isError ? "error" : "ok", url: "https://waterservices.usgs.gov/nwis/iv/", note: "Real-time gauge data + reservoirs" },
    { name: "NWS Forecast API", status: weather.isError ? "error" : "ok", url: "https://api.weather.gov/", note: "Current conditions, 7-day, hourly QPF" },
    { name: "NWS AFD/RVA", status: forecast.isError ? "error" : "ok", url: "https://forecast.weather.gov/", note: "Forecast discussions" },
    { name: "NOAA HEFS Ensemble", status: ensemble.isError ? "warn" : "ok", url: "https://api.water.noaa.gov/hefs/v1/docs/", note: "Official flow quantiles, next 72 hours" },
    { name: "USGS Groundwater", status: groundwater.isError ? "error" : "ok", url: "https://waterservices.usgs.gov/nwis/iv/", note: "Cn-12 Bainbridge floodplain well" },
    { name: "KBGM Surface Obs", status: surfaceObs.isError ? "error" : "ok", url: "https://api.weather.gov/stations/KBGM", note: "Dewpoint, wind, visibility, precip type" },
    { name: "NWS Gridpoint (BGM)", status: gridpoint.isError ? "error" : "ok", url: "https://api.weather.gov/points/42.0987,-75.9180", note: "Location-resolved QPF, dewpoint, temperature" },
    { name: "CPC Soil Moisture", status: soilMoisture.isError ? "error" : "ok", url: "https://www.cpc.ncep.noaa.gov/", note: "GeoTIFF percentile at Binghamton" },
    { name: "SPC Mesoanalysis", status: "unchecked", url: "https://www.spc.noaa.gov/exper/mesoanalysis/", note: "PWAT + 850mb images; check image availability" },
    { name: "IEM NEXRAD Radar", status: "unchecked", url: "https://mesonet.agron.iastate.edu/", note: "Reflectivity framed on Broome County, NY" },
    { name: "USGS Historical Stats", status: "unchecked", url: "https://waterservices.usgs.gov/nwis/stat/", note: "Daily flow percentiles; not monitored here" },
    { name: "511NY Cameras", status: "unchecked", url: "https://511ny.org/List/Cameras", note: "Basin traffic snapshots; publication time shown per image" },
    { name: "Reddit Community Feed", status: "unchecked", url: "https://www.reddit.com/r/binghamton/", note: "Community reports, not official warnings" },
    { name: "Broadcastify Scanner", status: "unchecked", url: "https://www.broadcastify.com/listen/ctid/1828", note: "External public safety audio; not monitored here" },
  ];

  const statusIcon = (s: string) => {
    switch (s) {
      case "ok": return <CheckCircle className="h-3.5 w-3.5 text-emerald-400" />;
      case "warn": return <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />;
      case "error": return <XCircle className="h-3.5 w-3.5 text-red-500" />;
      case "broken": return <XCircle className="h-3.5 w-3.5 text-red-500/60" />;
      default: return <Clock className="h-3.5 w-3.5 text-muted-foreground" />;
    }
  };

  const errorCount = sources.filter(s => s.status === "error").length;
  const okCount = sources.filter(s => s.status === "ok").length;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card className="bg-card border-border">
        <CollapsibleTrigger className="w-full">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                Data Sources
                <Badge variant="outline" className="text-[10px]">{okCount} feeds checked OK</Badge>
              </CardTitle>
              {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </div>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="space-y-2">
            {sources.map(s => (
              <div key={s.name} className="flex items-center gap-2 text-xs">
                {statusIcon(s.status)}
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{s.name}</div>
                  <div className="text-muted-foreground truncate">{s.note}</div>
                </div>
                <a href={s.url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${s.name}`} className="text-primary hover:underline shrink-0">
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            ))}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

// === River Summary Panel ===
function RiverSummaryPanel({ forecast }: { forecast?: ForecastData }) {
  const [open, setOpen] = useState(false);
  if (!forecast?.riverSummary?.text) return null;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card className="bg-card border-border">
        <CollapsibleTrigger className="w-full">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">River Forecast Summary (RVA)</CardTitle>
              {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </div>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent>
            <pre className="text-xs text-foreground/80 whitespace-pre-wrap leading-relaxed max-h-64 overflow-y-auto font-mono">
              {forecast.riverSummary.text}
            </pre>
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

// === V4: Basin State Panel (consolidated GW + Soil + Atmos) ===
function BasinStatePanel({ groundwater, soilMoisture, surfaceObs }: {
  groundwater?: GroundwaterData; soilMoisture?: SoilMoisture; surfaceObs?: SurfaceObs;
}) {
  const gwDepth = groundwater?.depth ?? null;
  const gwColor = gwDepth === null ? "text-muted-foreground" :
    gwDepth < 2 ? "text-red-400" : gwDepth < 5 ? "text-orange-400" : gwDepth < 10 ? "text-amber-400" : "text-emerald-400";
  const soilPct = soilMoisture?.percentile ?? null;
  const soilColor = soilPct === null ? "text-muted-foreground" :
    soilPct > 90 ? "text-red-400" : soilPct > 70 ? "text-orange-400" : soilPct > 30 ? "text-emerald-400" : "text-amber-400";

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Layers className="h-4 w-4" />
          Basin State
          {surfaceObs?.isRaining && <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30 border text-[10px]">RAIN</Badge>}
          {surfaceObs?.isSnowing && <Badge className="bg-cyan-500/20 text-cyan-400 border-cyan-500/30 border text-[10px]">SNOW</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-2 text-xs">
          {/* Groundwater */}
          <div className="bg-accent/50 rounded p-2">
            <div className="text-muted-foreground flex items-center gap-1">
              <Droplets className="h-3 w-3" /> GW Depth
            </div>
            <div className={`font-bold text-base ${gwColor}`}>
              {gwDepth !== null ? `${gwDepth.toFixed(1)}ft` : "N/A"}
            </div>
            <div className="text-muted-foreground truncate">{groundwater?.interpretation || "—"}</div>
          </div>
          {/* Soil Moisture */}
          <div className="bg-accent/50 rounded p-2">
            <div className="text-muted-foreground flex items-center gap-1">
              <Activity className="h-3 w-3" /> Soil Moisture
            </div>
            <div className={`font-bold text-base ${soilColor}`}>
              {soilPct !== null ? `${soilPct.toFixed(0)}th pct` : "N/A"}
            </div>
            <div className="text-muted-foreground truncate">{soilMoisture?.interpretation || "—"}</div>
          </div>
          {/* Dewpoint Depression */}
          <div className="bg-accent/50 rounded p-2">
            <div className="text-muted-foreground">Dew Depression</div>
            <div className={`font-bold text-base ${surfaceObs?.dewpointDepression !== null && (surfaceObs?.dewpointDepression || 99) < 5 ? "text-amber-400" : ""}` }>
              {surfaceObs?.dewpointDepression !== null && surfaceObs?.dewpointDepression !== undefined ? `${surfaceObs.dewpointDepression}°F` : "N/A"}
            </div>
            <div className="text-muted-foreground">
              Dew: {surfaceObs?.dewpoint !== null && surfaceObs?.dewpoint !== undefined ? `${surfaceObs.dewpoint}°F` : "N/A"}
            </div>
          </div>
          {/* Wind */}
          <div className="bg-accent/50 rounded p-2">
            <div className="text-muted-foreground flex items-center gap-1">
              <Wind className="h-3 w-3" /> Wind
            </div>
            <div className="font-bold text-base">
              {surfaceObs?.windSpeed !== null && surfaceObs?.windSpeed !== undefined ? `${surfaceObs.windSpeed} mph` : "Calm"}
            </div>
            <div className="text-muted-foreground">
              {surfaceObs?.windDirectionCardinal || ""}{surfaceObs?.windGust ? ` · Gust ${surfaceObs.windGust}mph` : ""}
            </div>
          </div>
          {/* Visibility */}
          <div className="bg-accent/50 rounded p-2">
            <div className="text-muted-foreground flex items-center gap-1">
              <Eye className="h-3 w-3" /> Visibility
            </div>
            <div className="font-bold text-base">
              {surfaceObs?.visibility !== null && surfaceObs?.visibility !== undefined ? `${surfaceObs.visibility} mi` : "N/A"}
            </div>
            <div className="text-muted-foreground">RH: {surfaceObs?.relativeHumidity !== null && surfaceObs?.relativeHumidity !== undefined ? `${surfaceObs.relativeHumidity}%` : "N/A"}</div>
          </div>
          {/* Conditions */}
          <div className="bg-accent/50 rounded p-2">
            <div className="text-muted-foreground">Conditions</div>
            <div className="font-medium text-sm leading-tight">{surfaceObs?.textDescription || "N/A"}</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function StormBand({
  gauges,
  forecast,
  weather,
  stormPosts,
  postsLoading = false,
  refreshToken = 0,
}: {
  gauges?: GaugeData[];
  forecast?: ForecastData;
  weather?: WeatherData;
  stormPosts?: StormPosts;
  postsLoading?: boolean;
  refreshToken?: number;
}) {
  const storm = forecast?.afd.norEaster;
  const weekend = (weather?.forecast || []).filter(period => /saturday|sunday|monday/i.test(period.name)).slice(0, 6);
  const posts = stormPosts?.posts || [];
  const searchUrl = stormPosts?.searchUrl || STORM_SEARCH_URL;

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Nor&apos;easter — Broome County</CardTitle>
        <p className="text-[10px] text-muted-foreground">
          Live radar centered on Binghamton. The forecast is NWS Binghamton{forecast?.afd.issuedAt ? `, issued ${forecast.afd.issuedAt}` : ""}. Posts on X are not a warning.
        </p>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 xl:grid-cols-11 gap-4">
          <div className="xl:col-span-7">
            <BasinRadar gauges={gauges} refreshKey={refreshToken} />
          </div>
          <div className="xl:col-span-4 space-y-3">
            {storm?.headline && <p className="text-sm">{storm.headline}</p>}
            {storm?.detail && (
              <p className="max-h-48 overflow-y-auto text-xs text-muted-foreground leading-relaxed">{storm.detail}</p>
            )}
            {!storm && (
              <p className="text-xs text-muted-foreground">The latest NWS Binghamton discussion does not mention a nor&apos;easter.</p>
            )}
            {weekend.length > 0 && (
              <div className="grid grid-cols-2 gap-2">
                {weekend.map(period => (
                  <div key={period.name} className="rounded bg-accent/40 p-2 text-xs">
                    <div className="font-medium">{period.name}</div>
                    <div>{period.temp !== null ? `${period.temp}°` : "—"} · {period.shortForecast}</div>
                    {period.precipProbability !== null && period.precipProbability !== undefined && (
                      <div className="text-muted-foreground">{period.precipProbability}% chance of precipitation</div>
                    )}
                  </div>
                ))}
              </div>
            )}
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] font-medium">Posts on X, not a warning</p>
                <a href={searchUrl} target="_blank" rel="noopener noreferrer" className="text-[10px] text-muted-foreground hover:text-primary">
                  Wider conversation
                </a>
              </div>
              {!postsLoading && posts.length === 0 && (
                <p className="text-xs text-muted-foreground">No recent storm posts.</p>
              )}
              {posts.map(post => (
                <a key={post.id} href={post.url} target="_blank" rel="noopener noreferrer" className="flex gap-2 rounded border border-border p-2 hover:bg-accent/30">
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] text-muted-foreground">@{post.author}</p>
                    <p className="text-xs leading-snug line-clamp-4">{post.text}</p>
                  </div>
                  {post.imageUrl && (
                    <img src={post.imageUrl} alt="" className="h-12 w-12 rounded object-cover" />
                  )}
                </a>
              ))}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// === Upper air imagery. Radar lives in the storm band. ===
function ImageryPanel({ refreshToken = 0 }: { refreshToken?: number }) {
  const [activeTab, setActiveTab] = useState<"pwat" | "850mb">("pwat");
  const [refreshKey, setRefreshKey] = useState(0);
  useEffect(() => { if (refreshToken) setRefreshKey(k => k + 1); }, [refreshToken]);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [activeTab, refreshKey]);

  useEffect(() => {
    const interval = setInterval(() => setRefreshKey(k => k + 1), 300000);
    return () => clearInterval(interval);
  }, []);

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Radio className="h-4 w-4" />
            Upper Air
          </CardTitle>
          <div className="flex gap-1">
            <Button variant={activeTab === "pwat" ? "default" : "ghost"} size="sm" className="h-6 px-2 text-xs"
              onClick={() => setActiveTab("pwat")}>PWAT</Button>
            <Button variant={activeTab === "850mb" ? "default" : "ghost"} size="sm" className="h-6 px-2 text-xs"
              onClick={() => setActiveTab("850mb")}>850mb</Button>
            <Button variant="ghost" size="sm" className="h-6 px-1" aria-label="Refresh weather imagery" onClick={() => setRefreshKey(k => k + 1)}>
              <RefreshCw className="h-3 w-3" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="relative bg-muted/30 rounded-lg overflow-hidden">
          {failed && <div className="p-8 text-sm text-muted-foreground">Image unavailable from the provider. Try refreshing.</div>}
          {!failed && (
            <img
              src={apiUrl(`/api/spc-images/${activeTab}?fresh=1&_=${refreshKey}`)}
              onError={() => setFailed(true)}
              alt={activeTab === "pwat" ? "Precipitable Water" : "850mb Analysis"}
              className="w-full h-auto"
              style={{ minHeight: 180 }}
            />
          )}
        </div>
        <p className="text-[10px] text-muted-foreground mt-1">
          {activeTab === "pwat" ? "Precipitable Water — SPC Mesoanalysis Sector 14 (NE US)" :
           "850mb Wind/Temperature — SPC Mesoanalysis Sector 14 (NE US)"}
        </p>
      </CardContent>
    </Card>
  );
}

// === V4: Predictive Outlook Panel ===
function PredictiveOutlookPanel({ data, isLoading }: { data?: PredictiveOutlook; isLoading?: boolean }) {
  const [showAllFactors, setShowAllFactors] = useState(false);
  if (isLoading) {
    return (
      <Card className="bg-card border-border animate-pulse">
        <CardContent className="p-4 h-64" />
      </Card>
    );
  }

  if (!data) {
    return (
      <Card className="bg-card border-border">
        <CardContent className="p-4 flex items-center justify-center h-32 text-muted-foreground text-sm">
          <Brain className="h-4 w-4 mr-2" /> Predictive analysis unavailable
        </CardContent>
      </Card>
    );
  }

  const riskColors: Record<string, { bg: string; border: string; text: string; bar: string }> = {
    LOW:      { bg: "bg-emerald-500/10", border: "border-emerald-500/30", text: "text-emerald-400", bar: "bg-emerald-500" },
    MODERATE: { bg: "bg-amber-500/10",   border: "border-amber-500/30",   text: "text-amber-400",   bar: "bg-amber-500"   },
    ELEVATED: { bg: "bg-orange-500/10",  border: "border-orange-500/30",  text: "text-orange-400",  bar: "bg-orange-500"  },
    HIGH:     { bg: "bg-red-500/10",      border: "border-red-500/30",     text: "text-red-400",     bar: "bg-red-500"     },
  };

  const sevColors: Record<string, string> = {
    CATASTROPHIC: "text-red-400 bg-red-500/20 border-red-500/40",
    MAJOR:        "text-orange-400 bg-orange-500/20 border-orange-500/40",
    MODERATE:     "text-amber-400 bg-amber-500/20 border-amber-500/40",
    MINOR:        "text-blue-400 bg-blue-500/20 border-blue-500/40",
  };

  const getRiskColor = (level: string) => riskColors[level] || riskColors.LOW;
  const current = getRiskColor(data.riskLevel);

  const outlooks = [
    { label: "24h", ...data.outlook24h },
    { label: "48h", ...data.outlook48h },
    { label: data.qpf72Complete === false ? "72h*" : "72h", ...data.outlook72h },
  ];

  return (
    <Card className={`border ${current.border} ${current.bg}`}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <Brain className={`h-5 w-5 ${current.text}`} />
            <div>
              <CardTitle className="text-sm">Predictive Flood Outlook</CardTitle>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                Generated {new Date(data.generatedAt).toLocaleTimeString()}
                {data.dataCoverage && <> · {data.dataCoverage}</>}
              </p>
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className={`text-4xl font-black tabular-nums leading-none ${current.text}`}>
              {data.compositeScore}
            </div>
            <div className="text-[10px] text-muted-foreground">/ 100</div>
            <Badge className={`${current.bg} ${current.text} border ${current.border} text-xs font-bold mt-1`}>
              {data.riskLevel}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {data.qpf72Complete === false && <p className="text-[10px] text-muted-foreground">*72-hour precipitation coverage is incomplete; this indicator is provisional.</p>}
        {/* Timeline bars */}
        <div>
          <div className="text-xs font-semibold text-muted-foreground mb-2">Risk Outlook</div>
          <div className="space-y-2">
            {outlooks.map(o => {
              const c = getRiskColor(o.level);
              return (
                <div key={o.label} className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground w-7 shrink-0">{o.label}</span>
                  <div className="flex-1 h-5 bg-muted/40 rounded-full overflow-hidden relative">
                    <div
                      className={`h-full ${c.bar} rounded-full transition-all opacity-80`}
                      style={{ width: `${Math.min(100, o.score)}%` }}
                    />
                  </div>
                  <span className={`text-xs font-bold w-14 text-right ${c.text}`}>
                    {o.score} <span className="font-normal text-muted-foreground">{o.level}</span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Factor breakdown */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-semibold text-muted-foreground">Factor Breakdown</div>
            {data.factors.length > 3 && (
              <button
                onClick={() => setShowAllFactors(v => !v)}
                className="text-[10px] text-primary hover:underline flex items-center gap-1"
              >
                {showAllFactors ? (
                  <><ChevronUp className="h-3 w-3" /> Show fewer</>
                ) : (
                  <><ChevronDown className="h-3 w-3" /> Show all {data.factors.length}</>
                )}
              </button>
            )}
          </div>
          <div className="space-y-1.5">
            {(showAllFactors ? data.factors : data.factors.slice(0, 3)).map(f => {
              const scoreLevel = f.score > 70 ? "bg-red-500" : f.score > 50 ? "bg-orange-500" : f.score > 30 ? "bg-amber-500" : "bg-emerald-500";
              return (
                <div key={f.name}>
                  <div className="flex items-center justify-between text-xs mb-0.5">
                    <span className="font-medium">{f.name}</span>
                    <span className="text-muted-foreground">
                      <span className="font-bold text-foreground">{f.score}</span>/100
                      <span className="ml-1 text-[10px]">×{f.weight} = <span className="font-semibold">{f.contribution.toFixed(1)}</span></span>
                    </span>
                  </div>
                  <div className="h-1.5 bg-muted/40 rounded-full overflow-hidden">
                    <div className={`h-full ${scoreLevel} rounded-full`} style={{ width: `${f.score}%` }} />
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-0.5 truncate">{f.detail}</div>
                </div>
              );
            })}
          </div>
          {!showAllFactors && data.factors.length > 3 && (
            <div className="text-[10px] text-muted-foreground/60 mt-1.5">
              +{data.factors.length - 3} more factors hidden
            </div>
          )}
        </div>

        {/* Narrative */}
        <div className="bg-muted/20 rounded-lg p-3 border border-border">
          <div className="text-xs font-semibold text-muted-foreground mb-1.5">Live-data analysis · experimental heuristic</div>
          <p className="text-sm leading-relaxed text-foreground/90">
            {data.narrative}
          </p>
        </div>

        {!!data.pathways?.length && (
          <div>
            <div className="text-xs font-semibold text-muted-foreground mb-1">How flooding can develop here</div>
            <p className="text-[10px] text-muted-foreground mb-2">Each pathway uses the readings already on this page. Quiet means that setup is not showing up now. It is not a probability.</p>
            <div className="space-y-2">
              {data.pathways.map(pathway => {
                const tone = pathway.state === "active" ? "border-red-500/30 bg-red-500/10"
                  : pathway.state === "watch" ? "border-amber-500/30 bg-amber-500/10"
                  : pathway.state === "unknown" ? "border-border bg-muted/20"
                  : "border-emerald-500/20 bg-emerald-500/5";
                const label = pathway.state === "active" ? "Showing up" : pathway.state === "watch" ? "Watch" : pathway.state === "unknown" ? "Not scored" : "Quiet";
                return (
                  <div key={pathway.id} className={`rounded-lg border p-2.5 ${tone}`}>
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="text-xs font-semibold">{pathway.name}</span>
                      <Badge variant="outline" className="text-[10px] px-1 py-0">{label}</Badge>
                    </div>
                    <p className="text-[11px] leading-snug text-foreground/90">{pathway.how}</p>
                    <p className="text-[11px] leading-snug text-muted-foreground mt-1">{pathway.now}</p>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Historical matches */}
        <div>
          <div className="text-xs font-semibold text-muted-foreground mb-2">Historical setups · illustrative, not a chance of repeat</div>
          <div className="space-y-2">
            {data.historicalMatches.map(m => {
              const sc = sevColors[m.severity] || sevColors.MINOR;
              const simColor = m.similarity > 60 ? "text-red-400" : m.similarity > 40 ? "text-amber-400" : "text-muted-foreground";
              return (
                <div key={m.name} className="bg-accent/30 rounded-lg p-2.5 border border-border">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-semibold leading-tight">{m.name}</span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Badge variant="outline" className={`text-[10px] px-1 py-0 border ${sc}`}>{m.severity}</Badge>
                      <span className={`text-xs font-bold ${simColor}`}>{m.similarity}% of setup</span>
                    </div>
                  </div>
                  <div className="relative mb-1.5 h-1 rounded-full bg-muted/60">
                    <div className="stage-fill absolute inset-y-0 left-0 rounded-full bg-primary/80" style={{ width: `${Math.max(2, Math.min(100, m.similarity))}%` }} />
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-snug mb-1">{m.description}</p>
                  <div className="text-[10px] text-muted-foreground/70">{m.peakComparison}</div>
                  {m.gap && <div className="text-[10px] text-muted-foreground/80 mt-1 leading-snug">{m.gap}</div>}
                </div>
              );
            })}
          </div>
          {data.historicalMatches.every(m => m.similarity < 40) && (
            <div className="text-[10px] text-emerald-400 mt-1.5 flex items-center gap-1">
              <CheckCircle className="h-3 w-3" />
              Low similarity in this heuristic does not rule out flooding
            </div>
          )}
        </div>

        {/* Trigger conditions */}
        <div className="grid grid-cols-1 gap-2">
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-2.5">
            <div className="text-[10px] text-red-400 font-semibold mb-0.5 flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" /> ESCALATION TRIGGER
            </div>
            <div className="text-xs text-foreground/80">{data.triggers.escalation}</div>
          </div>
          <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-2.5">
            <div className="text-[10px] text-emerald-400 font-semibold mb-0.5 flex items-center gap-1">
              <CheckCircle className="h-3 w-3" /> DE-ESCALATION
            </div>
            <div className="text-xs text-foreground/80">{data.triggers.deescalation}</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// === Stale Banner ===
function StaleBanner() {
  return (
    <div className="bg-amber-500/20 border border-amber-500/30 rounded-lg px-4 py-2 flex items-center gap-2 text-amber-200 text-sm">
      <AlertTriangle className="h-4 w-4" />
      <span>Checking sources, or some data is stale/unavailable. Refer to observation times and official warnings.</span>
    </div>
  );
}

// === Main Dashboard ===
export default function Dashboard() {
  const {
    gauges, forecast, weather, ensemble, news,
    groundwater, surfaceObs, gridpointData, historicalStats, soilMoisture,
    predictiveOutlook, webcams, communityFeed, stormPosts,
    refreshAll, countdown, lastRefresh,
    isAnyLoading, connectionStatus, isDataStale,
  } = useDashboardData();

  const [isDark, setIsDark] = useState(true);
  const [expandedGauge, setExpandedGauge] = useState<string | null>(null);

  // Apply dark mode on mount
  useEffect(() => {
    document.documentElement.classList.add("dark");
  }, []);

  const toggleDark = () => {
    const next = !isDark;
    setIsDark(next);
    if (next) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  };

  const toggleGauge = (id: string) => {
    setExpandedGauge(expandedGauge === id ? null : id);
  };

  const gaugesResp = gauges.data;
  const gaugeList = gaugesResp?.gauges || [];
  const regularGauges = gaugeList.filter(g => !g.isReservoir);
  const crest = regularGauges.filter(g => !g.isOffline && g.stage !== null && g.thresholds.action).reduce((top, g) => {
    const pct = ((g.stage || 0) / (g.thresholds.action || 1)) * 100;
    return pct > top.pct ? { pct, name: g.name, stage: g.stage, action: g.thresholds.action } : top;
  }, { pct: 0, name: "", stage: null as number | null, action: undefined as number | undefined });
  const reservoirGauges = gaugeList.filter(g => g.isReservoir);
  const ensembleBounds = ensemble.data?.ensembleBounds;
  const histStats = historicalStats.data as HistoricalStats | undefined;
  const outlookData = predictiveOutlook.data as PredictiveOutlook | undefined;

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-background">
        <DashboardHeader
          countdown={countdown}
          lastRefresh={lastRefresh}
          onRefresh={() => refreshAll(true)}
          isLoading={isAnyLoading}
          connectionStatus={connectionStatus}
          isDark={isDark}
          toggleDark={toggleDark}
          crestPct={crest.action ? crest.pct : null}
          crestLabel={crest.action && crest.stage !== null ? `${crest.name} is ${Math.round(crest.pct)}% of its ${crest.action} ft action stage` : "Waiting for a stage reading"}
          basinTrend={gaugesResp?.basinTrend?.direction || "Steady"}
        />

        <main className="max-w-[1600px] mx-auto p-4 space-y-4">
          {isDataStale && <StaleBanner />}

          <StormBand
            gauges={gaugesResp?.gauges}
            forecast={forecast.data}
            weather={weather.data}
            stormPosts={stormPosts.data}
            postsLoading={stormPosts.isLoading}
            refreshToken={lastRefresh.getTime()}
          />

          {/* KPI Row */}
          <KPICards gaugesResp={gaugesResp} weather={weather.data} outlookData={outlookData} />

          {/* Confluence Sync */}
          <ConfluenceSyncPanel gaugesResp={gaugesResp} />

          {/* V4 Main two-column layout: 55% / 45% */}
          <div className="grid grid-cols-1 xl:grid-cols-11 gap-4">
            {/* Left Column (55% = 6/11) */}
            <div className="xl:col-span-6 space-y-4">
              {/* V4: Predictive Outlook Panel — TOP of left column */}
              <PredictiveOutlookPanel
                data={outlookData}
                isLoading={predictiveOutlook.isLoading}
              />

              {/* Reservoir Cards — prominent placement above hydraulics */}
              {reservoirGauges.length > 0 && (
                <div className="grid grid-cols-1 gap-3">
                  {reservoirGauges.map(g => (
                    <ReservoirCard key={g.id} gauge={g} />
                  ))}
                </div>
              )}

              {/* Gauge Cards Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {gauges.isLoading ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <Card key={i} className="bg-card border-border animate-pulse">
                      <CardContent className="p-4 h-48" />
                    </Card>
                  ))
                ) : regularGauges.map(gauge => (
                  <GaugeCard
                    key={gauge.id}
                    gauge={gauge}
                    expanded={expandedGauge === gauge.id}
                    onToggle={() => toggleGauge(gauge.id)}
                    ensembleBounds={ensembleBounds?.[gauge.id]}
                    historicalStat={histStats?.stats?.[gauge.id]}
                  />
                ))}
              </div>

              {/* V6: Webcam Panel — BEFORE charts (visual context first) */}
              <WebcamPanel
                webcamsData={webcams.data}
                isLoading={webcams.isLoading}
                refreshToken={lastRefresh.getTime()}
              />

              {/* Confluence Hydraulics */}
              <ConfluenceHydraulicsPanel gaugesResp={gaugesResp} />

              {/* Stage + Flow Charts */}
              {gaugeList.length > 0 && <StageChart gauges={gaugeList} ensembleBounds={ensembleBounds} />}
              {gaugeList.length > 0 && <FlowChart gauges={gaugeList} ensembleData={ensemble.data} />}

            </div>

            {/* Right Column (45% = 5/11) */}
            <div className="xl:col-span-5 space-y-4">
              {/* ─── Basin Intelligence ─── */}
              <SectionLabel label="Basin Intelligence" />

              {/* V4: Basin State (consolidated GW + Soil + Atmos) */}
              <BasinStatePanel
                groundwater={groundwater.data as GroundwaterData | undefined}
                soilMoisture={soilMoisture.data as SoilMoisture | undefined}
                surfaceObs={surfaceObs.data as SurfaceObs | undefined}
              />

              {/* ─── Risk & Alerts ─── */}
              <SectionLabel label="Risk & Alerts" />

              {/* Compound Risk (enhanced) */}
              <CompoundRiskPanel
                gauges={gaugeList}
                weather={weather.data}
                groundwater={groundwater.data as GroundwaterData | undefined}
                soilMoisture={soilMoisture.data as SoilMoisture | undefined}
              />

              {/* V6: Ham Radio — moved up: emergency comms belong near risk assessment */}
              <HamRadioPanel />

              {/* Alerts & Reports */}
              <LocalReportsPanel newsData={news.data} isError={news.isError} />

              {/* V5: Community Feed Panel — after local reports, before weather */}
              <CommunityFeedPanel
                feedData={communityFeed.data}
                isLoading={communityFeed.isLoading}
              />

              {/* ─── Weather & Analysis ─── */}
              <SectionLabel label="Weather & Analysis" />

              {/* NWS Weather + Forecast */}
              <WeatherPanel weather={weather.data} />

              <ImageryPanel refreshToken={lastRefresh.getTime()} />

              {/* V4: QPF + Atmospheric detail (from AtmosphericPanel, kept for QPF chart) */}
              <AtmosphericPanel
                surfaceObs={surfaceObs.data as SurfaceObs | undefined}
                gridpoint={gridpointData.data as GridpointData | undefined}
              />

              {/* ─── Reference ─── */}
              <SectionLabel label="Reference" />

              {/* AFD + RVA + Data Sources (collapsible stack) */}
              <AFDPanel forecast={forecast.data} />
              <RiverSummaryPanel forecast={forecast.data} />
              <DataSourceStatus
                gauges={{ isError: gauges.isError || !gauges.data || !!(gauges.data as any)?.stale }}
                forecast={{ isError: forecast.isError || !forecast.data || !!(forecast.data as any)?.stale }}
                weather={{ isError: weather.isError || !weather.data || !!(weather.data as any)?.stale }}
                ensemble={{ isError: ensemble.isError || !ensemble.data || !!(ensemble.data as any)?.stale }}
                groundwater={{ isError: groundwater.isError || !groundwater.data || !!groundwater.data?.error || !!groundwater.data?.stale }}
                surfaceObs={{ isError: surfaceObs.isError || !surfaceObs.data || !!surfaceObs.data?.stale }}
                gridpoint={{ isError: gridpointData.isError || !gridpointData.data || !!gridpointData.data?.stale }}
                soilMoisture={{ isError: soilMoisture.isError || !soilMoisture.data || !!soilMoisture.data?.error || !!soilMoisture.data?.stale }}
              />
            </div>
          </div>
        </main>
      </div>
    </TooltipProvider>
  );
}
