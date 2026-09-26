import type { Express } from "express";
import { createServer, type Server } from "http";
import { execFile } from "child_process";
import { promisify } from "util";
import { activeAlerts, gaugeMetadata, officialThresholds, officialObservations, riverForecasts, weatherPoint, flowEnsembles, officialCoordinate, officialImpacts, officialRecordCrest, clearVolatileOfficialCache } from "./monitoring";
import { isWeatherReport } from "../shared/community";
import { norEasterBrief } from "../shared/noreaster";
import { STORM_SEARCH_URL, selectStormPosts } from "../shared/stormPosts";
import { observationState, peakPrecipitationWindow, precipitationTotal } from "../shared/monitoring";
import { horizonScore, scoreBasin, scoreToRiskLevel } from "../shared/risk";
import { buildFloodPathways } from "../shared/scenarios";
import { createHash } from "crypto";
import type {
  GaugeData, TimeSeriesPoint, ForecastData, WeatherData,
  GaugesResponse, ConfluenceSync, BasinTrend, FrostData, QPFData,
} from "@shared/schema";

const USER_AGENT = "(Floodwatch, https://github.com/optimalthermos/binghamton-flood-dashboard)";
const execFileAsync = promisify(execFile);
const CACHE_TTL = 2 * 60 * 1000; // 2 minutes
const LONG_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
const IMAGE_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const SPC_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const cache: Record<string, CacheEntry<any>> = {};
const sourceRequests = new Map<string, Promise<any>>();
async function loadSource<T>(key: string, fetcher: () => Promise<T>, ttl = CACHE_TTL): Promise<T> {
  const hit = getCached<T>(key, ttl);
  if (hit && !hit.stale) return hit.data;
  if (!sourceRequests.has(key)) {
    sourceRequests.set(key, fetcher().then(data => { setCache(key, data); return data; }).finally(() => sourceRequests.delete(key)));
  }
  return sourceRequests.get(key)!;
}

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
  { id: "01503000", name: "Conklin", river: "Susquehanna River", thresholds: { action: 10, minor: 12, moderate: 15, major: 20 } },
  { id: "01513500", name: "Vestal", river: "Susquehanna River", thresholds: { action: 15, minor: 18, moderate: 21, major: 27 } },
  { id: "01512500", name: "Chenango Forks", river: "Chenango River", thresholds: { action: 8, minor: 10, moderate: 12.6, major: 14 } },
  { id: "01515000", name: "Waverly", river: "Susquehanna River", thresholds: { action: 12, minor: 13, moderate: 16, major: 20 } },
  { id: "01502731", name: "Windsor", river: "Susquehanna River", thresholds: { action: 13, minor: 17, moderate: 19, major: 20.5 } },
  { id: "01502632", name: "Bainbridge", river: "Susquehanna River", thresholds: { action: 13, minor: 15, moderate: 20, major: 22 } },
  { id: "01503500", name: "Binghamton", river: "Susquehanna River", thresholds: { action: 12, minor: 14, moderate: 15, major: 18 }, isBinghamton: true },
  { id: "01511000", name: "Whitney Point Lake", river: "Tioughnioga River (Dam)", thresholds: { action: 1009, minor: 1010 }, isReservoir: true, parameterCd: "62614" },
  { id: "01499500", name: "East Sidney Lake", river: "Ouleout Creek (Dam)", thresholds: { action: 1202, minor: 1203, moderate: 1205, major: 1207 }, isReservoir: true, parameterCd: "62614" },
  { id: "01500000", name: "East Sidney Outflow", river: "Ouleout Creek", thresholds: { action: 4.5, minor: 4.5, moderate: 5, major: 6 } },
  { id: "01531000", name: "Chemung", river: "Chemung River", thresholds: { action: 12, minor: 16, moderate: 20, major: 24 } },
];

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

  const metadataPromise = Promise.allSettled(GAUGE_CONFIG.map(g => gaugeMetadata(g.id)));
  const fetches: Promise<Response | null>[] = [fetchWithUA(regularUrl).catch(() => null)];
  for (const rg of reservoirGauges) {
    const rUrl = `https://waterservices.usgs.gov/nwis/iv/?format=json&sites=${rg.id}&parameterCd=${rg.parameterCd}&period=P3D`;
    fetches.push(fetchWithUA(rUrl).catch(() => null));
  }

  const responses = await Promise.all(fetches);

  const regularRes = responses[0];
  const regularData = regularRes?.ok ? await regularRes.json() : null;
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
    if (!rRes?.ok) continue;

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

  // USGS outages must not blank every station. Use official NWPS observations
  // only for missing series; retain their original timestamps and unit metadata.
  const fallbackSites = new Set<string>();
  await Promise.allSettled(GAUGE_CONFIG.filter(config => {
    const series = config.isReservoir ? gaugeMap[config.id]?.elevTS : gaugeMap[config.id]?.stageTS;
    return !series?.some(p => p.value !== null && Number.isFinite(p.value));
  }).map(async config => {
    const observed = await officialObservations(config.id);
    if (!observed.stageTS.some((p: any) => p.value !== null)) return;
    fallbackSites.add(config.id);
    gaugeMap[config.id] = {
      stageTS: config.isReservoir ? [] : observed.stageTS,
      elevTS: config.isReservoir ? observed.stageTS : [],
      flowTS: observed.flowTS,
    };
  }));
  if (!Object.values(gaugeMap).some(g => [...g.stageTS, ...g.elevTS].some(p => p.value !== null))) {
    throw new Error("USGS and NOAA river observations are unavailable");
  }
  const metadata = await metadataPromise;
  const metaFor = (id: string) => {
    const result = metadata[GAUGE_CONFIG.findIndex(g => g.id === id)];
    return result?.status === "fulfilled" ? result.value : null;
  };
  const allGauges: GaugeData[] = GAUGE_CONFIG.map(config => {
    const gd = gaugeMap[config.id];
    const meta = metaFor(config.id);

    if (config.isReservoir) {
      const elevTS = gd?.elevTS || [];
      const lastElev = elevTS.filter(p => p.value !== null).slice(-1)[0];
      const poolElev = lastElev?.value ?? null;
      const { rate, phase } = computeRecessionRate(elevTS);

      return {
        id: config.id,
        source: fallbackSites.has(config.id) ? "NOAA NWPS" : "USGS",
        name: config.name,
        river: config.river,
        stage: poolElev,
        flow: null,
        stageTimeSeries: elevTS,
        flowTimeSeries: [],
        lastUpdated: lastElev?.timestamp || null,
        trend: computeTrend(elevTS),
        thresholds: officialThresholds(meta),
        latitude: officialCoordinate(meta?.latitude),
        longitude: officialCoordinate(meta?.longitude),
        impacts: officialImpacts(meta),
        recordCrest: officialRecordCrest(meta),
        isBinghamton: false,
        isOffline: !gd || elevTS.length === 0,
        isReservoir: true,
        poolElevation: poolElev,
        floodStoragePct: null,
        poolRangePct: null,
        recessionRate: rate,
        recessionPhase: phase,
      };
    }

    const stageTS = gd?.stageTS || [];
    const flowTS = gd?.flowTS || [];
    const lastStage = stageTS.filter(p => p.value !== null).slice(-1)[0];
    const lastFlow = flowTS.filter(p => p.value !== null).slice(-1)[0];
    const isOffline = !lastStage && !lastFlow;
    const { rate, phase } = computeRecessionRate(stageTS);

    return {
      id: config.id,
      source: fallbackSites.has(config.id) ? "NOAA NWPS" : "USGS",
      name: config.name,
      river: config.river,
      stage: lastStage?.value ?? null,
      flow: lastFlow?.value ?? null,
      stageTimeSeries: stageTS,
      flowTimeSeries: flowTS,
      lastUpdated: lastStage?.timestamp || lastFlow?.timestamp || null,
      trend: computeTrend(stageTS),
      thresholds: officialThresholds(meta),
      latitude: officialCoordinate(meta?.latitude),
      longitude: officialCoordinate(meta?.longitude),
      impacts: officialImpacts(meta),
      recordCrest: officialRecordCrest(meta),
      isBinghamton: config.isBinghamton || false,
      isOffline,
      isReservoir: false,
      recessionRate: rate,
      recessionPhase: phase,
    };
  });

  const confluenceSync = computeConfluenceSync(allGauges);
  const basinTrend = computeBasinTrend(allGauges);

  return { gauges: allGauges, confluenceSync, basinTrend,
    warning: fallbackSites.size ? `USGS data gaps: ${fallbackSites.size} station(s) are using official NOAA observations.` : null } as GaugesResponse;
}

// --- AFD Parsing ---

const NWS_PRODUCT_TIME = /(\d{1,4}\s+(?:AM|PM)\s+[A-Z]{2,4}\s+[A-Za-z]{3}\s+[A-Za-z]{3}\s+\d{1,2}\s+\d{4})/;

function productIssuedAt(text: string): string | null {
  return text.match(NWS_PRODUCT_TIME)?.[1] ?? null;
}

function parseAFD(text: string): { synopsis: string; shortTerm: string; longTerm: string; issuedAt: string; sections: Array<{ heading: string; text: string }> } {
  const issuedAt = productIssuedAt(text);
  if (!issuedAt) throw new Error("NWS forecast discussion issue time unavailable");
  const sections: Array<{ heading: string; text: string }> = [];
  const pattern = /(?:^|\n)\.([A-Z][A-Z0-9 /()-]{2,80}?)\.{2,}\s*\n([\s\S]*?)(?=\n\.[A-Z]|\n&&|\n\$\$|$)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    const heading = match[1].trim();
    const body = match[2].replace(/\n&&\s*$/g, "").trim();
    if (!body || /^(AVIATION|MARINE|FIRE WEATHER|CLIMATE|WATCHES|BGM WATCHES)/i.test(heading)) continue;
    sections.push({ heading, text: body.slice(0, 2000) });
  }
  if (!sections.length) throw new Error("NWS forecast discussion sections unavailable");
  return {
    synopsis: sections[0]?.text || "",
    shortTerm: sections[1]?.text || "",
    longTerm: sections[2]?.text || "",
    issuedAt,
    sections,
  };
}

async function fetchForecast(): Promise<ForecastData> {
  const [afdRes, rvaRes] = await Promise.all([
    fetchWithUA("https://forecast.weather.gov/product.php?site=BGM&issuedby=BGM&product=AFD&format=txt"),
    fetchWithUA("https://forecast.weather.gov/product.php?site=HUN&issuedby=BGM&product=RVA&format=CI&version=1"),
  ]);

  const afdText = afdRes.ok ? await afdRes.text() : "";
  const rvaText = rvaRes.ok ? await rvaRes.text() : "";
  if (!afdRes.ok || !afdText.includes("Forecast Discussion")) throw new Error("NWS forecast discussion unavailable");

  const cleanAfd = afdText.replace(/<[^>]*>/g, "").trim();
  const cleanRva = rvaText
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]*>/g, "")
    .trim();

  const parsed = parseAFD(cleanAfd);
  const riverIssuedAt = productIssuedAt(cleanRva);

  return {
    afd: {
      synopsis: parsed.synopsis,
      shortTerm: parsed.shortTerm,
      longTerm: parsed.longTerm,
      sections: parsed.sections,
      rawText: cleanAfd.slice(0, 8000),
      issuedAt: parsed.issuedAt,
      norEaster: norEasterBrief(cleanAfd),
    },
    riverSummary: {
      text: riverIssuedAt ? cleanRva.slice(0, 5000) : "",
      issuedAt: riverIssuedAt || "",
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
    const point = await weatherPoint();
    const hourlyRes = await fetchWithUA(point.forecastHourly);
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
  const point = await weatherPoint();
  const [obsRes, fcstRes, qpf] = await Promise.all([
    fetchWithUA("https://api.weather.gov/stations/KBGM/observations/latest"),
    fetchWithUA(point.forecast),
    fetchQPF(),
  ]);

  if (!obsRes.ok || !fcstRes.ok) throw new Error(`NWS weather unavailable (${obsRes.status}/${fcstRes.status})`);
  let observedAt: string | null = null;
  let forecastIssuedAt: string | null = null;
  let current: WeatherData["current"] = {
    temp: null, windSpeed: null, windDir: null,
    conditions: null, humidity: null, pressure: null,
  };

  if (obsRes.ok) {
    const obs = await obsRes.json();
    const props = obs?.properties;
    observedAt = props?.timestamp || null;
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
    forecastIssuedAt = fcst?.properties?.updateTime || null;
    forecast = (fcst?.properties?.periods || []).slice(0, 14).map((p: any) => ({
      name: p.name,
      temp: p.temperature,
      shortForecast: p.shortForecast,
      detailedForecast: p.detailedForecast,
      isDaytime: p.isDaytime,
      precipProbability: typeof p.probabilityOfPrecipitation?.value === "number" ? p.probabilityOfPrecipitation.value : null,
      windSpeed: p.windSpeed || null,
      windDirection: p.windDirection || null,
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

  return { current, forecast, frostData, qpf: qpfResult || null, observedAt, forecastIssuedAt,
    stale: observationState(observedAt) !== "current" } as WeatherData;
}

// --- V3 New Fetch Functions ---

async function fetchGroundwater() {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
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
    } catch (err: any) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
  throw lastError || new Error("USGS groundwater unavailable");
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
  const point = await weatherPoint();
  const res = await fetchWithUA(point.forecastGridData);
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

  return { temperatureTimeline: tempTimeline, dewpointTimeline: dewTimeline, qpfTimeline, snowTimeline, windTimeline, rainSnowTransition,
    issuedAt: p?.updateTime || null,
    stale: !p?.updateTime || Date.now() - Date.parse(p.updateTime) > 24 * 3600_000,
    precipitation: {
      next24h: precipitationTotal(p?.quantitativePrecipitation?.values || [], 24),
      next48h: precipitationTotal(p?.quantitativePrecipitation?.values || [], 48),
      next72h: precipitationTotal(p?.quantitativePrecipitation?.values || [], 72),
      peak6h: peakPrecipitationWindow(p?.quantitativePrecipitation?.values || [], 6, 48),
    },
    snowfall48h: precipitationTotal(p?.snowfallAmount?.values || [], 48),
  };
}

async function fetchHistoricalStats() {
  const sites = "01503000,01502731,01502632,01503500,01513500,01512500,01515000";
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
    const { stdout: result } = await execFileAsync("python3", ["server/extract-soil-moisture.py"], {
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

// --- Predictive Outlook Engine ---

const HISTORICAL_FLOODS = [
  {
    name: "Tropical Storm Lee (Sept 2011)",
    description: "Remnants of Lee stalled over basin. 10-15\" rain over 3 days on already-saturated ground from Hurricane Irene 2 weeks prior.",
    triggers: { qpf48: 8, soilMoisturePct: 95, gwDepth: 1, conklinStage: 15, allRising: true },
    severity: "CATASTROPHIC",
    conklinPeak: 23.94,
    vestalPeak: 32.67,
  },
  {
    name: "June 2006 Flood",
    description: "Stalled frontal boundary with tropical moisture. 8-13\" over 3-4 days. Ground saturated from wet spring.",
    triggers: { qpf48: 6, soilMoisturePct: 85, gwDepth: 2, conklinStage: 12, allRising: true },
    severity: "MAJOR",
    conklinPeak: 25.02,
    vestalPeak: 28.13,
  },
  {
    name: "Typical Spring Freshet",
    description: "Snowmelt + moderate rain (2-3\") on saturated ground. Common in March-April.",
    triggers: { qpf48: 2, soilMoisturePct: 70, gwDepth: 5, conklinStage: 10, allRising: false },
    severity: "MINOR",
    conklinPeak: 13.5,
    vestalPeak: 20.0,
  },
  {
    name: "Flash Event (Convective)",
    description: "Localized 3-5\" thunderstorm over ungauged tributaries. Castle Creek / Thomas Creek response.",
    triggers: { qpf48: 3, soilMoisturePct: 60, gwDepth: 8, conklinStage: 8, allRising: false },
    severity: "MODERATE",
    conklinPeak: 14.0,
    vestalPeak: 21.0,
  },
];

async function fetchPredictiveOutlook() {
  // Fetch all upstream data, degrading gracefully on failures
  const [gaugeResult, gridpointResult, soilMoistureResult, groundwaterResult, weatherResult] = await Promise.allSettled([
    loadSource("gauges", fetchGaugeData),
    loadSource("gridpoint-data", fetchGridpointData, 10 * 60 * 1000),
    loadSource("soil-moisture", fetchSoilMoisture, LONG_CACHE_TTL),
    loadSource("groundwater", fetchGroundwater),
    loadSource("weather", fetchWeather),
  ]);

  const gaugeData = gaugeResult.status === "fulfilled" ? gaugeResult.value : null;
  const gridpoint = gridpointResult.status === "fulfilled" ? gridpointResult.value : null;
  const soilMoisture = soilMoistureResult.status === "fulfilled" ? soilMoistureResult.value : null;
  const groundwater = groundwaterResult.status === "fulfilled" ? groundwaterResult.value : null;
  const weather = weatherResult.status === "fulfilled" ? weatherResult.value : null;

  const gauges = gaugeData?.gauges || [];
  const regularGauges = gauges.filter(g => !g.isReservoir && observationState(g.lastUpdated, g.isOffline) === "current");
  const confluenceSync = gaugeData?.confluenceSync;
  const basinTrend = gaugeData?.basinTrend;

  // === FACTOR 1: Stage Proximity (weight 0.25) ===
  const conklin = regularGauges.find(g => g.id === "01503000");
  const conklinActionStage = conklin?.thresholds.action ?? 10;
  if (!conklin || conklin.stage === null || !gridpoint || gridpoint.stale || gridpoint.precipitation.next48h.coverageHours < 47) {
    throw new Error("Analysis requires current Conklin observations and a complete 48-hour precipitation forecast.");
  }
  let stageScore = 0;
  let stageDetail = "No gauge data";
  if (conklin?.stage !== null && conklin?.stage !== undefined) {
    stageScore = Math.min(100, (conklin.stage / conklinActionStage) * 100);
    stageDetail = `Conklin at ${Math.round(stageScore)}% of action stage (${conklin.stage.toFixed(2)}ft / ${conklinActionStage}ft)`;
  }

  // === FACTOR 2: Basin Trend (weight 0.15) ===
  let basinScore = 30;
  let basinDetail = "Stable";
  const btDirection = basinTrend?.direction || "Stable";
  const weightedTrendMag = Math.abs(basinTrend?.weightedTrend || 0);
  if (btDirection === "Loading") {
    basinScore = Math.min(100, 80 * (1 + weightedTrendMag));
    basinDetail = `Basin loading (weighted trend: ${basinTrend?.weightedTrend?.toFixed(3)})`;
  } else if (btDirection === "Draining") {
    basinScore = Math.max(0, 10 * (1 - weightedTrendMag));
    basinDetail = `Basin draining (weighted trend: ${basinTrend?.weightedTrend?.toFixed(3)})`;
  } else {
    basinScore = 30;
    basinDetail = "Basin stable";
  }

  const qpf48Total = gridpoint.precipitation.next48h.inches;
  const qpf24Total = gridpoint.precipitation.next24h.inches;
  const qpf72Total = gridpoint.precipitation.next72h.inches;
  const rain6hInches = gridpoint.precipitation.peak6h ?? 0;
  const snowInches = gridpoint.snowfall48h?.inches ?? 0;
  const rainSnowHours = gridpoint.rainSnowTransition && gridpoint.rainSnowTransition.hoursUntil >= 0 && gridpoint.rainSnowTransition.hoursUntil <= 48
    ? gridpoint.rainSnowTransition.hoursUntil
    : null;
  const windEnd = Date.now() + 48 * 3600_000;
  let windMph: number | null = null;
  for (const point of gridpoint.windTimeline || []) {
    const at = Date.parse(point.time);
    if (!Number.isFinite(at) || at < Date.now() || at > windEnd) continue;
    windMph = windMph === null ? point.speed : Math.max(windMph, point.speed);
  }

  // === FACTOR: Soil Moisture ===
  let soilDetail = "Unknown";
  const soilPct = soilMoisture?.date && Date.now() - Date.parse(soilMoisture.date) < 72 * 3600_000 ? soilMoisture.percentile : null;
  if (soilPct !== null) {
    soilDetail = `${soilPct.toFixed(0)}th percentile — ${soilMoisture?.interpretation || ""}`;
  }

  // === FACTOR 5: Groundwater Saturation (weight 0.10) ===
  let gwScore = 40;
  let gwDetail = "Unknown";
  const gwDepth = observationState(groundwater?.lastUpdated) === "current" ? groundwater?.depth ?? null : null;
  if (gwDepth !== null) {
    if (gwDepth < 2) gwScore = 100;
    else if (gwDepth < 5) gwScore = 70;
    else if (gwDepth < 10) gwScore = 40;
    else gwScore = 10;
    gwDetail = `Groundwater at ${gwDepth.toFixed(2)}ft depth — ${groundwater?.interpretation || ""}`;
  }

  // === FACTOR 6: Confluence Sync (weight 0.10) ===
  let confluenceScore = 20;
  let confluenceDetail = "Stable";
  const csState = confluenceSync?.state || "STABLE";
  if (csState === "BOTH_RISING") {
    confluenceScore = 100;
    confluenceDetail = "Both rivers rising — compound flood risk elevated";
  } else if (csState === "SUSQ_RISING_CHEN_FALLING" || csState === "CHEN_RISING_SUSQ_FALLING") {
    confluenceScore = 50;
    confluenceDetail = `Asymmetric confluence — ${csState.replace(/_/g, " ").toLowerCase()}`;
  } else if (csState === "BOTH_FALLING") {
    confluenceScore = 10;
    confluenceDetail = "Both rivers falling — basin draining";
  } else {
    confluenceScore = 20;
    confluenceDetail = "Confluence stable";
  }

  // === FACTOR 7: Recession Phase (weight 0.10) ===
  let recessionScore = 10;
  let recessionDetail = "No loading gauges";
  const loadingGauges = regularGauges.filter(g => g.recessionPhase === "LOADING");
  if (loadingGauges.length === 0) {
    recessionScore = 10;
    recessionDetail = "All gauges in recession or baseflow";
  } else if (loadingGauges.length === 1) {
    recessionScore = 30;
    recessionDetail = `1 gauge loading: ${loadingGauges.map(g => g.name).join(", ")}`;
  } else if (loadingGauges.length === 2) {
    recessionScore = 70;
    recessionDetail = `2 gauges loading: ${loadingGauges.map(g => g.name).join(", ")}`;
  } else {
    recessionScore = 100;
    recessionDetail = `${loadingGauges.length} gauges loading: ${loadingGauges.map(g => g.name).join(", ")}`;
  }

  const riskInput = {
    stageScore,
    stageDetail,
    basinScore,
    basinDetail,
    qpf48Inches: qpf48Total,
    rain6hInches,
    windMph,
    snowInches,
    rainSnowHours,
    soilPct,
    soilDetail,
    gwScore,
    gwDetail,
    gwAvailable: gwDepth !== null,
    confluenceScore,
    confluenceDetail,
    confluenceAvailable: regularGauges.some(g => g.id === "01512500"),
    recessionScore,
    recessionDetail,
  };
  const scored = scoreBasin(riskInput);
  const compositeScore = scored.compositeScore;
  const riskLevel = scored.riskLevel;
  const factors = scored.factors;
  const unavailable = new Set(factors.filter(factor => factor.weight === 0).map(factor => factor.name));

  const score24 = horizonScore(riskInput, qpf24Total, recessionScore * 0.8);
  const score48 = compositeScore;
  const score72 = horizonScore(riskInput, qpf72Total, Math.max(10, recessionScore - 15));

  // === HISTORICAL PATTERN MATCHING ===
  function computeSimilarity(flood: typeof HISTORICAL_FLOODS[0]): number {
    const fraction = (current: number, target: number) => target <= 0 ? 1 : Math.max(0, Math.min(1, current / target));
    const depthFraction = gwDepth === null ? null : gwDepth <= flood.triggers.gwDepth ? 1 : Math.max(0, Math.min(1, flood.triggers.gwDepth / gwDepth));
    const rain = fraction(qpf48Total, flood.triggers.qpf48);
    const stage = fraction(conklin?.stage ?? 0, flood.triggers.conklinStage);
    const parts = [
      rain,
      ...(soilPct !== null ? [fraction(soilPct, flood.triggers.soilMoisturePct)] : []),
      ...(depthFraction !== null ? [depthFraction] : []),
      stage,
      flood.triggers.allRising ? (csState === "BOTH_RISING" ? 1 : 0) : 1,
    ];
    const average = parts.reduce((sum, part) => sum + part, 0) / parts.length;
    const capped = Math.min(average, Math.max(rain, stage));
    return Math.round(capped * 100);
  }

  const historicalMatches = HISTORICAL_FLOODS
    .map(f => ({
      name: f.name,
      similarity: computeSimilarity(f),
      severity: f.severity,
      description: f.description,
      peakComparison: `Current Conklin ${conklin?.stage?.toFixed(2) ?? "?"}ft vs recorded peak ${f.conklinPeak}ft at Conklin`,
      gap: [
        qpf48Total < f.triggers.qpf48
          ? `${(f.triggers.qpf48 - qpf48Total).toFixed(1)} in less 48-hour rain than the heuristic setup`
          : "48-hour rain meets the heuristic setup",
        (conklin?.stage ?? 0) < f.triggers.conklinStage
          ? `Conklin is ${(f.triggers.conklinStage - (conklin?.stage ?? 0)).toFixed(1)} ft under the stage used in this comparison`
          : "Conklin is at or above the stage used in this comparison",
        f.triggers.allRising && csState !== "BOTH_RISING"
          ? "both rivers are not rising together"
          : f.triggers.allRising ? "both rivers are rising, as in this comparison" : "this comparison does not require both rivers to be rising",
      ].join("; ") + ".",
    }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 3);

  // === NARRATIVE ===
  const primaryFactor = factors[0];
  const topMatch = historicalMatches[0];
  const matchPhrase = topMatch.similarity > 40
    ? ` Current conditions show ${topMatch.similarity}% similarity to a ${topMatch.name.toLowerCase()} pattern.`
    : ` Conditions do not strongly match any historical flood pattern (closest: ${topMatch.name}, ${topMatch.similarity}% similarity).`;

  const escalateQPF = qpf48Total < 1.5 ? "QPF exceeds 1.5\"" : "QPF exceeds 3\"";
  const escalateGW = gwDepth === null || gwDepth > 3 ? "groundwater table rises above 3ft" : "all gauges enter LOADING phase";
  const escalationTrigger = `${escalateQPF} or ${escalateGW}`;
  const deescalationTrigger = "All gauges enter FAST_RECESSION and QPF clears below 0.25\"";

  const watchFor = conklin?.stage !== null && conklin?.stage !== undefined && conklin.stage < conklinActionStage
    ? `Watch for: Conklin stage crossing ${conklinActionStage}ft action level (currently ${conklin.stage.toFixed(2)}ft).`
    : `Watch for: Any gauge crossing minor flood stage.`;

  const narrative = `Experimental risk indicator: ${riskLevel} (${compositeScore}/100), driven primarily by ${primaryFactor.name.toLowerCase()} (${primaryFactor.detail}).${matchPhrase} These heuristic comparisons are not flood probabilities or validated forecasts. ${unavailable.size ? `Missing inputs excluded: ${Array.from(unavailable).join(", ")}. ` : ""}${watchFor}`;

  const binghamton = regularGauges.find(g => g.id === "01503500");
  const reservoirRead = (id: string, name: string) => {
    const gauge = gauges.find(g => g.id === id);
    const current = gauge && observationState(gauge.lastUpdated, gauge.isOffline) === "current";
    return {
      name: gauge?.name || name,
      pool: current ? gauge.poolElevation ?? gauge.stage : null,
      action: gauge?.thresholds.action ?? null,
      minor: gauge?.thresholds.minor ?? null,
    };
  };
  const pathways = buildFloodPathways({
    conklinStage: conklin?.stage ?? null,
    conklinAction: conklin?.thresholds.action ?? null,
    binghamtonStage: binghamton?.stage ?? null,
    binghamtonAction: binghamton?.thresholds.action ?? null,
    loadingNames: loadingGauges.map(g => g.name),
    confluence: csState,
    qpf24: qpf24Total,
    qpf48: qpf48Total,
    soilPct,
    gwDepth,
    frost: weather?.frostData?.significance ?? null,
    precipMentioned: !!weather?.forecast?.some((p: { shortForecast?: string }) => /rain|snow|shower|thunderstorm|drizzle/i.test(p.shortForecast || "")),
    reservoirs: [
      reservoirRead("01511000", "Whitney Point Lake"),
      reservoirRead("01499500", "East Sidney Lake"),
    ],
  });

  return {
    compositeScore,
    riskLevel,
    outlook24h: { score: score24, level: scoreToRiskLevel(score24) },
    outlook48h: { score: score48, level: scoreToRiskLevel(score48) },
    outlook72h: { score: score72, level: scoreToRiskLevel(score72) },
    factors,
    historicalMatches,
    pathways,
    narrative,
    triggers: {
      escalation: escalationTrigger,
      deescalation: deescalationTrigger,
    },
    generatedAt: new Date().toISOString(),
    dataCoverage: `${scored.availableCount}/${factors.length} factors available; ${regularGauges.length} current river gauges`,
    qpf72Complete: gridpoint.precipitation.next72h.coverageHours >= 71,
  };
}

// --- V5: Webcam + Community Feed ---

const BASIN_BOX = { minLat: 41.9, maxLat: 42.5, minLon: -76.6, maxLon: -75.4 };

function inBasin(wkt: string) {
  const match = /POINT\s*\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\)/i.exec(wkt || "");
  if (!match) return false;
  const lon = Number(match[1]);
  const lat = Number(match[2]);
  return lat >= BASIN_BOX.minLat && lat <= BASIN_BOX.maxLat && lon >= BASIN_BOX.minLon && lon <= BASIN_BOX.maxLon;
}

async function fetch511CameraPage(start: number, pageSize: number) {
  let lastError = "511NY camera list unavailable";
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await new Promise(resolve => setTimeout(resolve, 400 * attempt));
    try {
      const response = await fetch("https://511ny.org/List/GetData/Cameras", {
        method: "POST",
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "application/json",
          "Content-Type": "application/json",
          Referer: "https://511ny.org/List/Cameras",
        },
        body: JSON.stringify({
          draw: 1, start, length: pageSize,
          search: { value: "", regex: false },
          order: [{ column: 0, dir: "asc" }],
          columns: [{ data: "location", name: "location", searchable: true, orderable: true, search: { value: "", regex: false } }],
        }),
        signal: AbortSignal.timeout(20_000),
      });
      if (response.ok) return response.json();
      lastError = `511NY camera list returned ${response.status}`;
      if (response.status < 500) break;
    } catch (err: any) {
      lastError = err?.message || lastError;
    }
  }
  throw new Error(lastError);
}

async function mapLimited<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index]);
    }
  }));
  return results;
}

async function fetch511TrafficCameras() {
  const cameras: Array<{
    id: string; name: string; type: "dot"; category: "traffic"; imageUrl: string;
    refreshInterval: number; description: string; sourceUrl: string; publishedAt: string | null;
  }> = [];
  const pageSize = 100;
  const first = await fetch511CameraPage(0, pageSize);
  const total = Number.isFinite(first.recordsFiltered) ? first.recordsFiltered : (Array.isArray(first.data) ? first.data.length : 0);
  const starts: number[] = [];
  for (let start = pageSize; start < total && start < 5000; start += pageSize) starts.push(start);
  const pages = [first, ...await mapLimited(starts, 4, start => fetch511CameraPage(start, pageSize))];
  for (const row of pages.flatMap(page => Array.isArray(page?.data) ? page.data : [])) {
    const image = (row?.images || []).find((img: any) => img && img.disabled !== true && img.imageUrl && Number.isFinite(Number(img.id)));
    if (!image || !inBasin(row?.latLng?.geography?.wellKnownText || "")) continue;
    const imageId = String(image.id);
    if (cameras.some(cam => cam.id === `dot-${imageId}`)) continue;
    cameras.push({
      id: `dot-${imageId}`,
      name: row.location || `Camera ${imageId}`,
      type: "dot",
      category: "traffic",
      imageUrl: `/api/webcams/dot/${imageId}`,
      refreshInterval: 60,
      description: [row.roadway, row.county].filter(Boolean).join(" · ") || "511NY traffic camera",
      sourceUrl: `https://511ny.org/map/Cctv/${imageId}`,
      publishedAt: null,
    });
  }
  await Promise.all(cameras.map(async cam => {
    try {
      const response = await fetch(cam.sourceUrl, {
        method: "HEAD",
        headers: { "User-Agent": USER_AGENT, Referer: "https://511ny.org/List/Cameras" },
        signal: AbortSignal.timeout(8_000),
      });
      cam.publishedAt = response.ok ? response.headers.get("last-modified") : null;
    } catch { cam.publishedAt = null; }
  }));
  return cameras;
}

// USGS and Mesonet camera image cache (30 min TTL)
const USGS_CAM_CACHE_TTL = 5 * 60 * 1000;
const usgsCamCache: Record<string, { buf: Buffer; timestamp: number; publishedAt: string | null }> = {};
const mesonetCamCache: Record<string, { buf: Buffer; timestamp: number }> = {};

const USGS_CAM_URLS: Record<string, string> = {
  "norwich-staff": "https://usgs-nims-images.s3.amazonaws.com/720/NY_Chenango_River_at_Norwich_Staff/NY_Chenango_River_at_Norwich_Staff_newest.jpg",
  "norwich-downstream": "https://usgs-nims-images.s3.amazonaws.com/720/NY_Chenango_River_at_Norwich_Downstream/NY_Chenango_River_at_Norwich_Downstream_newest.jpg",
  towanda: "https://usgs-nims-images.s3.amazonaws.com/720/PA_Susquehanna_River_at_Towanda/PA_Susquehanna_River_at_Towanda_newest.jpg",
  oxford: "https://usgs-nims-images.s3.amazonaws.com/720/NY_Chenango_River_at_Oxford/NY_Chenango_River_at_Oxford_newest.jpg",
  sherburne: "https://usgs-nims-images.s3.amazonaws.com/720/NY_Chenango_River_at_Sherburne/NY_Chenango_River_at_Sherburne_newest.jpg",
};

function hashUsername(username: string): string {
  return createHash("md5").update(username).digest("hex").slice(0, 4).toUpperCase();
}

async function fetchCommunityFeed() {
  const weatherQuery = "flood OR flooding OR rain OR weather OR storm OR snow OR river OR creek";
  const RSS_URLS = [
    { name: "r/binghamton", url: `https://www.reddit.com/r/binghamton/search.rss?q=${encodeURIComponent(weatherQuery)}&restrict_sr=on&sort=new&t=month&limit=15` },
    { name: "r/BroomeCounty", url: `https://www.reddit.com/r/BroomeCounty/search.rss?q=${encodeURIComponent(weatherQuery)}&restrict_sr=on&sort=new&t=month&limit=10` },
    { name: "r/upstate_new_york", url: `https://www.reddit.com/r/binghamton+upstate_new_york/search.rss?q=${encodeURIComponent(weatherQuery)}&restrict_sr=on&sort=new&t=month&limit=10` },
  ];

  const IMAGE_SOURCES = /i\.redd\.it|preview\.redd\.it|imgur|\.(jpg|jpeg|png)/i;

  function extractTagText(xml: string, tag: string): string {
    const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\/${tag}>`, "i"));
    if (!m) return "";
    return m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim();
  }

  function extractAttr(xml: string, tag: string, attr: string): string {
    const m = xml.match(new RegExp(`<${tag}[^>]*\\s${attr}=["']([^"']*)["'][^>]*>`, "i"));
    return m ? m[1] : "";
  }

  function extractFirstImageUrl(html: string): string | null {
    const m = html.match(/(https?:\/\/[^\s"'>]+\.(?:jpg|jpeg|png|gif)|https?:\/\/(?:i\.redd\.it|preview\.redd\.it|i\.imgur\.com)\/[^\s"'>]+)/i);
    return m ? m[1] : null;
  }

  function extractSubreddit(link: string): string {
    const m = link.match(/reddit\.com\/r\/([^\/]+)/i);
    return m ? m[1] : "reddit";
  }

  function plainExcerpt(html: string): string {
    const decoded = html
      .replace(/&amp;/g, "&")
      .replace(/&nbsp;/g, " ")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, "\"")
      .replace(/&#39;|&apos;/g, "'");
    const text = decoded
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
      .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
      .replace(/\s*submitted by\s+\/u\/\S+[\s\S]*$/i, "")
      .replace(/\[link\]|\[comments\]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!text || text.length < 40) return "";
    return text.length > 180 ? `${text.slice(0, 177)}…` : text;
  }

  const allPosts: Array<{
    title: string;
    date: string;
    subreddit: string;
    link: string;
    hasImage: boolean;
    imageUrl: string | null;
    isFloodRelated: boolean;
    anonymizedAuthor: string;
    excerpt: string;
  }> = [];

  const seenLinks = new Set<string>();
  let successfulFeeds = 0;

  const sources: string[] = [];
  for (const feed of RSS_URLS) {
    try {
      const res = await fetchWithUA(feed.url, 12000);
      if (!res.ok) continue;
      const xml = await res.text();
      if (!xml.includes("<feed")) continue;
      successfulFeeds++;
      sources.push(feed.name);

      // Split into <entry> blocks
      const entryRegex = /<entry>([\s\S]*?)<\/entry>/gi;
      let m;
      while ((m = entryRegex.exec(xml)) !== null) {
        const entry = m[1];

        const title = extractTagText(entry, "title");
        const updated = extractTagText(entry, "updated");
        const linkHref = extractAttr(entry, "link", "href");
        const authorName = extractTagText(entry, "name");
        const content = extractTagText(entry, "content") || extractTagText(entry, "summary");

        if (!linkHref || seenLinks.has(linkHref)) continue;
        seenLinks.add(linkHref);

        const hasImage = IMAGE_SOURCES.test(content);
        const imageUrl = hasImage ? extractFirstImageUrl(content) : null;
        const isFloodRelated = isWeatherReport(`${title} ${content}`);
        if (!isFloodRelated) continue;
        const anonymizedAuthor = authorName ? `User-${hashUsername(authorName)}` : "User-????";
        const subreddit = extractSubreddit(linkHref);

        const excerpt = plainExcerpt(content);
        allPosts.push({
          title: title || "(no title)",
          date: updated || new Date().toISOString(),
          subreddit,
          link: linkHref,
          hasImage,
          imageUrl,
          isFloodRelated,
          anonymizedAuthor,
          excerpt: excerpt && excerpt !== title ? excerpt : "",
        });
      }
    } catch (_e) {
      // Skip failed feed
    }
  }

  // Sort by date descending, flood-related first
  if (!successfulFeeds) throw new Error("Community feeds unavailable");
  allPosts.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const floodPosts = allPosts;
  const sorted = allPosts;

  return {
    posts: sorted,
    lastUpdated: new Date().toISOString(),
    floodPostCount: floodPosts.length,
    totalPosts: sorted.length,
    sources,
    stale: successfulFeeds < RSS_URLS.length,
  };
}

// --- Route Registration ---

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", version: "3.6.0", timestamp: new Date().toISOString() });
  });

  // Helper for standard cached route
  const inFlight = new Map<string, Promise<any>>();
  function cachedRoute<T>(path: string, cacheKey: string, fetcher: () => Promise<T>, ttl = CACHE_TTL) {
    app.get(path, async (req, res) => {
      try {
        const force = req.query.fresh === "1";
        if (force) {
          delete cache[cacheKey];
          if (cacheKey === "predictive-outlook") {
            delete cache.gauges;
            delete cache.weather;
            delete cache.groundwater;
            delete cache["gridpoint-data"];
          }
          clearVolatileOfficialCache();
        }
        const cached = force ? null : getCached<T>(cacheKey, ttl);
        res.set("Cache-Control", "no-store");
        if (cached && !cached.stale) return res.json({ ...cached.data as any, retrievedAt: new Date(cache[cacheKey].timestamp).toISOString() });
        if (!inFlight.has(cacheKey)) {
          const task = loadSource(cacheKey, fetcher, ttl)
            .finally(() => inFlight.delete(cacheKey));
          inFlight.set(cacheKey, task);
        }
        const data = await inFlight.get(cacheKey);
        return res.json({ ...data, retrievedAt: new Date(cache[cacheKey].timestamp).toISOString() });
      } catch (err: any) {
        const cached = getCached<T>(cacheKey, ttl);
        if (cached) return res.json({ ...cached.data as any, stale: true, error: err.message,
          retrievedAt: new Date(cache[cacheKey].timestamp).toISOString() });
        return res.status(502).json({ error: err.message, stale: true });
      }
    });
  }

  cachedRoute("/api/gauges", "gauges", fetchGaugeData);
  cachedRoute("/api/forecast", "forecast", fetchForecast);
  cachedRoute("/api/weather", "weather", fetchWeather);
  cachedRoute("/api/ensemble", "ensemble", flowEnsembles, 30 * 60 * 1000);
  cachedRoute("/api/news", "news", activeAlerts);
  cachedRoute("/api/river-forecasts", "river-forecasts", riverForecasts, 5 * 60 * 1000);
  cachedRoute("/api/groundwater", "groundwater", fetchGroundwater);
  cachedRoute("/api/surface-obs", "surface-obs", fetchSurfaceObs);
  cachedRoute("/api/gridpoint-data", "gridpoint-data", fetchGridpointData, 10 * 60 * 1000);
  cachedRoute("/api/historical-stats", "historical-stats", fetchHistoricalStats, LONG_CACHE_TTL);
  cachedRoute("/api/soil-moisture", "soil-moisture", fetchSoilMoisture, LONG_CACHE_TTL);
  cachedRoute("/api/predictive-outlook", "predictive-outlook", fetchPredictiveOutlook, 5 * 60 * 1000);

  // Image proxy endpoints
  app.get("/api/radar-image", async (req, res) => {
    try {
      const cached = getCached<Buffer>("radar-img", IMAGE_CACHE_TTL);
      if (req.query.fresh !== "1" && cached && !cached.stale) {
        res.set("Content-Type", "image/png");
        return res.send(cached.data);
      }
      const imgRes = await fetchWithUA(
        "https://mesonet.agron.iastate.edu/cgi-bin/wms/nexrad/n0q.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.1.1&LAYERS=nexrad-n0q&SRS=EPSG:4326&BBOX=-76.145,41.998,-75.322,42.353&WIDTH=768&HEIGHT=420&FORMAT=image/png&TRANSPARENT=TRUE"
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

  // V5: Webcam metadata (expanded with USGS river cams, Mesonet, and additional DOT cameras)
  cachedRoute("/api/webcams", "webcams-meta", async () => {
    const cameras: Array<{
      id: string; name: string; type: "usgs" | "nws" | "dot"; category: "river" | "weather" | "traffic";
      imageUrl: string; refreshInterval: number; description: string; sourceUrl?: string; publishedAt?: string | null;
    }> = [
      // River cameras (USGS — most valuable for flood monitoring)
      { id: "usgs-norwich-staff", name: "Chenango River at Norwich — Staff Gauge", type: "usgs" as const, category: "river" as const, imageUrl: "/api/webcams/usgs/norwich-staff", refreshInterval: 300, description: "USGS river-level reference view; the label uses the image's published time" },
      { id: "usgs-norwich-downstream", name: "Chenango River at Norwich — Downstream", type: "usgs" as const, category: "river" as const, imageUrl: "/api/webcams/usgs/norwich-downstream", refreshInterval: 300, description: "USGS downstream view; the label uses the image's published time" },
      { id: "usgs-towanda", name: "Susquehanna River at Towanda, PA", type: "usgs" as const, category: "river" as const, imageUrl: "/api/webcams/usgs/towanda", refreshInterval: 300, description: "Downstream basin context; periodic USGS image" },
      { id: "usgs-oxford", name: "Chenango River at Oxford", type: "usgs" as const, category: "river" as const, imageUrl: "/api/webcams/usgs/oxford", refreshInterval: 300, description: "USGS 01505010 — upstream Chenango, bridge view" },
      { id: "usgs-sherburne", name: "Chenango River at Sherburne", type: "usgs" as const, category: "river" as const, imageUrl: "/api/webcams/usgs/sherburne", refreshInterval: 300, description: "USGS 01505000 — upstream Chenango, river bend" },
      // Weather cameras
      { id: "nws", name: "NWS Binghamton Office", type: "nws" as const, category: "weather" as const, imageUrl: "/api/webcams/nws", refreshInterval: 180, description: "South view from NWS BGM office" },
    ];
    try {
      cameras.push(...await fetch511TrafficCameras());
    } catch { /* Traffic snapshots are optional; river and weather cameras still return. */ }
    await Promise.all(cameras.filter(c => c.type === "usgs").map(async cam => {
      const key = cam.imageUrl.split("/").pop()!;
      try {
        const response = await fetch(USGS_CAM_URLS[key], { method: "HEAD", signal: AbortSignal.timeout(5000) });
        Object.assign(cam, { publishedAt: response.ok ? response.headers.get("last-modified") : null,
          sourceUrl: USGS_CAM_URLS[key] });
      } catch { Object.assign(cam, { publishedAt: null, sourceUrl: USGS_CAM_URLS[key] }); }
    }));
    return { cameras };
  }, 60_000);

  // V6: USGS river webcam proxy (direct S3 JPEG, cache 30 min)
  app.get("/api/webcams/usgs/:location", async (req, res) => {
    const location = req.params.location;
    const sourceUrl = USGS_CAM_URLS[location];
    if (!sourceUrl) return res.status(404).json({ error: "Unknown USGS camera location" });

    const cached = usgsCamCache[location];
    if (req.query.fresh !== "1" && cached && Date.now() - cached.timestamp < USGS_CAM_CACHE_TTL) {
      res.set("Content-Type", "image/jpeg");
      res.set("Cache-Control", "no-store");
      if (cached.publishedAt) res.set("Last-Modified", cached.publishedAt);
      return res.send(cached.buf);
    }

    try {
      const imgRes = await fetchWithUA(sourceUrl, 12000);
      if (!imgRes.ok) throw new Error(`USGS camera returned ${imgRes.status}`);
      const buf = Buffer.from(await imgRes.arrayBuffer());
      const publishedAt = imgRes.headers.get("last-modified");
      usgsCamCache[location] = { buf, timestamp: Date.now(), publishedAt };
      res.set("Content-Type", "image/jpeg");
      res.set("Cache-Control", "no-store");
      if (publishedAt) res.set("Last-Modified", publishedAt);
      return res.send(buf);
    } catch (err: any) {
      return res.status(502).json({ error: err.message });
    }
  });

  // V6: Mesonet/Ventusky webcam proxy (hourly image, try current hour then fallback to previous)
  app.get("/api/webcams/mesonet/:station", async (req, res) => {
    const station = req.params.station;
    if (station !== "bing") return res.status(404).json({ error: "Unknown camera station" });
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10).replace(/-/g, "");
    const hour = now.getUTCHours().toString().padStart(2, "0");
    const previous = new Date(now.getTime() - 3600_000);
    const prevDate = previous.toISOString().slice(0, 10).replace(/-/g, "");
    const prevHour = previous.getUTCHours().toString().padStart(2, "0");
    const cacheKey = `mesonet-${station}-${dateStr}${hour}`;

    const cached = mesonetCamCache[cacheKey];
    if (cached && Date.now() - cached.timestamp < USGS_CAM_CACHE_TTL) {
      res.set("Content-Type", "image/jpeg");
      return res.send(cached.buf);
    }

    const urls = [
      `https://webcams.ventusky.com/data/91/332236991/hour/${dateStr}_${hour}00.jpg`,
      `https://webcams.ventusky.com/data/91/332236991/hour/${prevDate}_${prevHour}00.jpg`,
    ];

    for (const url of urls) {
      try {
        const imgRes = await fetchWithUA(url, 8000);
        if (!imgRes.ok) continue;
        const buf = Buffer.from(await imgRes.arrayBuffer());
        for (const key of Object.keys(mesonetCamCache)) {
          if (Date.now() - mesonetCamCache[key].timestamp > USGS_CAM_CACHE_TTL) delete mesonetCamCache[key];
        }
        mesonetCamCache[cacheKey] = { buf, timestamp: Date.now() };
        res.set("Content-Type", "image/jpeg");
        return res.send(buf);
      } catch { /* try next URL */ }
    }

    // Return stale cache if available (any key for this station)
    const staleKey = Object.keys(mesonetCamCache).find(k => k.startsWith(`mesonet-${station}-`) && Date.now() - mesonetCamCache[k].timestamp < USGS_CAM_CACHE_TTL);
    if (staleKey) {
      res.set("Content-Type", "image/jpeg");
      return res.send(mesonetCamCache[staleKey].buf);
    }
    return res.status(502).json({ error: "Mesonet camera unavailable" });
  });

  // V5: NWS webcam proxy
  app.get("/api/webcams/nws", async (req, res) => {
    try {
      const cached = getCached<{ body: Buffer; publishedAt: string | null }>("nws-webcam-img", 3 * 60 * 1000);
      if (req.query.fresh !== "1" && cached && !cached.stale) {
        res.set("Content-Type", "image/jpeg");
        res.set("Cache-Control", "no-store");
        if (cached.data.publishedAt) res.set("Last-Modified", cached.data.publishedAt);
        return res.send(cached.data.body);
      }
      const imgRes = await fetchWithUA("https://www.weather.gov/images/bgm/southview.jpg", 12000);
      if (!imgRes.ok) throw new Error(`NWS webcam returned ${imgRes.status}`);
      const body = Buffer.from(await imgRes.arrayBuffer());
      const publishedAt = imgRes.headers.get("last-modified");
      setCache("nws-webcam-img", { body, publishedAt });
      res.set("Content-Type", "image/jpeg");
      res.set("Cache-Control", "no-store");
      if (publishedAt) res.set("Last-Modified", publishedAt);
      return res.send(body);
    } catch (err: any) {
      return res.status(502).json({ error: err.message });
    }
  });

  app.get("/api/webcams/dot/:cameraId", async (req, res) => {
    const cameraId = req.params.cameraId;
    if (!/^\d+$/.test(cameraId)) return res.status(404).json({ error: "Unknown camera ID" });
    const sourceUrl = `https://511ny.org/map/Cctv/${cameraId}`;
    try {
      const cached = getCached<{ body: Buffer; type: string; publishedAt: string | null }>(`dot-cam-${cameraId}`, 60_000);
      if (req.query.fresh !== "1" && cached && !cached.stale) {
        res.set("Content-Type", cached.data.type);
        if (cached.data.publishedAt) res.set("Last-Modified", cached.data.publishedAt);
        return res.send(cached.data.body);
      }
      const imgRes = await fetch(sourceUrl, {
        headers: { "User-Agent": USER_AGENT, Referer: "https://511ny.org/List/Cameras" },
        signal: AbortSignal.timeout(12_000),
      });
      if (!imgRes.ok) throw new Error(`511NY camera returned ${imgRes.status}`);
      const body = Buffer.from(await imgRes.arrayBuffer());
      const type = imgRes.headers.get("content-type") || "image/jpeg";
      const publishedAt = imgRes.headers.get("last-modified");
      setCache(`dot-cam-${cameraId}`, { body, type, publishedAt });
      res.set("Content-Type", type);
      if (publishedAt) res.set("Last-Modified", publishedAt);
      return res.send(body);
    } catch (err: any) {
      return res.status(502).json({ error: err.message });
    }
  });

  // V5: Community feed (Reddit RSS)
  cachedRoute("/api/community-feed", "community-feed", fetchCommunityFeed, 5 * 60 * 1000);

  async function fetchStormPosts() {
    const res = await fetchWithUA("https://api.fxtwitter.com/2/profile/NWSBinghamton/statuses?count=40", 12000);
    if (!res.ok) throw new Error(`Storm posts returned ${res.status}`);
    const body = await res.json();
    return {
      posts: selectStormPosts(body?.results),
      lastUpdated: new Date().toISOString(),
      source: "NWSBinghamton",
      searchUrl: STORM_SEARCH_URL,
    };
  }

  cachedRoute("/api/storm-posts", "storm-posts", fetchStormPosts, 5 * 60 * 1000);

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
      if (req.query.fresh !== "1" && cached && !cached.stale) {
        res.set("Content-Type", "image/gif");
        return res.send(cached.data);
      }
      const imgRes = await fetchWithUA(url, 12000);
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
