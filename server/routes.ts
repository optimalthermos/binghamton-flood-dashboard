import type { Express } from "express";
import { createServer, type Server } from "http";
import { execSync } from "child_process";
import type {
  GaugeData, TimeSeriesPoint, ForecastData, WeatherData, EnsembleData,
  GaugesResponse, ConfluenceSync, BasinTrend, FrostData, QPFData, NewsData, NewsItem,
  EnsembleBounds,
} from "@shared/schema";

const USER_AGENT = "(binghamton-flood-dashboard, contact@example.com)";
const CACHE_TTL = 2 * 60 * 1000; // 2 minutes
const LONG_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
const IMAGE_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const SPC_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const cache: Record<string, CacheEntry<any>> = {};

function getCached<T>(key: string, ttl = CACHE_TTL): { data: T; stale: boolean } | null {
  const entry = cache[key];
  if (!entry) return null;
  const age = Date.now() - entry.timestamp;
  if (age < ttl) return { data: entry.data, stale: false };
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
  { id: "01499500", name: "East Sidney Lake", river: "Ouleout Creek (Dam)", thresholds: {}, isReservoir: true, parameterCd: "62614", conservationPool: 1110, floodPool: 1213 },
  { id: "01500000", name: "East Sidney Outflow", river: "Ouleout Creek", thresholds: {} },
  { id: "01531000", name: "Chemung", river: "Chemung River", thresholds: { action: 11, minor: 13, moderate: 17, major: 20 } },
];

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

  let closest = valid[0];
  let closestDiff = Math.abs(new Date(valid[0].timestamp).getTime() - target24h);
  for (const p of valid) {
    const d = Math.abs(new Date(p.timestamp).getTime() - target24h);
    if (d < closestDiff) {
      closest = p;
      closestDiff = d;
    }
  }

  if (closestDiff > 6 * 3600 * 1000) return { rate: null, phase: null };

  const currentVal = valid[valid.length - 1].value!;
  const pastVal = closest.value!;
  const hoursDiff = (now - new Date(closest.timestamp).getTime()) / 3600000;
  if (hoursDiff < 1) return { rate: null, phase: null };

  const rate = (pastVal - currentVal) / (hoursDiff / 24);

  let phase: "FAST_RECESSION" | "BASEFLOW" | "LOADING" | null = null;
  if (rate < 0) phase = "LOADING";
  else if (rate >= 0.5) phase = "FAST_RECESSION";
  else phase = "BASEFLOW";

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
    state = "BOTH_RISING"; riskLevel = "HIGH";
  } else if (conklinTrend === "Falling" && chenangoTrend === "Falling") {
    state = "BOTH_FALLING"; riskLevel = "LOW";
  } else if (conklinTrend === "Rising" && (chenangoTrend === "Falling" || chenangoTrend === "Steady")) {
    state = "SUSQ_RISING_CHEN_FALLING"; riskLevel = "MODERATE";
  } else if (chenangoTrend === "Rising" && (conklinTrend === "Falling" || conklinTrend === "Steady")) {
    state = "CHEN_RISING_SUSQ_FALLING"; riskLevel = "MODERATE";
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

function cToF(c: number | null): number | null {
  if (c === null || c === undefined) return null;
  return Math.round((c * 9 / 5 + 32) * 10) / 10;
}

// --- Fetch Functions ---

async function fetchGaugeData(): Promise<GaugesResponse> {
  const regularGauges = GAUGE_CONFIG.filter(g => !g.isReservoir);
  const reservoirGauges = GAUGE_CONFIG.filter(g => g.isReservoir);

  const regularIds = regularGauges.map(g => g.id).join(",");
  const regularUrl = `https://waterservices.usgs.gov/nwis/iv/?format=json&sites=${regularIds}&parameterCd=00060,00065&period=P3D`;

  const fetches: Promise<Response>[] = [fetchWithUA(regularUrl)];
  for (const rg of reservoirGauges) {
    const rUrl = `https://waterservices.usgs.gov/nwis/iv/?format=json&sites=${rg.id}&parameterCd=${rg.parameterCd}&period=P3D`;
    fetches.push(fetchWithUA(rUrl));
  }

  const responses = await Promise.all(fetches);

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
  // FIX: Remove script tags and their content BEFORE stripping other HTML tags
  const cleanRva = rvaText
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]*>/g, "")
    .trim();

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
    const linePattern = new RegExp(`${nwsId}[^\\n]*`, 'gi');
    const lineMatch = html.match(linePattern);
    if (lineMatch) {
      const numbers: number[] = [];
      for (const line of lineMatch) {
        const numMatches = line.match(/(\d+\.?\d*)/g);
        if (numMatches) {
          for (const n of numMatches) {
            const val = parseFloat(n);
            if (val > 0 && val < 100) numbers.push(val);
          }
        }
      }

      if (numbers.length >= 3) {
        numbers.sort((a, b) => b - a);
        bounds[usgsId] = {
          p10: numbers[0],
          p50: numbers[Math.floor(numbers.length / 2)],
          p90: numbers[numbers.length - 1],
        };
      }
    }
  }

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

// --- V3 New Fetch Functions ---

async function fetchGroundwater() {
  const res = await fetchWithUA("https://waterservices.usgs.gov/nwis/iv/?format=json&sites=421556075281602&parameterCd=72019&period=P7D");
  if (!res.ok) throw new Error(`USGS GW returned ${res.status}`);
  const data = await res.json();
  const ts = data?.value?.timeSeries?.[0];
  const values: TimeSeriesPoint[] = (ts?.values?.[0]?.value || []).map((v: any) => ({
    timestamp: v.dateTime,
    value: v.value !== null && v.value !== "" && v.value !== "-999999" ? parseFloat(v.value) : null,
  }));
  const last = values.filter(p => p.value !== null).slice(-1)[0];
  const depth = last?.value ?? null;
  const trend = computeTrend(values);

  let interpretation = "Unknown";
  if (depth !== null) {
    if (depth > 10) interpretation = "Deep — High Infiltration Capacity";
    else if (depth > 5) interpretation = "Moderate — Some Capacity";
    else if (depth > 2) interpretation = "Shallow — Limited Capacity";
    else interpretation = "Near Surface — Basin Saturated";
  }

  return { depth, trend, timeSeries: values.slice(-168), interpretation, lastUpdated: last?.timestamp || null };
}

async function fetchSurfaceObs() {
  const res = await fetchWithUA("https://api.weather.gov/stations/KBGM/observations/latest");
  if (!res.ok) throw new Error(`KBGM obs returned ${res.status}`);
  const data = await res.json();
  const p = data?.properties;

  const tempC = p?.temperature?.value;
  const dewC = p?.dewpoint?.value;
  const tempF = cToF(tempC);
  const dewF = cToF(dewC);
  const depression = (tempF !== null && dewF !== null) ? Math.round((tempF - dewF) * 10) / 10 : null;
  const windKmh = p?.windSpeed?.value;
  const gustKmh = p?.windGust?.value;
  const visM = p?.visibility?.value;

  return {
    temperature: tempF,
    dewpoint: dewF,
    dewpointDepression: depression,
    relativeHumidity: p?.relativeHumidity?.value !== null ? Math.round(p.relativeHumidity.value) : null,
    windDirection: p?.windDirection?.value ?? null,
    windDirectionCardinal: p?.windDirection?.value !== null ? degreesToCardinal(p.windDirection.value) : null,
    windSpeed: windKmh !== null ? Math.round(windKmh * 0.621371) : null,
    windGust: gustKmh !== null ? Math.round(gustKmh * 0.621371) : null,
    textDescription: p?.textDescription || null,
    visibility: visM !== null ? Math.round(visM * 0.000621371 * 10) / 10 : null,
    isRaining: /rain|drizzle|shower|thunderstorm/i.test(p?.textDescription || ""),
    isSnowing: /snow|sleet|ice pellet|freezing/i.test(p?.textDescription || ""),
    timestamp: p?.timestamp || new Date().toISOString(),
  };
}

function parseGridpointTimeline(rawValues: any[], convertFn?: (v: number) => number): Array<{ time: string; value: number }> {
  if (!rawValues) return [];
  const result: Array<{ time: string; value: number }> = [];
  for (const entry of rawValues) {
    if (entry.value === null || entry.value === undefined) continue;
    const timeStr = entry.validTime?.split("/")?.[0];
    if (!timeStr) continue;
    const val = convertFn ? convertFn(entry.value) : entry.value;
    result.push({ time: timeStr, value: Math.round(val * 100) / 100 });
  }
  return result.slice(0, 48);
}

async function fetchGridpointData() {
  const res = await fetchWithUA("https://api.weather.gov/gridpoints/BGM/66,57");
  if (!res.ok) throw new Error(`NWS gridpoint returned ${res.status}`);
  const data = await res.json();
  const p = data?.properties;

  const tempTimeline = parseGridpointTimeline(p?.temperature?.values, (c) => c * 9 / 5 + 32);
  const dewTimeline = parseGridpointTimeline(p?.dewpoint?.values, (c) => c * 9 / 5 + 32);
  const qpfTimeline = parseGridpointTimeline(p?.quantitativePrecipitation?.values, (mm) => mm / 25.4);
  const snowTimeline = parseGridpointTimeline(p?.snowfallAmount?.values, (mm) => mm / 25.4);
  const windDirRaw = p?.windDirection?.values || [];
  const windSpdRaw = p?.windSpeed?.values || [];

  const windTimeline: Array<{ time: string; direction: number; speed: number }> = [];
  for (let i = 0; i < Math.min(windDirRaw.length, windSpdRaw.length, 48); i++) {
    const dir = windDirRaw[i];
    const spd = windSpdRaw[i];
    if (dir?.value !== null && spd?.value !== null) {
      windTimeline.push({
        time: dir.validTime?.split("/")?.[0] || "",
        direction: dir.value,
        speed: Math.round(spd.value * 0.621371),
      });
    }
  }

  // Find rain/snow transition: first hour temp crosses 32°F
  let rainSnowTransition: { time: string; hoursUntil: number } | null = null;
  const now = Date.now();
  for (let i = 1; i < tempTimeline.length; i++) {
    const prev = tempTimeline[i - 1].value;
    const curr = tempTimeline[i].value;
    if ((prev > 32 && curr <= 32) || (prev <= 32 && curr > 32)) {
      const transTime = new Date(tempTimeline[i].time).getTime();
      rainSnowTransition = {
        time: tempTimeline[i].time,
        hoursUntil: Math.round((transTime - now) / 3600000),
      };
      break;
    }
  }

  return { temperatureTimeline: tempTimeline, dewpointTimeline: dewTimeline, qpfTimeline, snowTimeline, windTimeline, rainSnowTransition };
}

async function fetchHistoricalStats() {
  const sites = "01503000,01513500,01512500,01515000,01502632";
  const res = await fetchWithUA(`https://waterservices.usgs.gov/nwis/stat/?format=rdb&sites=${sites}&statReportType=daily&statTypeCd=all&parameterCd=00060`);
  if (!res.ok) throw new Error(`USGS stats returned ${res.status}`);
  const text = await res.text();

  const now = new Date();
  const month = now.getMonth() + 1;
  const day = now.getDate();

  const result: Record<string, any> = {};
  const lines = text.split("\n");

  for (const line of lines) {
    if (line.startsWith("#") || line.startsWith("5s") || line.startsWith("agency")) continue;
    const parts = line.split("\t");
    if (parts.length < 23) continue;

    const siteNo = parts[1]?.trim();
    const monthNu = parseInt(parts[5]?.trim());
    const dayNu = parseInt(parts[6]?.trim());

    if (monthNu === month && dayNu === day) {
      result[siteNo] = {
        beginYear: parseInt(parts[7]) || null,
        endYear: parseInt(parts[8]) || null,
        count: parseInt(parts[9]) || null,
        maxYear: parseInt(parts[10]) || null,
        max: parseFloat(parts[11]) || null,
        minYear: parseInt(parts[12]) || null,
        min: parseFloat(parts[13]) || null,
        mean: parseFloat(parts[14]) || null,
        p05: parseFloat(parts[15]) || null,
        p10: parseFloat(parts[16]) || null,
        p20: parseFloat(parts[17]) || null,
        p25: parseFloat(parts[18]) || null,
        p50: parseFloat(parts[19]) || null,
        p75: parseFloat(parts[20]) || null,
        p80: parseFloat(parts[21]) || null,
        p90: parseFloat(parts[22]) || null,
        p95: parts[23] ? parseFloat(parts[23]) : null,
      };
    }
  }

  return { date: `${now.toLocaleString("en", { month: "short" })} ${day}`, stats: result };
}

async function fetchSoilMoisture() {
  try {
    const result = execSync("python3 server/extract-soil-moisture.py", {
      timeout: 30000,
      cwd: process.cwd(),
    });
    const data = JSON.parse(result.toString().trim());
    const pct = data.percentile;
    let interpretation = "Unknown";
    if (pct !== null) {
      if (pct > 90) interpretation = "Very Wet — Basin Saturated";
      else if (pct > 70) interpretation = "Above Normal — Primed for Runoff";
      else if (pct > 30) interpretation = "Near Normal";
      else if (pct > 10) interpretation = "Below Normal — Absorptive";
      else interpretation = "Very Dry";
    }
    return { percentile: pct, date: data.date, interpretation, error: data.error || null };
  } catch (err: any) {
    return { percentile: null, date: null, interpretation: "Unavailable", error: err.message };
  }
}

// --- Route Registration ---

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // Helper for standard cached route
  function cachedRoute<T>(path: string, cacheKey: string, fetcher: () => Promise<T>, ttl = CACHE_TTL) {
    app.get(path, async (_req, res) => {
      try {
        const cached = getCached<T>(cacheKey, ttl);
        if (cached && !cached.stale) return res.json(cached.data);
        const data = await fetcher();
        setCache(cacheKey, data);
        return res.json(data);
      } catch (err: any) {
        const cached = getCached<T>(cacheKey, ttl);
        if (cached) return res.json({ ...cached.data as any, stale: true, error: err.message });
        return res.status(500).json({ error: err.message });
      }
    });
  }

  cachedRoute("/api/gauges", "gauges", fetchGaugeData);
  cachedRoute("/api/forecast", "forecast", fetchForecast);
  cachedRoute("/api/weather", "weather", fetchWeather);
  cachedRoute("/api/ensemble", "ensemble", fetchEnsemble);
  cachedRoute("/api/news", "news", fetchNews);
  cachedRoute("/api/groundwater", "groundwater", fetchGroundwater);
  cachedRoute("/api/surface-obs", "surface-obs", fetchSurfaceObs);
  cachedRoute("/api/gridpoint-data", "gridpoint-data", fetchGridpointData, 10 * 60 * 1000);
  cachedRoute("/api/historical-stats", "historical-stats", fetchHistoricalStats, LONG_CACHE_TTL);
  cachedRoute("/api/soil-moisture", "soil-moisture", fetchSoilMoisture, LONG_CACHE_TTL);

  // Image proxy endpoints
  app.get("/api/radar-image", async (_req, res) => {
    try {
      const cached = getCached<Buffer>("radar-img", IMAGE_CACHE_TTL);
      if (cached && !cached.stale) {
        res.set("Content-Type", "image/png");
        return res.send(cached.data);
      }
      const imgRes = await fetch(
        "https://mesonet.agron.iastate.edu/cgi-bin/wms/nexrad/n0q.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.1.1&LAYERS=nexrad-n0q-900913&SRS=EPSG:4326&BBOX=41.3,-76.8,42.8,-74.8&WIDTH=600&HEIGHT=400&FORMAT=image/png&TRANSPARENT=TRUE"
      );
      if (!imgRes.ok) throw new Error(`Radar returned ${imgRes.status}`);
      const buf = Buffer.from(await imgRes.arrayBuffer());
      setCache("radar-img", buf);
      res.set("Content-Type", "image/png");
      return res.send(buf);
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/spc-images/:type", async (req, res) => {
    const type = req.params.type;
    const urls: Record<string, string> = {
      pwat: "https://www.spc.noaa.gov/exper/mesoanalysis/s14/pwtr/pwtr.gif",
      "850mb": "https://www.spc.noaa.gov/exper/mesoanalysis/s14/850mb/850mb.gif",
    };
    const url = urls[type];
    if (!url) return res.status(404).json({ error: "Invalid type" });

    try {
      const cacheKey = `spc-${type}`;
      const cached = getCached<Buffer>(cacheKey, SPC_CACHE_TTL);
      if (cached && !cached.stale) {
        res.set("Content-Type", "image/gif");
        return res.send(cached.data);
      }
      const imgRes = await fetch(url);
      if (!imgRes.ok) throw new Error(`SPC returned ${imgRes.status}`);
      const buf = Buffer.from(await imgRes.arrayBuffer());
      setCache(cacheKey, buf);
      res.set("Content-Type", "image/gif");
      return res.send(buf);
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  return httpServer;
}
