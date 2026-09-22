import { lazy, Suspense, useEffect, useState } from "react";
import { useDashboardData } from "@/hooks/use-dashboard-data";
import { ageLabel, observationState, stageCategory } from "@shared/monitoring";
import type { GaugeData } from "@shared/schema";
import { WebcamPanel } from "@/components/WebcamPanel";
import { CommunityFeedPanel } from "@/components/CommunityFeedPanel";
import HamRadioPanel from "@/components/HamRadioPanel";
import { apiUrl } from "@/lib/queryClient";
import { Activity, ArrowDownRight, ArrowUpRight, ArrowUpRight as External, Camera, Check, ChevronRight,
  CloudRain, Download, LayoutDashboard, Moon, Pause, Play, Radio, RefreshCw, Search, ShieldAlert, Star, Sun, Waves } from "lucide-react";

const RiverChart = lazy(() => import("@/components/RiverChart"));
type View = "overview" | "rivers" | "weather" | "cameras" | "community" | "sources";
const views = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "rivers", label: "River gauges", icon: Waves },
  { id: "weather", label: "Forecast & weather", icon: CloudRain },
  { id: "cameras", label: "Cameras", icon: Camera },
  { id: "community", label: "Radio & reports", icon: Radio },
  { id: "sources", label: "Data health", icon: Activity },
] as const;
const dateTime = (s: string) => new Date(s).toLocaleString("en-US", {
  timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short",
});
const number = (v: number | null | undefined, digits = 2) => v == null || !Number.isFinite(v) ? "Not reported" :
  v.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits });

function SourceLink({ href, children }: { href: string; children: React.ReactNode }) {
  return <a className="source-link" href={href} target="_blank" rel="noopener noreferrer">{children}<External size={14} aria-hidden="true" /></a>;
}
function Panel({ title, eyebrow, action, children, className = "" }: {
  title: string; eyebrow?: string; action?: React.ReactNode; children: React.ReactNode; className?: string;
}) {
  return <section className={`fw-panel ${className}`}><div className="panel-heading"><div>
    {eyebrow && <p className="eyebrow">{eyebrow}</p>}<h2>{title}</h2></div>{action}</div>{children}</section>;
}
function Chart(props: React.ComponentProps<typeof RiverChart>) {
  return <Suspense fallback={<div className="chart-empty">Loading chart…</div>}><RiverChart {...props} /></Suspense>;
}
function GaugeTile({ gauge: g, watched, onWatch, onSelect, now }: {
  gauge: GaugeData; watched: boolean; onWatch: () => void; onSelect: () => void; now: number;
}) {
  const state = observationState(g.lastUpdated, g.isOffline, now);
  const category = stageCategory(g.stage, g.thresholds, state === "current");
  const elevated = category.includes("flood") || category === "Action stage";
  return <article className={`gauge-tile ${state !== "current" ? "gauge-muted" : ""}`}>
    <div className="gauge-top"><div><h3>{g.name}</h3><p>{g.river}</p></div>
      <button className={`icon-button star ${watched ? "selected" : ""}`} onClick={onWatch}
        aria-label={`${watched ? "Remove" : "Add"} ${g.name} ${watched ? "from" : "to"} watchlist`} aria-pressed={watched}>
        <Star size={17} fill={watched ? "currentColor" : "none"} /></button></div>
    <div className="gauge-reading"><span>{g.stage == null ? "—" : number(g.stage)}</span><small>ft</small>
      <span className={`state-pill ${state === "current" ? elevated ? "warning" : "" : "warning"}`}>
        {state === "current" ? category : state === "stale" ? "Stale reading" : "Unavailable"}</span></div>
    <div className="gauge-stats"><span>{state === "current" ? g.trend : "Trend unconfirmed"}
      {state === "current" && (g.trend === "Rising" ? <ArrowUpRight size={15} /> : g.trend === "Falling" ? <ArrowDownRight size={15} /> : null)}</span>
      <span>{g.flow == null ? "Flow not reported" : `${number(g.flow, 0)} cfs`}</span></div>
    <div className="threshold-track" aria-hidden="true"><div style={{ width: g.stage != null && g.thresholds.action ? `${Math.max(0, Math.min(100, g.stage / g.thresholds.action * 100))}%` : "0%" }} /></div>
    <div className="gauge-footer"><span>{ageLabel(g.lastUpdated, now)}</span>
      <button onClick={onSelect}>Details <ChevronRight size={14} /></button></div>
  </article>;
}
function ForecastPanel({ query }: { query: any }) {
  const [selected, setSelected] = useState("01503000");
  const sites = query.data?.sites || [];
  const site = sites.find((s: any) => s.id === selected);
  return <Panel title="Official river outlook" eyebrow="NOAA / National Water Prediction Service"
    action={<span className="state-pill">Forecast</span>}>
    <label className="field-label" htmlFor="forecast-station">Forecast station</label>
    <select id="forecast-station" value={selected} onChange={e => setSelected(e.target.value)}>
      {sites.length ? sites.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>) :
        <option value="01503000">Conklin</option>}
    </select>
    {query.isPending ? <div className="chart-empty">Checking official forecasts…</div> :
      !site || query.isError ? <div className="empty-state">River forecast unavailable. Check NOAA directly; this is not an indication of low risk.</div> :
      <><div className="forecast-summary"><div><span className="field-label">Highest remaining forecast stage</span>
        <strong>{site.peak ? `${number(site.peak.stage)} ft` : "Not published"}</strong>
        <p>{site.peak ? dateTime(site.peak.time) : "No future values available"}</p></div>
        <span className={`state-pill ${site.stale || query.data?.stale ? "warning" : ""}`}>{site.stale || query.data?.stale ? "Stale product" : "Official guidance"}</span></div>
        {site.error && <p className="notice-inline">{site.error}</p>}
        <Chart points={site.points} threshold={site.thresholds?.action} forecast />
        <div className="panel-foot"><span>Issued {site.issuedAt ? dateTime(site.issuedAt) : "not reported"}</span>
          <SourceLink href={site.sourceUrl}>NOAA station</SourceLink></div></>}
    <p className="fine-print">A deterministic forecast, not a flood probability. A forecast maximum is not necessarily the final crest. Follow official warnings and local instructions.</p>
  </Panel>;
}
function Imagery() {
  const [kind, setKind] = useState("radar");
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  const labels: Record<string, string> = { radar: "Regional radar", pwat: "Precipitable water", "850mb": "850 mb analysis" };
  return <Panel title="Weather imagery" action={<button className="icon-button" aria-label="Refresh weather image"
    onClick={() => { setFailed(false); setRevision(v => v + 1); }}><RefreshCw size={16} /></button>}>
    <div className="segmented">{Object.entries(labels).map(([id, name]) =>
      <button key={id} aria-pressed={kind === id} onClick={() => { setKind(id); setFailed(false); }} className={kind === id ? "active" : ""}>{name}</button>)}</div>
    <div className="imagery-frame">{failed ? <div className="empty-state">Imagery unavailable. Open the official weather page for current radar.</div> :
      <img src={apiUrl(kind === "radar" ? `/api/radar-image?r=${revision}` : `/api/spc-images/${kind}?r=${revision}`)}
        width="600" height="400" alt={labels[kind]} onError={() => setFailed(true)} loading="lazy" decoding="async" />}</div>
    <div className="panel-foot"><span>Check the timestamp embedded in each image.</span><SourceLink href="https://www.weather.gov/bgm/">NWS Binghamton</SourceLink></div>
  </Panel>;
}
function AlertPanel({ query }: { query: any }) {
  const fresh = !!query.data && !query.isError && !query.data.stale && !query.data.error &&
    Date.now() - Date.parse(query.data.retrievedAt || "") <= 15 * 60_000;
  return <Panel title="Official alerts" eyebrow="Broome · Tioga · Chenango · Delaware, NY"
    action={<ShieldAlert size={20} className="muted" />}>
    {!fresh ? <div className="empty-state">{query.isPending ? "Checking the NWS alert feed…" : "Alert status unconfirmed. The feed is unavailable or stale; check NWS directly."}</div> :
      !query.data.alerts.length ? <div className="alert-clear"><Check size={21} /><div><strong>No active alerts returned</strong>
        <p>For the four monitored counties. This is not an all-clear for every location.</p></div></div> : null}
    {(query.data?.alerts || []).map((a: any) => <details className="alert-item" key={a.url}>
      <summary><span className={`state-pill ${a.severity !== "info" ? "warning" : ""}`}>{a.event || a.severity}</span><strong>{a.headline}</strong></summary>
      <p>{a.area}</p><p>{a.description}</p>{a.instruction && <p><strong>Instructions: </strong>{a.instruction}</p>}
      <p>Expires {a.expires ? dateTime(a.expires) : "not stated"}</p><SourceLink href={a.url}>Official bulletin</SourceLink></details>)}
    <div className="panel-foot"><span>Checked {ageLabel(query.data?.retrievedAt)}</span>
      <SourceLink href="https://www.weather.gov/bgm/">NWS alerts</SourceLink></div>
  </Panel>;
}
export default function Floodwatch() {
  const data = useDashboardData();
  const [view, setView] = useState<View>("overview");
  const [dark, setDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
  const [search, setSearch] = useState("");
  const [river, setRiver] = useState("all");
  const [watchOnly, setWatchOnly] = useState(false);
  const [watchlist, setWatchlist] = useState<string[]>(["01503000", "01513500", "01512500"]);
  const [selected, setSelected] = useState("01503000");
  const [hours, setHours] = useState(72);
  const gaugeList: GaugeData[] = data.gauges.data?.gauges || [];
  const regular = gaugeList.filter(g => !g.isReservoir);
  const usable = data.gauges.isError || data.gauges.data?.stale ? [] :
    regular.filter(g => observationState(g.lastUpdated, g.isOffline, data.now) === "current" && g.stage !== null);
  const selectedGauge = gaugeList.find(g => g.id === selected);
  const filtered = regular.filter(g => (!watchOnly || watchlist.includes(g.id)) && (river === "all" || river === g.river) &&
    `${g.name} ${g.river} ${g.id}`.toLowerCase().includes(search.toLowerCase()));
  const rain = data.gridpointData.data?.precipitation?.next24h;
  const rainUsable = !data.gridpointData.isError && !data.gridpointData.data?.stale && rain?.coverageHours >= 23;
  const alertsUsable = data.sources.find(s => s.name === "Official alerts")?.state === "current";
  const monitoredFloods = usable.filter(g => stageCategory(g.stage, g.thresholds).includes("flood"));
  const toggleWatch = (id: string) => setWatchlist(w => w.includes(id) ? w.filter(i => i !== id) : [...w, id]);
  useEffect(() => { document.documentElement.classList.toggle("dark", dark); document.documentElement.dataset.theme = dark ? "dark" : "light"; }, [dark]);

  function exportCSV() {
    const rows = [["station_id", "name", "river", "stage_ft", "flow_cfs", "observed_at", "freshness", "trend", "action_ft", "minor_flood_ft"],
      ...filtered.map(g => [g.id, g.name, g.river, g.stage ?? "", g.flow ?? "", g.lastUpdated || "",
        observationState(g.lastUpdated, g.isOffline, data.now), g.trend, g.thresholds.action ?? "", g.thresholds.minor ?? ""])];
    const blob = new Blob([rows.map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob), anchor = document.createElement("a");
    anchor.href = url; anchor.download = `floodwatch-gauges-${new Date().toISOString().slice(0, 10)}.csv`; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const tiles = (items: GaugeData[]) => <div className="gauge-grid">{items.map(g => <GaugeTile key={g.id} gauge={g}
    watched={watchlist.includes(g.id)} onWatch={() => toggleWatch(g.id)} now={data.now}
    onSelect={() => { setSelected(g.id); setView("rivers"); }} />)}</div>;
  return <div className="floodwatch">
    <a className="skip-link" href="#main">Skip to dashboard</a>
    <header className="fw-header"><div className="header-inner">
      <button className="brand" onClick={() => setView("overview")} aria-label="Floodwatch Binghamton Basin overview">
        <svg viewBox="0 0 40 40" width="36" height="36" fill="none" aria-hidden="true"><path d="M5 11h30M5 20c5-6 10 6 15 0s10 6 15 0M5 29c5-6 10 6 15 0s10 6 15 0" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /><path d="M20 4v10" stroke="currentColor" strokeWidth="3" /></svg>
        <span>FLOODWATCH<small>BINGHAMTON BASIN</small></span></button>
      <div className="header-actions"><span className={`connection ${data.connectionStatus !== "current" ? "limited" : ""}`}>
        <i />{data.connectionStatus === "checking" ? "Checking feeds" : data.connectionStatus === "current" ? "Core feeds current" :
          data.connectionStatus === "offline" ? "Browser offline" : "Partial coverage"}</span>
        <button className="icon-button" onClick={() => setDark(v => !v)} aria-label={`Switch to ${dark ? "light" : "dark"} mode`}>
          {dark ? <Sun size={19} /> : <Moon size={19} />}</button></div>
    </div></header>
    <nav className="fw-nav" aria-label="Dashboard sections"><div className="nav-inner">
      {views.map(v => <button key={v.id} onClick={() => setView(v.id)} aria-current={view === v.id ? "page" : undefined}
        className={view === v.id ? "active" : ""}><v.icon size={16} aria-hidden="true" />{v.label}</button>)}
    </div></nav>
    <main id="main" className="fw-main">
      <div className="page-heading"><div><p className="eyebrow">SUSQUEHANNA & CHENANGO WATERSHEDS</p>
        <h1>{view === "overview" ? "The basin, at a glance." : views.find(v => v.id === view)?.label}</h1>
        <p className="muted">{new Date(data.now).toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "long", month: "long", day: "numeric", year: "numeric" })} · All times Eastern</p>
      </div><div className="refresh-tools"><span className="refresh-caption">{data.paused ? "Auto-refresh paused" : `Refresh in ${Math.floor(data.countdown / 60)}:${String(data.countdown % 60).padStart(2, "0")}`}</span>
        <button className="icon-button" aria-label={data.paused ? "Resume automatic refresh" : "Pause automatic refresh"} onClick={() => data.setPaused(v => !v)}>
          {data.paused ? <Play size={16} /> : <Pause size={16} />}</button>
        <button className="fw-button" disabled={data.isRefreshing || !data.online} onClick={() => void data.refreshAll()}>
          <RefreshCw size={15} className={data.isRefreshing ? "spin" : ""} />{data.isRefreshing ? "Refreshing" : "Refresh"}</button></div></div>
      {!data.online && <div className="notice-inline" role="status">Your browser is offline. Previously loaded values are not live.</div>}
      {(data.gauges.isError || data.gauges.data?.stale) && <div className="notice-inline" role="status">River observation feed unavailable or stale. Any retained readings are historical, not confirmed current conditions.</div>}
      {view === "overview" && <>
        <div className="metric-grid">
          <div className="metric"><span>Current river gauges</span><strong>{data.gauges.isPending ? "…" : `${usable.length}`}<small> / {regular.length || "—"}</small></strong><p>Observations within 2 hours</p></div>
          <div className="metric"><span>Active official alerts</span><strong>{alertsUsable ? data.news.data.alerts.length : "—"}</strong><p>{alertsUsable ? "Across four monitored counties" : "Status not yet confirmed"}</p></div>
          <div className="metric"><span>Rain forecast · next 24h</span><strong>{rainUsable ? number(rain.inches) : "—"}<small> in</small></strong><p>Downtown Binghamton point</p></div>
          <div className="metric"><span>At or above flood stage</span><strong>{usable.some(g => g.thresholds.minor != null) ? monitoredFloods.length : "—"}</strong><p>Of {usable.filter(g => g.thresholds.minor != null).length} current gauges with flood thresholds</p></div>
        </div>
        <div className="overview-grid"><div className="main-column">
          <Panel title="Your river watchlist" eyebrow="Observed conditions" action={<button className="text-button" onClick={() => setView("rivers")}>All gauges <ChevronRight size={15} /></button>}>
            {data.gauges.isPending ? <div className="empty-state">Loading river observations…</div> : !data.gauges.data ? <div className="empty-state">USGS observations unavailable. Open Data health to check the source.</div> :
              watchlist.length ? tiles(regular.filter(g => watchlist.includes(g.id))) : <div className="empty-state">No watched gauges. Add stations from River gauges.</div>}
            <p className="fine-print">Stars customize this session only. Values are observations, not predictions of conditions at your property.</p>
          </Panel>
          <ForecastPanel query={data.riverForecasts} />
        </div><aside className="side-column">
          <AlertPanel query={data.news} />
          <Panel title="Monitoring notes" eyebrow="Read before interpreting">
            <div className="note-row"><span className="note-number">01</span><div><h3>Missing is not normal</h3><p>{regular.length ? regular.length - usable.length : "Some"} river stations have unavailable or older observations. Stale readings are not used in current-condition counts.</p></div></div>
            <div className="note-row"><span className="note-number">02</span><div><h3>Stage is station-specific</h3><p>Gauge heights use local reference levels. Compare each station with its own official thresholds, not with another river’s height.</p></div></div>
            <div className="note-row"><span className="note-number">03</span><div><h3>Official guidance comes first</h3><p>This independent dashboard is not an emergency warning service. Never use it as the sole basis for a safety decision.</p></div></div>
            <SourceLink href="https://water.noaa.gov/wfo/bgm">Official basin map</SourceLink>
          </Panel>
          <Panel title="Source health" action={<button className="text-button" onClick={() => setView("sources")}>Details <ChevronRight size={15} /></button>}>
            {data.sources.slice(0, 5).map(s => <div className="health-row" key={s.name}><span>{s.name}</span><span className={`state-pill ${s.state !== "current" ? "warning" : ""}`}>{s.state}</span></div>)}
          </Panel>
        </aside></div>
      </>}
      {view === "rivers" && <>
        <h2 className="sr-only">Monitored river stations</h2>
        <div className="filters"><label className="search-box"><Search size={17} /><input type="search" placeholder="Find a station or river" aria-label="Search gauges" value={search} onChange={e => setSearch(e.target.value)} /></label>
          <select aria-label="Filter by river" value={river} onChange={e => setRiver(e.target.value)}><option value="all">All rivers</option>{Array.from(new Set(regular.map(g => g.river))).map(r => <option key={r}>{r}</option>)}</select>
          <button className={`fw-button secondary ${watchOnly ? "chosen" : ""}`} aria-pressed={watchOnly} onClick={() => setWatchOnly(v => !v)}><Star size={15} />Watchlist only</button>
          <button className="fw-button secondary" onClick={exportCSV} disabled={!filtered.length}><Download size={15} />Export CSV</button></div>
        {filtered.length ? tiles(filtered) : <div className="empty-state">{data.gauges.isPending ? "Loading gauges…" : "No stations match, or observations are unavailable. Try clearing your filters."}</div>}
        <Panel title={selectedGauge ? `${selectedGauge.name} · observed stage` : "Station history"} eyebrow="USGS observations"
          action={<div className="segmented">{[24, 72].map(h => <button key={h} aria-pressed={hours === h} className={hours === h ? "active" : ""} onClick={() => setHours(h)}>{h}h</button>)}</div>}>
          {selectedGauge ? <><Chart points={selectedGauge.stageTimeSeries.filter(p => Date.parse(p.timestamp) >= data.now - hours * 3600_000).map(p => ({ time: p.timestamp, stage: p.value }))} threshold={selectedGauge.thresholds.action} />
            <div className="station-details"><p><span>Observation</span><strong>{selectedGauge.lastUpdated ? dateTime(selectedGauge.lastUpdated) : "Not reported"}</strong></p>
              <p><span>Action stage</span><strong>{selectedGauge.thresholds.action == null ? "Not published" : `${selectedGauge.thresholds.action} ft`}</strong></p>
              <p><span>Minor flood stage</span><strong>{selectedGauge.thresholds.minor == null ? "Not published" : `${selectedGauge.thresholds.minor} ft`}</strong></p>
              <p><span>24h stage change</span><strong>{selectedGauge.recessionRate == null ? "Not available" : `${number(-selectedGauge.recessionRate)} ft/day`}</strong></p></div>
            <div className="panel-foot"><span>Thresholds sourced from NOAA NWPS; no hard-coded fallback.</span>
              <SourceLink href={`https://waterdata.usgs.gov/monitoring-location/USGS-${selectedGauge.id}/`}>USGS station</SourceLink></div></> : <div className="empty-state">Select a station’s Details button.</div>}
        </Panel>
        <Panel title="Reservoir observations" eyebrow="Pool elevation is not storage volume">
          <div className="reservoir-grid">{gaugeList.filter(g => g.isReservoir).map(g => <div key={g.id} className="reservoir"><h3>{g.name}</h3>
            <strong>{g.stage == null ? "—" : number(g.stage)} <small>ft elevation</small></strong><p>{ageLabel(g.lastUpdated)} · {observationState(g.lastUpdated, g.isOffline)}</p>
            <SourceLink href={`https://waterdata.usgs.gov/monitoring-location/USGS-${g.id}/`}>USGS datum and details</SourceLink></div>)}</div>
          <p className="fine-print">Elevation datum is defined by the source station. No storage percentage is inferred from elevation.</p>
        </Panel>
      </>}
      {view === "weather" && <div className="overview-grid"><div className="main-column"><ForecastPanel query={data.riverForecasts} /><Imagery />
        <Panel title="Groundwater & soil context" eyebrow="Individual monitoring locations, not basin-wide saturation">
          <div className="station-details"><p><span>USGS monitoring well · depth below land surface</span>
            <strong>{data.groundwater.data?.depth == null ? "Not reported" : `${number(data.groundwater.data.depth)} ft`}</strong>
            <span>Observed {ageLabel(data.groundwater.data?.lastUpdated)} · {observationState(data.groundwater.data?.lastUpdated)}</span></p>
            <p><span>CPC soil-moisture percentile · Binghamton grid cell</span><strong>{data.soilMoisture.data?.percentile == null ? "Unavailable" : `${number(data.soilMoisture.data.percentile, 0)}th percentile`}</strong>
            <span>Product date: {data.soilMoisture.data?.date || "not reported"}</span></p></div>
          <p className="fine-print">A single well or grid cell cannot establish infiltration capacity for the whole watershed. Soil-moisture extraction requires the optional rasterio dependency; unavailable values are never replaced with a baseline estimate.</p>
          <SourceLink href="https://waterdata.usgs.gov/monitoring-location/USGS-421556075281602/">USGS well details</SourceLink>
        </Panel>
        <Panel title="NWS forecast discussion"><p className="fine-print">{data.forecast.data?.afd?.issuedAt || "Issue time unavailable"}</p>
          <p className="discussion">{data.forecast.data?.afd?.synopsis || "Discussion unavailable. Refer to NWS Binghamton."}</p>
          <details className="discussion-details"><summary>Read full discussion</summary><pre>{data.forecast.data?.afd?.rawText || "No discussion loaded."}</pre></details>
          <SourceLink href="https://forecast.weather.gov/product.php?site=BGM&issuedby=BGM&product=AFD&format=txt">NWS original product</SourceLink></Panel>
      </div><aside className="side-column"><Panel title="Weather at KBGM" eyebrow="Airport observation">
        <div className="weather-current"><strong>{number(data.weather.data?.current?.temp, 0)}<small> °F</small></strong><p>{data.weather.data?.current?.conditions || "Conditions unavailable"}</p></div>
        <div className="station-details"><p><span>Wind</span><strong>{data.weather.data?.current?.windDir} {data.weather.data?.current?.windSpeed || "Not reported"}</strong></p><p><span>Humidity</span><strong>{data.weather.data?.current?.humidity == null ? "Not reported" : `${data.weather.data.current.humidity}%`}</strong></p></div>
        <p className="fine-print">Observed {ageLabel(data.weather.data?.observedAt)}. {data.weather.data?.stale || data.weather.isError ? "Observation may be stale." : ""}</p>
      </Panel><Panel title="Precipitation outlook" eyebrow="Downtown point forecast">
        {[24, 48, 72].map(h => { const p = data.gridpointData.data?.precipitation?.[`next${h}h`]; return <div className="rain-row" key={h}><span>Next {h} hours</span><strong>{p?.coverageHours >= h - 1 ? `${number(p.inches)} in` : "Incomplete"}</strong></div>; })}
        <p className="fine-print">Issued {data.gridpointData.data?.issuedAt ? dateTime(data.gridpointData.data.issuedAt) : "not reported"}. {data.gridpointData.data?.stale ? "Stale forecast. " : ""}Forecast interval totals are prorated where they cross a time-window boundary. Not a basin-wide rainfall estimate.</p>
      </Panel><Panel title="Local weather forecast">
        {(data.weather.data?.forecast || []).slice(0, 8).map((p: any) => <details className="weather-period" key={p.name}><summary><strong>{p.name}</strong><span>{p.temp}°F</span></summary><p>{p.detailedForecast}</p></details>)}
        {!data.weather.data?.forecast?.length && <p className="empty-state">Weather forecast unavailable.</p>}
      </Panel></aside></div>}
      {view === "cameras" && <><div className="notice-inline">Periodically retrieved snapshots, not verified live video. Capture times may differ from retrieval times. Check any timestamp embedded in the image.</div>
        <WebcamPanel webcamsData={data.webcams.data} isLoading={data.webcams.isPending} />
        {data.webcams.isError && <div className="empty-state">Camera directory unavailable. Please try Refresh.</div>}</>}
      {view === "community" && <div className="overview-grid"><div className="main-column"><HamRadioPanel />
        <div className="notice-inline">Scanner feeds and radio details depend on third-party availability. This dashboard does not verify radio licensing, reception, or current net activity.</div></div>
        <aside className="side-column"><CommunityFeedPanel feedData={data.communityFeed.data} isLoading={data.communityFeed.isPending} />
          {data.communityFeed.isError && <div className="empty-state">Community feed unavailable. No posts loaded does not mean no incidents.</div>}</aside></div>}
      {view === "sources" && <><Panel title="A transparent view of every feed" eyebrow="Availability is not the same as freshness"
        action={<span className="state-pill">{data.sources.filter(s => s.state === "current").length}/{data.sources.length} current</span>}>
        <div className="source-list">{data.sources.map(s => <article className="source-row" key={s.name}><div><h3>{s.name}<span>{s.provider}</span></h3><p>{s.detail}</p>
          {s.error && <p className="notice-inline">{s.error}</p>}<SourceLink href={s.url}>Open provider</SourceLink></div>
          <div className="source-state"><span className={`state-pill ${s.state !== "current" ? "warning" : ""}`}>{s.state}</span><p>Retrieved {ageLabel(s.timestamp, data.now)}</p></div></article>)}</div></Panel>
        <Panel title="How to read Floodwatch"><div className="method-grid"><div><h3>Current, partial, stale</h3><p>“Current” means the source request succeeded within its freshness window. River observations older than two hours are marked stale. “Partial” means some stations or forecasts are missing. It never means an all-clear.</p></div>
          <div><h3>What changed in this release</h3><p>Hard-coded news, guessed ensemble bands, synthetic risk scores and historical similarity percentages have been retired. Official NOAA forecasts and alerts are shown with their timestamps instead.</p></div>
          <div><h3>Limits of the view</h3><p>Coverage is not exhaustive. Tributaries, ice jams, road flooding and very localized storms may not be reflected in the monitored stations. Forecasts can change between updates.</p></div></div></Panel></>}
      <footer className="fw-footer"><span>FLOODWATCH <span className="muted">/ Independent basin monitoring · v4.0</span></span>
        <span>Not affiliated with NOAA, NWS or USGS. <a href="https://www.weather.gov/safety/flood" target="_blank" rel="noopener noreferrer">Official flood safety guidance</a></span></footer>
    </main>
  </div>;
}
