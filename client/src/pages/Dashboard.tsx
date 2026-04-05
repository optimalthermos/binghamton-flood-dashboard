import { useState } from "react";
import { useDashboardData } from "@/hooks/use-dashboard-data";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  RefreshCw, Sun, Moon, Waves, TrendingUp, TrendingDown, Minus,
  Thermometer, CloudRain, Snowflake, Activity, ChevronDown, ChevronUp,
  ExternalLink, AlertTriangle, CheckCircle, XCircle, Clock, WifiOff, Wifi
} from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, ReferenceLine,
  Legend, ResponsiveContainer, LineChart, Line, Tooltip as RechartsTooltip,
} from "recharts";
import type { GaugeData, WeatherData } from "@shared/schema";

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

// === Mini sparkline for gauge cards ===
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

// === KPI Cards ===
function KPICards({ gauges, weather }: { gauges: GaugeData[] | undefined; weather: WeatherData | undefined }) {
  const onlineGauges = gauges?.filter(g => !g.isOffline) || [];

  // Highest stage relative to action
  const highestPct = onlineGauges.reduce((best, g) => {
    if (g.stage === null || !g.thresholds.action) return best;
    const pct = (g.stage / g.thresholds.action) * 100;
    return pct > best.pct ? { name: g.name, pct, stage: g.stage, action: g.thresholds.action } : best;
  }, { name: "N/A", pct: 0, stage: 0, action: 0 });

  // Basin trend
  const trends = onlineGauges.map(g => g.trend);
  const risingCount = trends.filter(t => t === "Rising").length;
  const fallingCount = trends.filter(t => t === "Falling").length;
  const basinTrend = risingCount > fallingCount ? "Rising" : fallingCount > risingCount ? "Falling" : "Steady";

  // Temp
  const temp = weather?.current?.temp;

  // Freeze risk
  const freezeRisk = weather?.forecast?.some(p => p.temp !== null && p.temp <= 32);

  // Next precip
  const nextPrecip = weather?.forecast?.find(p =>
    p.shortForecast.match(/rain|snow|shower|thunderstorm|precip|drizzle/i)
  );

  // Data freshness
  const freshCount = onlineGauges.filter(g => freshnessMins(g.lastUpdated) < 30).length;

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
      value: basinTrend,
      sub: `${risingCount}↑ ${fallingCount}↓ ${trends.filter(t => t === "Steady").length}→`,
      icon: basinTrend === "Rising" ? <TrendingUp className="h-5 w-5" /> : basinTrend === "Falling" ? <TrendingDown className="h-5 w-5" /> : <Minus className="h-5 w-5" />,
      color: basinTrend === "Rising" ? "text-red-400" : basinTrend === "Falling" ? "text-emerald-400" : "text-blue-400",
    },
    {
      label: "Temperature",
      value: temp !== null && temp !== undefined ? `${temp}°F` : "N/A",
      sub: weather?.current?.conditions || "Loading...",
      icon: <Thermometer className="h-5 w-5" />,
      color: temp !== null && temp !== undefined && temp <= 32 ? "text-blue-400" : "text-foreground",
    },
    {
      label: "Next Precip",
      value: nextPrecip ? nextPrecip.name : "None",
      sub: nextPrecip?.shortForecast?.slice(0, 40) || "No precip in forecast",
      icon: <CloudRain className="h-5 w-5" />,
      color: nextPrecip ? "text-blue-400" : "text-muted-foreground",
    },
    {
      label: "Freeze Risk",
      value: freezeRisk ? "YES" : "No",
      sub: freezeRisk ? "≤32°F in forecast" : "Above freezing",
      icon: <Snowflake className="h-5 w-5" />,
      color: freezeRisk ? "text-blue-400" : "text-muted-foreground",
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

// === Gauge Card ===
function GaugeCard({ gauge, expanded, onToggle }: { gauge: GaugeData; expanded: boolean; onToggle: () => void }) {
  const mins = freshnessMins(gauge.lastUpdated);
  const freshnessColor = mins > 60 ? "text-red-500" : mins > 30 ? "text-orange-400" : "text-muted-foreground";

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

  return (
    <Card className="bg-card border-border cursor-pointer transition-all hover:border-primary/30" onClick={onToggle}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h3 className="font-semibold text-sm">{gauge.name}</h3>
            <p className="text-xs text-muted-foreground">{gauge.river}</p>
          </div>
          <div className="flex items-center gap-2">
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

// === Full Stage/Flow Charts ===
function StageChart({ gauges }: { gauges: GaugeData[] }) {
  const online = gauges.filter(g => !g.isOffline && g.stageTimeSeries.length > 0);
  if (online.length === 0) return null;

  // Build unified time series
  const allTimes = new Set<number>();
  for (const g of online) {
    for (const p of g.stageTimeSeries) {
      if (p.value !== null) allTimes.add(new Date(p.timestamp).getTime());
    }
  }
  const sortedTimes = Array.from(allTimes).sort((a, b) => a - b);

  // Sample to max 300 points
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
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

function FlowChart({ gauges }: { gauges: GaugeData[] }) {
  const online = gauges.filter(g => !g.isOffline && g.flowTimeSeries.length > 0);
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

// === Compound Risk Panel ===
function CompoundRiskPanel({ gauges, weather }: { gauges?: GaugeData[]; weather?: WeatherData }) {
  const onlineGauges = gauges?.filter(g => !g.isOffline) || [];
  const anyAboveAction = onlineGauges.some(g => g.stage !== null && g.thresholds.action && g.stage >= g.thresholds.action);
  const anyNearAction = onlineGauges.some(g => g.stage !== null && g.thresholds.action && g.stage >= g.thresholds.action - 2);
  const freezeRisk = weather?.forecast?.some(p => p.temp !== null && p.temp <= 32);
  const precipExpected = weather?.forecast?.some(p => p.shortForecast.match(/rain|snow|shower/i));

  let riskLevel: "LOW" | "MODERATE" | "ELEVATED" | "HIGH" = "LOW";
  if (anyAboveAction) riskLevel = "HIGH";
  else if (anyNearAction && (freezeRisk || precipExpected)) riskLevel = "ELEVATED";
  else if (freezeRisk || precipExpected || anyNearAction) riskLevel = "MODERATE";

  const riskColors = {
    LOW: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    MODERATE: "bg-amber-500/20 text-amber-400 border-amber-500/30",
    ELEVATED: "bg-orange-500/20 text-orange-400 border-orange-500/30",
    HIGH: "bg-red-500/20 text-red-400 border-red-500/30",
  };

  const riskFactors = [
    { label: "Soil saturation", status: anyAboveAction ? "HIGH — elevated readings" : anyNearAction ? "MODERATE — near action" : "Normal", active: anyAboveAction || anyNearAction },
    { label: "Frost seal risk", status: freezeRisk ? "Freeze forecast (≤32°F)" : "No freeze expected", active: !!freezeRisk },
    { label: "Precip expected", status: precipExpected ? "Rain/snow in forecast" : "Dry forecast period", active: !!precipExpected },
    { label: "Rain-on-frozen-ground", status: freezeRisk && precipExpected ? "POSSIBLE — monitor closely" : "Not expected", active: !!(freezeRisk && precipExpected) },
    { label: "Runoff coefficient", status: freezeRisk ? "0.85-0.95 if ground freezes" : "Normal (0.3-0.5)", active: !!freezeRisk },
    { label: "SAC-SMA frozen ground module", status: "UNCONFIRMED at MARFC", active: false },
    { label: "Whitney Point Dam", status: "Data gap — outlet rehab project", active: true },
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

// === Weather & Forecast Panel ===
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
            {/* Current conditions */}
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
            {/* 7-day forecast */}
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
function AFDPanel({ forecast }: { forecast?: import("@shared/schema").ForecastData }) {
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
  gauges: { isError: boolean; isFetching: boolean };
  forecast: { isError: boolean; isFetching: boolean };
  weather: { isError: boolean; isFetching: boolean };
  ensemble: { isError: boolean; isFetching: boolean };
}) {
  const sources = [
    { name: "USGS Water Services API", status: gauges.isError ? "error" : "ok", url: "https://waterservices.usgs.gov/nwis/iv/", note: "Real-time gauge data" },
    { name: "NWS Forecast API", status: weather.isError ? "error" : "ok", url: "https://api.weather.gov/", note: "Current conditions & 7-day" },
    { name: "NWS AFD/RVA", status: forecast.isError ? "error" : "ok", url: "https://forecast.weather.gov/", note: "Forecast discussions" },
    { name: "MARFC Ensemble", status: ensemble.isError ? "warn" : "ok", url: "https://www.weather.gov/source/erh/mmefs/marfc.GEFS.table.html", note: "GEFS ensemble table" },
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
function RiverSummaryPanel({ forecast }: { forecast?: import("@shared/schema").ForecastData }) {
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
    gauges, forecast, weather, ensemble,
    refreshAll, countdown, lastRefresh,
    isAnyLoading, connectionStatus, isDataStale,
  } = useDashboardData();

  const [isDark, setIsDark] = useState(true);
  const [expandedGauge, setExpandedGauge] = useState<string | null>(null);

  const toggleDark = () => {
    setIsDark(!isDark);
    document.documentElement.classList.toggle("dark");
  };

  const toggleGauge = (id: string) => {
    setExpandedGauge(expandedGauge === id ? null : id);
  };

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
        <KPICards gauges={gauges.data} weather={weather.data} />

        {/* Main two-column layout */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
          {/* Left Column (60%) */}
          <div className="lg:col-span-3 space-y-4">
            {/* Gauge Cards Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {gauges.isLoading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <Card key={i} className="bg-card border-border animate-pulse">
                    <CardContent className="p-4 h-48" />
                  </Card>
                ))
              ) : gauges.data?.map(gauge => (
                <GaugeCard
                  key={gauge.id}
                  gauge={gauge}
                  expanded={expandedGauge === gauge.id}
                  onToggle={() => toggleGauge(gauge.id)}
                />
              ))}
            </div>

            {/* Charts */}
            {gauges.data && <StageChart gauges={gauges.data} />}
            {gauges.data && <FlowChart gauges={gauges.data} />}
          </div>

          {/* Right Column (40%) */}
          <div className="lg:col-span-2 space-y-4">
            <CompoundRiskPanel gauges={gauges.data} weather={weather.data} />
            <WeatherPanel weather={weather.data} />
            <AFDPanel forecast={forecast.data} />
            <DataSourceStatus
              gauges={{ isError: gauges.isError, isFetching: gauges.isFetching }}
              forecast={{ isError: forecast.isError, isFetching: forecast.isFetching }}
              weather={{ isError: weather.isError, isFetching: weather.isFetching }}
              ensemble={{ isError: ensemble.isError, isFetching: ensemble.isFetching }}
            />
            <RiverSummaryPanel forecast={forecast.data} />
          </div>
        </div>
      </main>
    </div>
  );
}
