import type { Express } from "express";
import { createServer, type Server } from "http";
import type { GaugeData, TimeSeriesPoint, ForecastData, WeatherData, EnsembleData } from "@shared/schema";

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

const GAUGE_CONFIG: Array<{
  id: string;
  name: string;
  river: string;
  thresholds: { action?: number; minor?: number; moderate?: number; major?: number };
  isBinghamton?: boolean;
}> = [
  { id: "01503000", name: "Conklin", river: "Susquehanna River", thresholds: { action: 10, minor: 12, moderate: 15, major: 18 } },
  { id: "01513500", name: "Vestal", river: "Susquehanna River", thresholds: { action: 15, minor: 18, moderate: 20, major: 25 } },
  { id: "01512500", name: "Chenango Forks", river: "Chenango River", thresholds: { action: 8, minor: 10, moderate: 14, major: 18 } },
  { id: "01515000", name: "Waverly", river: "Susquehanna River", thresholds: { action: 12, minor: 13, moderate: 17, major: 21 } },
  { id: "01502632", name: "Windsor", river: "Susquehanna River", thresholds: { action: 8, minor: 10 } },
  { id: "01512780", name: "Binghamton", river: "Susquehanna River", thresholds: { action: 12, minor: 15 }, isBinghamton: true },
];

function computeTrend(series: TimeSeriesPoint[]): "Rising" | "Falling" | "Steady" | "Unknown" {
  const valid = series.filter(p => p.value !== null).slice(-3);
  if (valid.length < 2) return "Unknown";
  const last = valid[valid.length - 1].value!;
  const prev = valid[0].value!;
  const diff = last - prev;
  if (Math.abs(diff) < 0.05) return "Steady";
  return diff > 0 ? "Rising" : "Falling";
}

async function fetchGaugeData(): Promise<GaugeData[]> {
  const siteIds = GAUGE_CONFIG.map(g => g.id).join(",");
  const url = `https://waterservices.usgs.gov/nwis/iv/?format=json&sites=${siteIds}&parameterCd=00060,00065&period=P3D`;

  const res = await fetchWithUA(url);
  if (!res.ok) throw new Error(`USGS API returned ${res.status}`);

  const data = await res.json();
  const timeSeries = data?.value?.timeSeries || [];

  const gaugeMap: Record<string, { stageTS: TimeSeriesPoint[]; flowTS: TimeSeriesPoint[] }> = {};

  for (const ts of timeSeries) {
    const siteCode = ts?.sourceInfo?.siteCode?.[0]?.value;
    const paramCode = ts?.variable?.variableCode?.[0]?.value;
    if (!siteCode || !paramCode) continue;

    if (!gaugeMap[siteCode]) gaugeMap[siteCode] = { stageTS: [], flowTS: [] };

    const values: TimeSeriesPoint[] = (ts?.values?.[0]?.value || []).map((v: any) => ({
      timestamp: v.dateTime,
      value: v.value !== null && v.value !== "" && v.value !== "-999999" ? parseFloat(v.value) : null,
    }));

    if (paramCode === "00065") gaugeMap[siteCode].stageTS = values;
    if (paramCode === "00060") gaugeMap[siteCode].flowTS = values;
  }

  return GAUGE_CONFIG.map(config => {
    const gd = gaugeMap[config.id];
    const stageTS = gd?.stageTS || [];
    const flowTS = gd?.flowTS || [];
    const lastStage = stageTS.filter(p => p.value !== null).slice(-1)[0];
    const lastFlow = flowTS.filter(p => p.value !== null).slice(-1)[0];

    const isOffline = !gd || (stageTS.length === 0 && flowTS.length === 0);

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
    };
  });
}

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

  // Strip HTML tags from NWS product pages
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

async function fetchWeather(): Promise<WeatherData> {
  const [obsRes, fcstRes] = await Promise.all([
    fetchWithUA("https://api.weather.gov/stations/KBGM/observations/latest"),
    fetchWithUA("https://api.weather.gov/gridpoints/BGM/34,60/forecast"),
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

  return { current, forecast };
}

function degreesToCardinal(deg: number): string {
  const dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return dirs[Math.round(deg / 22.5) % 16];
}

async function fetchEnsemble(): Promise<EnsembleData> {
  const res = await fetchWithUA("https://www.weather.gov/source/erh/mmefs/marfc.GEFS.table.html");
  if (!res.ok) throw new Error(`MARFC GEFS returned ${res.status}`);
  const html = await res.text();
  return {
    rawHtml: html,
    timestamp: new Date().toISOString(),
  };
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // Health check
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // Gauges
  app.get("/api/gauges", async (_req, res) => {
    try {
      const cached = getCached<GaugeData[]>("gauges");
      if (cached && !cached.stale) {
        return res.json(cached.data);
      }

      const data = await fetchGaugeData();
      setCache("gauges", data);
      return res.json(data);
    } catch (err: any) {
      const cached = getCached<GaugeData[]>("gauges");
      if (cached) {
        return res.json(cached.data.map(g => ({ ...g, stale: true, error: err.message })));
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

  // Weather
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

  // Ensemble
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

  return httpServer;
}
