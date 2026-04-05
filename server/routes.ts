import type { Express } from "express";
import { createServer, type Server } from "http";
import type {
  GaugeData, TimeSeriesPoint, ForecastData, WeatherData, EnsembleData,
  GaugesResponse, ConfluenceSync, BasinTrend, FrostData, QPFData, NewsData, NewsItem,
  EnsembleBounds,
} from "@shared/schema";

const USER_AGENT = "(binghamton-flood-dashboard, contact@example.com)";
const CACHE_TTL = 2 * 60 * 1000; // 2 minutes

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const cache: Record<string, CacheEntry<any>> = {};

function getCached<T>(key: string): { data: T; stale: boolean } | null {
  const entry = cache[key];
  if (!entry) return null;
  const age = Date.now() - entry.timestamp;
  if (age < CACHE_TTL) return { data: entry.data, stale: false };
  return { data: entry.data, stale: true };
}

function setCache<T>(key: string, data: T): void {
  cache[key] = { data, timestamp: Date.now() };
}

async function fetchWithUA(url: string, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

// --- Gauge Configuration ---

const GAUGE_CONFIG: Array<{
  id: string;
  name: string;
  river: string;
  thresholds: { action?: number; minor?: number; moderate?: number; major?: number };
  isBinghamton?: boolean;
  isReservoir?: boolean;
  parameterCd?: string;
  conservationPool?: number;
  floodPool?: number;
}> = [
  { id: "01503000", name: "Conklin", river: "Susquehanna River", thresholds: { action: 10, minor: 12, moderate: 15, major: 18 } },
  { id: "01513500", name: "Vestal", river: "Susquehanna River", thresholds: { action: 15, minor: 18, moderate: 20, major: 25 } },
  { id: "01512500", name: "Chenango Forks", river: "Chenango River", thresholds: { action: 8, minor: 10, moderate: 14, major: 18 } },
  { id: "01515000", name: "Waverly", river: "Susquehanna River", thresholds: { action: 12, minor: 13, moderate: 17, major: 21 } },
  { id: "01502632", name: "Windsor", river: "Susquehanna River", thresholds: { action: 8, minor: 10 } },
  { id: "01512780", name: "Binghamton", river: "Susquehanna River", thresholds: { action: 12, minor: 15 }, isBinghamton: true },
  { id: "01511000", name: "Whitney Point Lake", river: "Tioughnioga River (Dam)", thresholds: {}, isReservoir: true, parameterCd: "62614", conservationPool: 973, floodPool: 1047.5 },
];

// NWS site ID -> USGS site ID mapping for ensemble data
const NWS_TO_USGS: Record<string, string> = {
  "CKLN6": "01503000",
  "VSTN6": "01513500",
  "CNON6": "01512500",
  "WVYN6": "01515000",
  "BNGN6": "01512780",
};

// --- Helpers ---

function computeTrend(series: TimeSeriesPoint[]): "Rising" | "Falling" | "Steady" | "Unknown" {
  const valid = series.filter(p => p.value !== null).slice(-3);
  if (valid.length < 2) return "Unknown";
  const last = valid[valid.length - 1].value!;
  const prev = valid[0].value!;
  const diff = last - prev;
  if (Math.abs(diff) < 0.05) return "Steady";
  return diff > 0 ? "Rising" : "Falling";
}

function computeRecessionRate(series: TimeSeriesPoint[]): { rate: number | null; phase: "FAST_RECESSION" | "BASEFLOW" | "LOADING" | null } {
  const valid = series.filter(p => p.value !== null);
  if (valid.length < 2) return { rate: null, phase: null };

  const now = new Date(valid[valid.length - 1].timestamp).getTime();
  const target24h = now - 24 * 3600 * 1000;

  // Find closest point to 24h ago
  let closest = valid[0];
  let closestDiff = Math.abs(new Date(valid[0].timestamp).getTime() - target24h);
  for (const p of valid) {
    const d = Math.abs(new Date(p.timestamp).getTime() - target24h);
    if (d < closestDiff) {
      closest = p;
      closestDiff = d;
    }
  }

  // Only compute if we found a point within 6 hours of the 24h-ago target
  if (closestDiff > 6 * 3600 * 1000) return { rate: null, phase: null };

  const currentVal = valid[valid.length - 1].value!;
  const pastVal = closest.value!;
  const hoursDiff = (now - new Date(closest.timestamp).getTime()) / 3600000;
  if (hoursDiff < 1) return { rate: null, phase: null };

  // rate = (past - current) / days — positive means falling
  const rate = (pastVal - currentVal) / (hoursDiff / 24);

  let phase: "FAST_RECESSION" | "BASEFLOW" | "LOADING" | null = null;
  if (rate < 0) {
    phase = "LOADING"; // rising
  } else if (rate >= 0.5) {
    phase = "FAST_RECESSION";
  } else {
    phase = "BASEFLOW";
  }

  return { rate: Math.round(rate * 100) / 100, phase };
}

function computeConfluenceSync(gauges: GaugeData[]): ConfluenceSync {
  const conklin = gauges.find(g => g.id === "01503000");
  const chenango = gauges.find(g => g.id === "01512500");

  const conklinTrend = conklin?.trend || "Unknown";
  const chenangoTrend = chenango?.trend || "Unknown";

  let state: ConfluenceSync["state"] = "STABLE";
  let riskLevel: ConfluenceSync["riskLevel"] = "LOW";

  if (conklinTrend === "Rising" && chenangoTrend === "Rising") {
    state = "BOTH_RISING";
    riskLevel = "HIGH";
  } else if (conklinTrend === "Falling" && chenangoTrend === "Falling") {
    state = "BOTH_FALLING";
    riskLevel = "LOW";
  } else if (conklinTrend === "Rising" && (chenangoTrend === "Falling" || chenangoTrend === "Steady")) {
    state = "SUSQ_RISING_CHEN_FALLING";
    riskLevel = "MODERATE";
  } else if (chenangoTrend === "Rising" && (conklinTrend === "Falling" || conklinTrend === "Steady")) {
    state = "CHEN_RISING_SUSQ_FALLING";
    riskLevel = "MODERATE";
  } else {
    state = "STABLE";
    riskLevel = "LOW";
  }

  return { state, conklinTrend, chenangoTrend, riskLevel };
}

function computeBasinTrend(gauges: GaugeData[]): BasinTrend {
  const online = gauges.filter(g => !g.isOffline && !g.isReservoir && g.flow !== null);
  if (online.length === 0) return { direction: "Stable", weightedTrend: 0, netDischarge: 0 };

  let sumWeighted = 0;
  let sumFlow = 0;
  let netDischarge = 0;

  for (const g of online) {
    const flow = g.flow!;
    const sign = g.trend === "Rising" ? 1 : g.trend === "Falling" ? -1 : 0;
    sumWeighted += flow * sign;
    sumFlow += flow;
    netDischarge += flow;
  }

  const weightedTrend = sumFlow > 0 ? sumWeighted / sumFlow : 0;
  let direction: BasinTrend["direction"] = "Stable";
  if (weightedTrend > 0.1) direction = "Loading";
  else if (weightedTrend < -0.1) direction = "Draining";

  return {
    direction,
    weightedTrend: Math.round(weightedTrend * 1000) / 1000,
    netDischarge: Math.round(netDischarge),
  };
}

function degreesToCardinal(deg: number): string {
  const dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return dirs[Math.round(deg / 22.5) % 16];
}

// --- Fetch Functions ---

async function fetchGaugeData(): Promise<GaugesResponse> {
  // Split gauges: regular (00060,00065) vs reservoir (62614)
  const regularGauges = GAUGE_CONFIG.filter(g => !g.isReservoir);
  const reservoirGauges = GAUGE_CONFIG.filter(g => g.isReservoir);

  const regularIds = regularGauges.map(g => g.id).join(",");
  const regularUrl = `https://waterservices.usgs.gov/nwis/iv/?format=json&sites=${regularIds}&parameterCd=00060,00065&period=P3D`;

  // Fetch regular and reservoir gauges in parallel
  const fetches: Promise<Response>[] = [fetchWithUA(regularUrl)];
  for (const rg of reservoirGauges) {
    const rUrl = `https://waterservices.usgs.gov/nwis/iv/?format=json&sites=${rg.id}&parameterCd=${rg.parameterCd}&period=P3D`;
    fetches.push(fetchWithUA(rUrl));
  }

  const responses = await Promise.all(fetches);

  // Parse regular gauges
  const regularRes = responses[0];
  if (!regularRes.ok) throw new Error(`USGS API returned ${regularRes.status}`);
  const regularData = await regularRes.json();
  const regularTS = regularData?.value?.timeSeries || [];

  const gaugeMap: Record<string, { stageTS: TimeSeriesPoint[]; flowTS: TimeSeriesPoint[]; elevTS: TimeSeriesPoint[] }> = {};

  for (const ts of regularTS) {
    const siteCode = ts?.sourceInfo?.siteCode?.[0]?.value;
    const paramCode = ts?.variable?.variableCode?.[0]?.value;
    if (!siteCode || !paramCode) continue;

    if (!gaugeMap[siteCode]) gaugeMap[siteCode] = { stageTS: [], flowTS: [], elevTS: [] };

    const values: TimeSeriesPoint[] = (ts?.values?.[0]?.value || []).map((v: any) => ({
      timestamp: v.dateTime,
      value: v.value !== null && v.value !== "" && v.value !== "-999999" ? parseFloat(v.value) : null,
    }));

    if (paramCode === "00065") gaugeMap[siteCode].stageTS = values;
    if (paramCode === "00060") gaugeMap[siteCode].flowTS = values;
  }

  // Parse reservoir gauges
  for (let i = 0; i < reservoirGauges.length; i++) {
    const rg = reservoirGauges[i];
    const rRes = responses[i + 1];
    if (!rRes.ok) continue;

    try {
      const rData = await rRes.json();
      const rTS = rData?.value?.timeSeries || [];

      if (!gaugeMap[rg.id]) gaugeMap[rg.id] = { stageTS: [], flowTS: [], elevTS: [] };

      for (const ts of rTS) {
        const values: TimeSeriesPoint[] = (ts?.values?.[0]?.value || []).map((v: any) => ({
          timestamp: v.dateTime,
          value: v.value !== null && v.value !== "" && v.value !== "-999999" ? parseFloat(v.value) : null,
        }));
        gaugeMap[rg.id].elevTS = values;
      }
    } catch { /* reservoir data optional */ }
  }

  const allGauges: GaugeData[] = GAUGE_CONFIG.map(config => {
    const gd = gaugeMap[config.id];

    if (config.isReservoir) {
      const elevTS = gd?.elevTS || [];
      const lastElev = elevTS.filter(p => p.value !== null).slice(-1)[0];
      const poolElev = lastElev?.value ?? null;
      const conserv = config.conservationPool || 973;
      const flood = config.floodPool || 1047.5;
      const pct = poolElev !== null ? Math.round(((poolElev - conserv) / (flood - conserv)) * 1000) / 10 : null;
      const { rate, phase } = computeRecessionRate(elevTS);

      return {
        id: config.id,
        name: config.name,
        river: config.river,
        stage: poolElev,
        flow: null,
        stageTimeSeries: elevTS,
        flowTimeSeries: [],
        lastUpdated: lastElev?.timestamp || null,
        trend: computeTrend(elevTS),
        thresholds: config.thresholds,
        isBinghamton: false,
        isOffline: !gd || elevTS.length === 0,
        isReservoir: true,
        poolElevation: poolElev,
        conservationPool: conserv,
        floodStoragePct: pct,
        recessionRate: rate,
        recessionPhase: phase,
      };
    }

    const stageTS = gd?.stageTS || [];
    const flowTS = gd?.flowTS || [];
    const lastStage = stageTS.filter(p => p.value !== null).slice(-1)[0];
    const lastFlow = flowTS.filter(p => p.value !== null).slice(-1)[0];
    const isOffline = !gd || (stageTS.length === 0 && flowTS.length === 0);
    const { rate, phase } = computeRecessionRate(stageTS);

    return {
      id: config.id,
      name: config.name,
      river: config.river,
      stage: lastStage?.value ?? null,
      flow: lastFlow?.value ?? null,
      stageTimeSeries: stageTS,
      flowTimeSeries: flowTS,
      lastUpdated: lastStage?.timestamp || lastFlow?.timestamp || null,
      trend: computeTrend(stageTS),
      thresholds: config.thresholds,
      isBinghamton: config.isBinghamton || false,
      isOffline: isOffline || (config.isBinghamton === true),
      isReservoir: false,
      recessionRate: rate,
      recessionPhase: phase,
    };
  });

  const confluenceSync = computeConfluenceSync(allGauges);
  const basinTrend = computeBasinTrend(allGauges);

  return { gauges: allGauges, confluenceSync, basinTrend };
}

// --- AFD Parsing ---

function parseAFD(text: string): { synopsis: string; shortTerm: string; longTerm: string; issuedAt: string } {
  const issuedMatch = text.match(/(\d{3,4}\s*(AM|PM)\s*\w+\s*\w+\s*\w+\s*\w+\s*\d{4})/i);
  const issuedAt = issuedMatch ? issuedMatch[1] : new Date().toISOString();

  const extractSection = (name: string): string => {
    const patterns = [
      new RegExp(`\\.${name}[.\\.]*\\n([\\s\\S]*?)(?=\\n\\.\\w|$$)`, 'i'),
      new RegExp(`${name}[.\\.]*\\n([\\s\\S]*?)(?=\\n\\.\\w|$$)`, 'i'),
    ];
    for (const pat of patterns) {
      const m = text.match(pat);
      if (m && m[1]?.trim()) return m[1].trim().slice(0, 2000);
    }
    return "";
  };

  return {
    synopsis: extractSection("SYNOPSIS") || extractSection("DISCUSSION"),
    shortTerm: extractSection("SHORT TERM") || extractSection("NEAR TERM"),
    longTerm: extractSection("LONG TERM") || extractSection("EXTENDED"),
    issuedAt,
  };
}

async function fetchForecast(): Promise<ForecastData> {
  const [afdRes, rvaRes] = await Promise.all([
    fetchWithUA("https://forecast.weather.gov/product.php?site=BGM&issuedby=BGM&product=AFD&format=txt"),
    fetchWithUA("https://forecast.weather.gov/product.php?site=HUN&issuedby=BGM&product=RVA&format=CI&version=1"),
  ]);

  const afdText = afdRes.ok ? await afdRes.text() : "";
  const rvaText = rvaRes.ok ? await rvaRes.text() : "";

  const cleanAfd = afdText.replace(/<[^>]*>/g, "").trim();
  const cleanRva = rvaText.replace(/<[^>]*>/g, "").trim();

  const parsed = parseAFD(cleanAfd);

  return {
    afd: {
      synopsis: parsed.synopsis,
      shortTerm: parsed.shortTerm,
      longTerm: parsed.longTerm,
      rawText: cleanAfd.slice(0, 8000),
      issuedAt: parsed.issuedAt,
    },
    riverSummary: {
      text: cleanRva.slice(0, 5000),
      issuedAt: new Date().toISOString(),
    },
  };
}

// --- Weather + Frost Depth + QPF ---

function computeFrostData(forecastPeriods: WeatherData["forecast"]): FrostData {
  let cumulativeFDH = 0;

  for (const p of forecastPeriods) {
    if (p.temp === null) continue;
    if (p.temp < 32) {
      // Each forecast period is ~12 hours for the 7-day forecast
      const degBelow = 32 - p.temp;
      const estimatedHours = 12;
      cumulativeFDH += degBelow * estimatedHours;
    }
  }

  const estimatedDepthInches = 0.7 * Math.sqrt(cumulativeFDH);
  let significance: FrostData["significance"] = "NONE";
  if (cumulativeFDH > 15) significance = "HYDROLOGIC";
  else if (cumulativeFDH > 0) significance = "NUISANCE";

  return {
    cumulativeFDH: Math.round(cumulativeFDH * 10) / 10,
    estimatedDepthInches: Math.round(estimatedDepthInches * 100) / 100,
    significance,
  };
}

async function fetchQPF(): Promise<QPFData | null> {
  try {
    const hourlyRes = await fetchWithUA("https://api.weather.gov/gridpoints/BGM/34,60/forecast/hourly");
    if (hourlyRes.ok) {
      const hourlyData = await hourlyRes.json();
      const periods = hourlyData?.properties?.periods || [];
      const now = Date.now();

      for (const p of periods) {
        const probPrecip = p.probabilityOfPrecipitation?.value;
        if (probPrecip !== null && probPrecip > 30) {
          const periodStart = new Date(p.startTime).getTime();
          const hoursUntil = Math.max(0, Math.round((periodStart - now) / 3600000));

          // Try to extract quantitative precip
          const qpfMatch = p.shortForecast?.match(/(\d+\.?\d*)\s*in/i);
          const amount = qpfMatch ? `${qpfMatch[1]} in` : `${probPrecip}% chance`;

          return {
            amount,
            hoursUntil,
            description: p.shortForecast || "Precipitation expected",
          };
        }
      }
    }
  } catch { /* fallback below */ }

  return null;
}

async function fetchWeather(): Promise<WeatherData> {
  const [obsRes, fcstRes, qpf] = await Promise.all([
    fetchWithUA("https://api.weather.gov/stations/KBGM/observations/latest"),
    fetchWithUA("https://api.weather.gov/gridpoints/BGM/34,60/forecast"),
    fetchQPF(),
  ]);

  let current: WeatherData["current"] = {
    temp: null, windSpeed: null, windDir: null,
    conditions: null, humidity: null, pressure: null,
  };

  if (obsRes.ok) {
    const obs = await obsRes.json();
    const props = obs?.properties;
    if (props) {
      const tempC = props.temperature?.value;
      current = {
        temp: tempC !== null && tempC !== undefined ? Math.round(tempC * 9 / 5 + 32) : null,
        windSpeed: props.windSpeed?.value !== null ? `${Math.round((props.windSpeed?.value || 0) * 0.621371)} mph` : null,
        windDir: props.windDirection?.value !== null ? degreesToCardinal(props.windDirection.value) : null,
        conditions: props.textDescription || null,
        humidity: props.relativeHumidity?.value !== null ? Math.round(props.relativeHumidity.value) : null,
        pressure: props.barometricPressure?.value !== null ? Math.round(props.barometricPressure.value / 100) : null,
      };
    }
  }

  let forecast: WeatherData["forecast"] = [];
  if (fcstRes.ok) {
    const fcst = await fcstRes.json();
    forecast = (fcst?.properties?.periods || []).slice(0, 14).map((p: any) => ({
      name: p.name,
      temp: p.temperature,
      shortForecast: p.shortForecast,
      detailedForecast: p.detailedForecast,
      isDaytime: p.isDaytime,
    }));
  }

  const frostData = computeFrostData(forecast);

  // Derive QPF from 7-day if hourly failed
  let qpfResult = qpf;
  if (!qpfResult) {
    const precipPeriod = forecast.find(p =>
      p.shortForecast.match(/rain|snow|shower|thunderstorm|drizzle/i)
    );
    if (precipPeriod) {
      qpfResult = {
        amount: "Expected",
        hoursUntil: -1,
        description: `${precipPeriod.name}: ${precipPeriod.shortForecast}`,
      };
    }
  }

  return { current, forecast, frostData, qpf: qpfResult || null };
}

// --- Ensemble ---

function parseEnsembleBounds(html: string): EnsembleBounds {
  const bounds: EnsembleBounds = {};

  for (const [nwsId, usgsId] of Object.entries(NWS_TO_USGS)) {
    // Look for rows with this station ID in the HTML table
    // Pattern: station ID followed by numbers in table cells
    const pattern = new RegExp(`${nwsId}[\\s\\S]*?(?:<td[^>]*>|\\s+)(\\d+\\.?\\d*)(?:<\\/td>|\\s+)`, 'gi');
    const numbers: number[] = [];

    // More robust: find the line with station ID and extract all numbers after it
    const linePattern = new RegExp(`${nwsId}[^\\n]*`, 'gi');
    const lineMatch = html.match(linePattern);
    if (lineMatch) {
      for (const line of lineMatch) {
        const numMatches = line.match(/(\d+\.?\d*)/g);
        if (numMatches) {
          for (const n of numMatches) {
            const val = parseFloat(n);
            if (val > 0 && val < 100) numbers.push(val); // reasonable stage values
          }
        }
      }
    }

    if (numbers.length >= 3) {
      // Sort descending — p10 is highest (10% chance of exceeding), p90 is lowest
      numbers.sort((a, b) => b - a);
      bounds[usgsId] = {
        p10: numbers[0],
        p50: numbers[Math.floor(numbers.length / 2)],
        p90: numbers[numbers.length - 1],
      };
    }
  }

  // Fallback hardcoded values from spec if parsing fails
  if (Object.keys(bounds).length === 0) {
    bounds["01503000"] = { p10: 9.4, p50: 6.3, p90: 3.5 };
    bounds["01513500"] = { p10: 14.0, p50: 8.9, p90: 4.6 };
    bounds["01512500"] = { p10: 7.4, p50: 5.4, p90: 3.6 };
    bounds["01515000"] = { p10: 8.5, p50: 5.4, p90: 2.7 };
    bounds["01512780"] = { p10: 8.9, p50: 5.6, p90: 3.2 };
  }

  return bounds;
}

async function fetchEnsemble(): Promise<EnsembleData> {
  const res = await fetchWithUA("https://www.weather.gov/source/erh/mmefs/marfc.GEFS.table.html");
  if (!res.ok) throw new Error(`MARFC GEFS returned ${res.status}`);
  const html = await res.text();
  const ensembleBounds = parseEnsembleBounds(html);

  return {
    rawHtml: html,
    timestamp: new Date().toISOString(),
    ensembleBounds,
  };
}

// --- News & Alerts ---

const CURATED_REPORTS: NewsItem[] = [
  { headline: "Flood Watch in effect through Wed Apr 1 8PM EDT", source: "NWS Binghamton", date: "2026-04-01", url: "https://forecast.weather.gov/showsigwx.php?warnzone=NYZ044", severity: "watch" },
  { headline: "Flood Warning extended: Chenango River at Sherburne expected to reach flood stage", source: "NWS BGM", date: "2026-03-30", url: "https://forecast.weather.gov/", severity: "warning" },
  { headline: "Flooding closes roads across Finger Lakes, Southern Tier — over 2 inches on saturated ground; downed trees in Binghamton", source: "Syracuse.com", date: "2026-04-01", url: "https://www.syracuse.com/", severity: "info" },
  { headline: "Flood Warning: Rapidly rising water occurring/expected in warned area", source: "NWS Instagram", date: "2026-04-04", url: "https://www.instagram.com/nwsbinghamton/", severity: "warning" },
  { headline: "Steuben County travel advisory remains in effect — multiple roads closed due to flooding, damage, debris", source: "Steuben OES", date: "2026-04-01", url: "https://www.steubencony.org/", severity: "advisory" },
  { headline: "Allegany County declares State of Emergency due to widespread flood impacts", source: "FingerLakes1.com", date: "2026-04-01", url: "https://fingerlakes1.com/", severity: "info" },
  { headline: "Flood Warning continues for Onondaga Lake at Liverpool — minor flooding occurring", source: "NWS BGM", date: "2026-04-05", url: "https://forecast.weather.gov/", severity: "warning" },
  { headline: "Susquehanna ice jam causes flooding in Luzerne County — river dropped a couple feet overnight", source: "WHTM abc27", date: "2026-02-24", url: "https://www.abc27.com/", severity: "info" },
];

async function fetchNews(): Promise<NewsData> {
  const alerts: NewsItem[] = [];

  try {
    const res = await fetchWithUA("https://api.weather.gov/alerts/active?area=NY");
    if (res.ok) {
      const data = await res.json();
      const features = data?.features || [];

      for (const f of features) {
        const props = f.properties;
        if (!props) continue;

        // Filter for BGM office and flood-related
        const office = props.senderName || "";
        const event = (props.event || "").toLowerCase();
        const isBGM = office.includes("Binghamton") || office.includes("BGM");
        const isFlood = event.includes("flood");

        if (isBGM && isFlood) {
          let severity: NewsItem["severity"] = "info";
          if (event.includes("warning")) severity = "warning";
          else if (event.includes("watch")) severity = "watch";
          else if (event.includes("advisory")) severity = "advisory";

          alerts.push({
            headline: props.headline || props.event || "NWS Alert",
            source: "NWS Binghamton",
            date: props.effective || new Date().toISOString(),
            url: props["@id"] || "https://forecast.weather.gov/",
            severity,
            isNWSAlert: true,
          });
        }
      }
    }
  } catch { /* alerts are optional */ }

  return { alerts, curatedReports: CURATED_REPORTS };
}

// --- Route Registration ---

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // Health check
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // Gauges (now returns GaugesResponse with confluenceSync and basinTrend)
  app.get("/api/gauges", async (_req, res) => {
    try {
      const cached = getCached<GaugesResponse>("gauges");
      if (cached && !cached.stale) {
        return res.json(cached.data);
      }

      const data = await fetchGaugeData();
      setCache("gauges", data);
      return res.json(data);
    } catch (err: any) {
      const cached = getCached<GaugesResponse>("gauges");
      if (cached) {
        return res.json({ ...cached.data, stale: true, error: err.message });
      }
      return res.status(500).json({ error: err.message });
    }
  });

  // Forecast (AFD + RVA)
  app.get("/api/forecast", async (_req, res) => {
    try {
      const cached = getCached<ForecastData>("forecast");
      if (cached && !cached.stale) {
        return res.json(cached.data);
      }

      const data = await fetchForecast();
      setCache("forecast", data);
      return res.json(data);
    } catch (err: any) {
      const cached = getCached<ForecastData>("forecast");
      if (cached) {
        return res.json({ ...cached.data, stale: true, error: err.message });
      }
      return res.status(500).json({ error: err.message });
    }
  });

  // Weather (now includes frostData and qpf)
  app.get("/api/weather", async (_req, res) => {
    try {
      const cached = getCached<WeatherData>("weather");
      if (cached && !cached.stale) {
        return res.json(cached.data);
      }

      const data = await fetchWeather();
      setCache("weather", data);
      return res.json(data);
    } catch (err: any) {
      const cached = getCached<WeatherData>("weather");
      if (cached) {
        return res.json({ ...cached.data, stale: true, error: err.message });
      }
      return res.status(500).json({ error: err.message });
    }
  });

  // Ensemble (now includes parsed ensembleBounds)
  app.get("/api/ensemble", async (_req, res) => {
    try {
      const cached = getCached<EnsembleData>("ensemble");
      if (cached && !cached.stale) {
        return res.json(cached.data);
      }

      const data = await fetchEnsemble();
      setCache("ensemble", data);
      return res.json(data);
    } catch (err: any) {
      const cached = getCached<EnsembleData>("ensemble");
      if (cached) {
        return res.json({ ...cached.data, stale: true, error: err.message });
      }
      return res.status(500).json({ error: err.message });
    }
  });

  // News & Alerts
  app.get("/api/news", async (_req, res) => {
    try {
      const cached = getCached<NewsData>("news");
      if (cached && !cached.stale) {
        return res.json(cached.data);
      }

      const data = await fetchNews();
      setCache("news", data);
      return res.json(data);
    } catch (err: any) {
      const cached = getCached<NewsData>("news");
      if (cached) {
        return res.json({ ...cached.data, stale: true, error: err.message });
      }
      return res.status(500).json({ error: err.message });
    }
  });

  return httpServer;
}
