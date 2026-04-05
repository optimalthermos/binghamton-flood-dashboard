import { useState, useEffect } from "react";
import { useDashboardData } from "@/hooks/use-dashboard-data";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Progress } from "@/components/ui/progress";
import {
  RefreshCw, Sun, Moon, Waves, TrendingUp, TrendingDown, Minus,
  Thermometer, CloudRain, Snowflake, Activity, ChevronDown, ChevronUp,
  ExternalLink, AlertTriangle, CheckCircle, XCircle, Clock, WifiOff, Wifi,
  Droplets, ArrowDownUp, Newspaper, ShieldAlert, Gauge,
} from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, ReferenceLine,
  Legend, ResponsiveContainer, LineChart, Line, Tooltip as RechartsTooltip,
} from "recharts";
import type { GaugeData, WeatherData, GaugesResponse, EnsembleData, NewsData } from "@shared/schema";

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
function MiniSparkline({ data, thresholdAction }: { data: Array<{ timestamp: string; value: number | null }>; thresholdAction?: number }) {
  const pts = data.filter(d => d.value !== null).slice(-72);
  if (pts.length < 2) return <div className="h-12 flex items-center justify-center text-xs text-muted-foreground">No data</div>;
  const chartData = pts.map(p => ({ t: new Date(p.timestamp).getTime(), v: p.value }));
  return (
    <ResponsiveContainer width="100%" height={48}>
      <AreaChart data={chartData} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
        <defs>
          <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="hsl(195, 80%, 45%)" stopOpacity={0.3} />
            <stop offset="95%" stopColor="hsl(195, 80%, 45%)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area type="monotone" dataKey="v" stroke="hsl(195, 80%, 45%)" fill="url(#sparkGrad)" strokeWidth={1.5} dot={false} />
        {thresholdAction && <ReferenceLine y={thresholdAction} stroke="hsl(38, 90%, 55%)" strokeDasharray="3 3" strokeWidth={1} />}
      </AreaChart>
    </ResponsiveContainer>
  );
}

// === Header ===
function DashboardHeader({ countdown, lastRefresh, onRefresh, isLoading, connectionStatus, isDark, toggleDark }: {
  countdown: number; lastRefresh: Date; onRefresh: () => void; isLoading: boolean;
  connectionStatus: "live" | "stale" | "offline"; isDark: boolean; toggleDark: () => void;
}) {
  const statusColors = { live: "bg-emerald-400", stale: "bg-amber-400", offline: "bg-red-500" };
  const statusLabels = { live: "Live", stale: "Stale", offline: "Offline" };

  return (
    <header className="border-b border-border bg-card px-4 py-3">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Waves className="h-7 w-7 text-primary" />
          <div>
            <h1 className="text-lg font-bold tracking-tight">BGM Flood Monitor</h1>
            <p className="text-xs text-muted-foreground">Binghamton Basin Compound Flood Risk</p>
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
            Updated: {lastRefresh.toLocaleTimeString()}
          </div>
          <Button variant="outline" size="sm" onClick={onRefresh} disabled={isLoading}>
            <RefreshCw className={`h-3.5 w-3.5 mr-1 ${isLoading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={toggleDark}>
            {isDark ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </div>
    </header>
  );
}

// === KPI Cards (v2: discharge-weighted basin trend, QPF countdown) ===
function KPICards({ gaugesResp, weather }: { gaugesResp: GaugesResponse | undefined; weather: WeatherData | undefined }) {
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
  const btDirection = bt?.direction || "Stable";
  const btColor = btDirection === "Loading" ? "text-red-400" : btDirection === "Draining" ? "text-emerald-400" : "text-blue-400";
  const btIcon = btDirection === "Loading" ? <TrendingUp className="h-5 w-5" /> : btDirection === "Draining" ? <TrendingDown className="h-5 w-5" /> : <Minus className="h-5 w-5" />;

  // Temp
  const temp = weather?.current?.temp;

  // QPF (v2: countdown + amount)
  const qpf = weather?.qpf;
  let qpfValue = "None";
  let qpfSub = "No precip in forecast";
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

  const kpis: Array<{ label: string; value: string; sub: string; icon: React.ReactNode; color: string }> = [
    {
      label: "Highest Stage",
      value: `${Math.round(highestPct.pct)}%`,
      sub: `${highestPct.name} (${highestPct.stage?.toFixed(1)}/${highestPct.action}ft)`,
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
      value: frost ? `${frost.estimatedDepthInches.toFixed(1)}"` : "0\"",
      sub: frost ? `FDH: ${frost.cumulativeFDH} — ${frostSig}` : "No freeze",
      icon: <Snowflake className="h-5 w-5" />,
      color: frostSig === "HYDROLOGIC" ? "text-red-400" : frostSig === "NUISANCE" ? "text-amber-400" : "text-muted-foreground",
    },
    {
      label: "Data Fresh",
      value: `${freshCount}/${onlineGauges.length}`,
      sub: `${onlineGauges.length - freshCount} stale gauge(s)`,
      icon: <Wifi className="h-5 w-5" />,
      color: freshCount === onlineGauges.length ? "text-emerald-400" : "text-amber-400",
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
      {kpis.map(kpi => (
        <Card key={kpi.label} className="bg-card border-border">
          <CardContent className="p-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-muted-foreground">{kpi.label}</span>
              <span className={kpi.color}>{kpi.icon}</span>
            </div>
            <div className={`text-xl font-bold ${kpi.color}`}>{kpi.value}</div>
            <div className="text-xs text-muted-foreground truncate">{kpi.sub}</div>
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
    BOTH_RISING: { bg: "bg-red-500/10", border: "border-red-500/30", label: "Convergent Loading", desc: "Both rivers rising — compound flood risk elevated", icon: <AlertTriangle className="h-5 w-5 text-red-400" /> },
    BOTH_FALLING: { bg: "bg-emerald-500/10", border: "border-emerald-500/30", label: "Synchronized Recession", desc: "Basin draining — both rivers falling", icon: <CheckCircle className="h-5 w-5 text-emerald-400" /> },
    SUSQ_RISING_CHEN_FALLING: { bg: "bg-amber-500/10", border: "border-amber-500/30", label: "Asymmetric", desc: "Susquehanna loading while Chenango drains", icon: <ArrowDownUp className="h-5 w-5 text-amber-400" /> },
    CHEN_RISING_SUSQ_FALLING: { bg: "bg-amber-500/10", border: "border-amber-500/30", label: "Asymmetric", desc: "Chenango loading while Susquehanna drains", icon: <ArrowDownUp className="h-5 w-5 text-amber-400" /> },
    STABLE: { bg: "bg-blue-500/10", border: "border-blue-500/30", label: "Stable", desc: "Both rivers stable — no significant trend", icon: <Minus className="h-5 w-5 text-blue-400" /> },
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
  const pct = gauge.floodStoragePct ?? 0;
  const pctColor = pct > 60 ? "text-red-400" : pct > 30 ? "text-amber-400" : "text-emerald-400";
  const barColor = pct > 60 ? "bg-red-500" : pct > 30 ? "bg-amber-500" : "bg-emerald-500";

  return (
    <Card className="bg-card border-border col-span-1 sm:col-span-2">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Gauge className="h-5 w-5 text-primary" />
            <div>
              <h3 className="font-semibold text-sm">{gauge.name}</h3>
              <p className="text-xs text-muted-foreground">{gauge.river} — System Buffer</p>
            </div>
          </div>
          <Badge variant="outline" className={`text-xs ${pctColor}`}>
            {pct.toFixed(1)}% flood storage
          </Badge>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className={`text-3xl font-bold tabular-nums ${pctColor}`}>
              {gauge.poolElevation?.toFixed(2) ?? "—"}
              <span className="text-sm font-normal ml-1">ft NGVD</span>
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              Conservation pool: {gauge.conservationPool}ft | Spillway: 1047.5ft
            </div>
            <div className="mt-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                <span>{gauge.conservationPool}ft</span>
                <span>1047.5ft</span>
              </div>
              <div className="h-3 bg-muted rounded-full overflow-hidden">
                <div className={`h-full ${barColor} rounded-full transition-all`} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
              </div>
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
            <MiniSparkline data={gauge.stageTimeSeries} />
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

// === Gauge Card (v2: recession rate + ensemble badge) ===
function GaugeCard({ gauge, expanded, onToggle, ensembleBounds }: {
  gauge: GaugeData; expanded: boolean; onToggle: () => void;
  ensembleBounds?: { p10: number; p50: number; p90: number };
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
            {gauge.isBinghamton ? "Known offline — no data available" : "No data available"}
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
          <MiniSparkline data={gauge.stageTimeSeries} thresholdAction={gauge.thresholds.action} />
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

  const colors = ["hsl(195, 80%, 55%)", "hsl(173, 58%, 50%)", "hsl(38, 90%, 60%)", "hsl(280, 60%, 60%)", "hsl(145, 60%, 50%)"];

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
                strokeWidth={2} dot={false} connectNulls />
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

function FlowChart({ gauges }: { gauges: GaugeData[] }) {
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

  const colors = ["hsl(195, 80%, 55%)", "hsl(173, 58%, 50%)", "hsl(38, 90%, 60%)", "hsl(280, 60%, 60%)", "hsl(145, 60%, 50%)"];

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
                strokeWidth={2} dot={false} connectNulls />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

// === Compound Risk Panel (v2: frost depth sub-card, remove Whitney Point data gap) ===
function CompoundRiskPanel({ gauges, weather }: { gauges?: GaugeData[]; weather?: WeatherData }) {
  const onlineGauges = (gauges || []).filter(g => !g.isOffline && !g.isReservoir);
  const anyAboveAction = onlineGauges.some(g => g.stage !== null && g.thresholds.action && g.stage >= g.thresholds.action);
  const anyNearAction = onlineGauges.some(g => g.stage !== null && g.thresholds.action && g.stage >= g.thresholds.action - 2);
  const frost = weather?.frostData;
  const frostRisk = frost && frost.significance !== "NONE";
  const precipExpected = weather?.forecast?.some(p => p.shortForecast.match(/rain|snow|shower/i));

  let riskLevel: "LOW" | "MODERATE" | "ELEVATED" | "HIGH" = "LOW";
  if (anyAboveAction) riskLevel = "HIGH";
  else if (anyNearAction && (frostRisk || precipExpected)) riskLevel = "ELEVATED";
  else if (frostRisk || precipExpected || anyNearAction) riskLevel = "MODERATE";

  const riskColors = {
    LOW: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    MODERATE: "bg-amber-500/20 text-amber-400 border-amber-500/30",
    ELEVATED: "bg-orange-500/20 text-orange-400 border-orange-500/30",
    HIGH: "bg-red-500/20 text-red-400 border-red-500/30",
  };

  const riskFactors = [
    { label: "Soil saturation", status: anyAboveAction ? "HIGH — elevated readings" : anyNearAction ? "MODERATE — near action" : "Normal", active: anyAboveAction || anyNearAction },
    { label: "Precip expected", status: precipExpected ? "Rain/snow in forecast" : "Dry forecast period", active: !!precipExpected },
    { label: "Rain-on-frozen-ground", status: frostRisk && precipExpected ? "POSSIBLE — monitor closely" : "Not expected", active: !!(frostRisk && precipExpected) },
    { label: "Runoff coefficient", status: frostRisk ? "0.85-0.95 if ground freezes" : "Normal (0.3-0.5)", active: !!frostRisk },
    { label: "SAC-SMA frozen ground module", status: "UNCONFIRMED at MARFC", active: false },
    { label: "Ungauged tributaries", status: "99 sq mi (Castle Creek, Thomas Creek)", active: true },
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
function LocalReportsPanel({ newsData }: { newsData?: NewsData }) {
  const [open, setOpen] = useState(true);
  if (!newsData) return null;

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
            {/* Active NWS alerts */}
            {newsData.alerts.map((alert, i) => (
              <div key={`alert-${i}`} className={`rounded-lg p-2.5 border text-xs ${severityColors[alert.severity || "info"]}`}>
                <div className="flex items-start gap-2">
                  {severityIcons[alert.severity || "info"]}
                  <div className="flex-1 min-w-0">
                    <div className="font-medium leading-tight">{alert.headline}</div>
                    <div className="flex items-center gap-2 mt-1 text-muted-foreground">
                      <span>{alert.source}</span>
                      <span>·</span>
                      <span>{new Date(alert.date).toLocaleDateString()}</span>
                      <a href={alert.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline ml-auto">
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  </div>
                </div>
              </div>
            ))}

            {newsData.alerts.length > 0 && newsData.curatedReports.length > 0 && (
              <div className="border-t border-border my-1" />
            )}

            {/* Curated reports */}
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
  if (!weather) return null;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card className="bg-card border-border">
        <CollapsibleTrigger className="w-full">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">NWS Weather</CardTitle>
              {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </div>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="bg-accent/50 rounded p-2">
                <div className="text-muted-foreground">Temperature</div>
                <div className="font-bold text-lg">{weather.current.temp !== null ? `${weather.current.temp}°F` : "N/A"}</div>
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
            <div className="space-y-1">
              <h4 className="text-xs font-semibold text-muted-foreground">7-Day Forecast</h4>
              <div className="space-y-1 max-h-64 overflow-y-auto">
                {weather.forecast.map((p, i) => {
                  const hasPrecip = p.shortForecast.match(/rain|snow|shower|thunderstorm|drizzle/i);
                  const isFreezing = p.temp !== null && p.temp <= 32;
                  return (
                    <div key={i} className={`text-xs p-2 rounded ${hasPrecip ? "bg-blue-500/10 border border-blue-500/20" : isFreezing ? "bg-cyan-500/10 border border-cyan-500/20" : "bg-accent/30"}`}>
                      <div className="flex justify-between items-center">
                        <span className="font-medium">{p.name}</span>
                        <span className={`font-bold ${isFreezing ? "text-blue-400" : ""}`}>
                          {p.temp !== null ? `${p.temp}°F` : "N/A"}
                        </span>
                      </div>
                      <div className="text-muted-foreground mt-0.5">{p.shortForecast}</div>
                    </div>
                  );
                })}
              </div>
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
            {forecast.afd.synopsis && (
              <div>
                <h4 className="font-semibold text-muted-foreground mb-1">Synopsis</h4>
                <p className="text-foreground/80 whitespace-pre-wrap leading-relaxed"
                  dangerouslySetInnerHTML={{ __html: highlightKeywords(forecast.afd.synopsis) }} />
              </div>
            )}
            {forecast.afd.shortTerm && (
              <div>
                <h4 className="font-semibold text-muted-foreground mb-1">Short Term</h4>
                <p className="text-foreground/80 whitespace-pre-wrap leading-relaxed"
                  dangerouslySetInnerHTML={{ __html: highlightKeywords(forecast.afd.shortTerm) }} />
              </div>
            )}
            {forecast.afd.longTerm && (
              <div>
                <h4 className="font-semibold text-muted-foreground mb-1">Long Term</h4>
                <p className="text-foreground/80 whitespace-pre-wrap leading-relaxed"
                  dangerouslySetInnerHTML={{ __html: highlightKeywords(forecast.afd.longTerm) }} />
              </div>
            )}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

// === Data Source Status ===
function DataSourceStatus({ gauges, forecast, weather, ensemble }: {
  gauges: { isError: boolean };
  forecast: { isError: boolean };
  weather: { isError: boolean };
  ensemble: { isError: boolean };
}) {
  const sources = [
    { name: "USGS Water Services API", status: gauges.isError ? "error" : "ok", url: "https://waterservices.usgs.gov/nwis/iv/", note: "Real-time gauge data + Whitney Point Dam" },
    { name: "NWS Forecast API", status: weather.isError ? "error" : "ok", url: "https://api.weather.gov/", note: "Current conditions, 7-day, hourly QPF" },
    { name: "NWS AFD/RVA", status: forecast.isError ? "error" : "ok", url: "https://forecast.weather.gov/", note: "Forecast discussions" },
    { name: "MARFC Ensemble", status: ensemble.isError ? "warn" : "ok", url: "https://www.weather.gov/source/erh/mmefs/marfc.GEFS.table.html", note: "GEFS ensemble table — exceedance bounds" },
    { name: "Snoflo", status: "broken", url: "https://www.snoflo.org/", note: "BROKEN — serving cached Summer 2025 data" },
    { name: "USGS Modernized Pages", status: "broken", url: "https://waterdata.usgs.gov/", note: "BROKEN — API works but web UI broken" },
  ];

  const statusIcon = (s: string) => {
    switch (s) {
      case "ok": return <CheckCircle className="h-3.5 w-3.5 text-emerald-400" />;
      case "warn": return <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />;
      case "error": return <XCircle className="h-3.5 w-3.5 text-red-500" />;
      case "broken": return <XCircle className="h-3.5 w-3.5 text-red-500/60" />;
      default: return null;
    }
  };

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Data Sources</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {sources.map(s => (
          <div key={s.name} className="flex items-center gap-2 text-xs">
            {statusIcon(s.status)}
            <div className="flex-1 min-w-0">
              <div className="font-medium truncate">{s.name}</div>
              <div className="text-muted-foreground truncate">{s.note}</div>
            </div>
            <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline shrink-0">
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        ))}
      </CardContent>
    </Card>
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

// === Stale Banner ===
function StaleBanner() {
  return (
    <div className="bg-amber-500/20 border border-amber-500/30 rounded-lg px-4 py-2 flex items-center gap-2 text-amber-200 text-sm">
      <AlertTriangle className="h-4 w-4" />
      <span>Data may be stale — last successful refresh was more than 10 minutes ago</span>
    </div>
  );
}

// === Main Dashboard ===
export default function Dashboard() {
  const {
    gauges, forecast, weather, ensemble, news,
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
  const reservoirGauges = gaugeList.filter(g => g.isReservoir);
  const ensembleBounds = ensemble.data?.ensembleBounds;

  return (
    <div className="min-h-screen bg-background">
      <DashboardHeader
        countdown={countdown}
        lastRefresh={lastRefresh}
        onRefresh={refreshAll}
        isLoading={isAnyLoading}
        connectionStatus={connectionStatus}
        isDark={isDark}
        toggleDark={toggleDark}
      />

      <main className="max-w-[1600px] mx-auto p-4 space-y-4">
        {isDataStale && <StaleBanner />}

        {/* KPI Row */}
        <KPICards gaugesResp={gaugesResp} weather={weather.data} />

        {/* Confluence Sync (v2 feature 4) */}
        <ConfluenceSyncPanel gaugesResp={gaugesResp} />

        {/* Main two-column layout */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
          {/* Left Column (60%) */}
          <div className="lg:col-span-3 space-y-4">
            {/* Whitney Point Dam Reservoir Card (v2 feature 1) */}
            {reservoirGauges.map(g => (
              <ReservoirCard key={g.id} gauge={g} />
            ))}

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
                />
              ))}
            </div>

            {/* Charts */}
            {gaugeList.length > 0 && <StageChart gauges={gaugeList} ensembleBounds={ensembleBounds} />}
            {gaugeList.length > 0 && <FlowChart gauges={gaugeList} />}
          </div>

          {/* Right Column (40%) */}
          <div className="lg:col-span-2 space-y-4">
            <CompoundRiskPanel gauges={gaugeList} weather={weather.data} />
            <LocalReportsPanel newsData={news.data} />
            <WeatherPanel weather={weather.data} />
            <AFDPanel forecast={forecast.data} />
            <DataSourceStatus
              gauges={{ isError: gauges.isError }}
              forecast={{ isError: forecast.isError }}
              weather={{ isError: weather.isError }}
              ensemble={{ isError: ensemble.isError }}
            />
            <RiverSummaryPanel forecast={forecast.data} />
          </div>
        </div>
      </main>
    </div>
  );
}
