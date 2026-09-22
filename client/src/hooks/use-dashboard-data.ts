import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { observationState } from "@shared/monitoring";

const INTERVAL = 300_000;
export function useDashboardData() {
  const client = useQueryClient();
  const [now, setNow] = useState(Date.now());
  const [nextRefresh, setNextRefresh] = useState(Date.now() + INTERVAL);
  const [paused, setPaused] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const gauges = useQuery<any>({ queryKey: ["/api/gauges"], staleTime: INTERVAL });
  const news = useQuery<any>({ queryKey: ["/api/news"], staleTime: INTERVAL });
  const weather = useQuery<any>({ queryKey: ["/api/weather"], staleTime: INTERVAL });
  const riverForecasts = useQuery<any>({ queryKey: ["/api/river-forecasts"], staleTime: INTERVAL });
  const gridpointData = useQuery<any>({ queryKey: ["/api/gridpoint-data"], staleTime: 600_000 });
  const forecast = useQuery<any>({ queryKey: ["/api/forecast"], staleTime: INTERVAL });
  const webcams = useQuery<any>({ queryKey: ["/api/webcams"], staleTime: 600_000 });
  const communityFeed = useQuery<any>({ queryKey: ["/api/community-feed"], staleTime: INTERVAL });
  const groundwater = useQuery<any>({ queryKey: ["/api/groundwater"], staleTime: INTERVAL });
  const soilMoisture = useQuery<any>({ queryKey: ["/api/soil-moisture"], staleTime: 86400_000 });

  const sources = [
    { name: "River observations", provider: "USGS", url: "https://waterservices.usgs.gov/", query: gauges,
      detail: "Observation timestamps checked individually; stale after 2 hours." },
    { name: "Official alerts", provider: "NWS", url: "https://api.weather.gov/alerts/active?zone=NYC007,NYC107,NYC017,NYC025", query: news,
      detail: "Broome, Tioga, Chenango and Delaware counties, NY. Expired alerts excluded." },
    { name: "River forecasts", provider: "NOAA NWPS", url: "https://water.noaa.gov/wfo/bgm", query: riverForecasts,
      detail: "Official deterministic forecasts, not probabilities. Issuance stale after 36 hours." },
    { name: "Weather observations", provider: "NWS KBGM", url: "https://api.weather.gov/stations/KBGM/observations/latest", query: weather,
      detail: "Airport weather observations; forecast point is downtown Binghamton." },
    { name: "Precipitation forecast", provider: "NWS", url: "https://api.weather.gov/points/42.0987,-75.9180", query: gridpointData,
      detail: "Downtown point forecast, not a basin average. Interval overlap is prorated." },
    { name: "Forecast discussion", provider: "NWS Binghamton", url: "https://forecast.weather.gov/product.php?site=BGM&issuedby=BGM&product=AFD&format=txt", query: forecast,
      detail: "Issued by NWS Binghamton. Refer to the issue time within the product." },
    { name: "Camera directory", provider: "USGS / NWS / NYSDOT", url: "https://511ny.org/", query: webcams,
      detail: "Directory availability does not confirm camera availability or image capture time." },
    { name: "Community reports", provider: "Reddit", url: "https://www.reddit.com/r/binghamton/new/", query: communityFeed,
      detail: "Unverified community posts, not official warnings." },
    { name: "Groundwater", provider: "USGS", url: "https://waterdata.usgs.gov/monitoring-location/USGS-421556075281602/", query: groundwater,
      detail: "One monitoring well, not a basin-wide estimate. Observation stale after two hours." },
    { name: "Soil moisture", provider: "NOAA CPC", url: "https://www.cpc.ncep.noaa.gov/", query: soilMoisture,
      detail: "Daily grid-cell percentile; requires optional rasterio processing. Missing values stay missing." },
  ].map(source => {
    const q = source.query;
    const timestamp = q.data?.retrievedAt;
    const age = timestamp ? now - Date.parse(timestamp) : Infinity;
    const observationGap = source.name === "River observations" &&
      q.data?.gauges?.some((g: any) => observationState(g.lastUpdated, g.isOffline, now) !== "current");
    const forecastGap = source.name === "River forecasts" &&
      q.data?.sites?.some((s: any) => s.stale || s.error);
    const sensorStale = source.name === "Groundwater" ? observationState(q.data?.lastUpdated, false, now) !== "current" :
      source.name === "Soil moisture" ? !q.data?.date || now - Date.parse(q.data.date) > 72 * 3600_000 : false;
    const state = q.isPending ? "checking" : q.isError || !q.data ? "unavailable" :
      q.data.stale || q.data.error || sensorStale || age > (source.name === "Soil moisture" ? 48 * 3600_000 : 15 * 60_000) ? "stale" :
      observationGap || forecastGap ? "partial" : "current";
    return { ...source, state, timestamp, error: q.error?.message || q.data?.error };
  });

  const refreshAll = useCallback(async () => {
    setNextRefresh(Date.now() + INTERVAL);
    await client.invalidateQueries({ predicate: q => String(q.queryKey[0]).startsWith("/api/") });
  }, [client]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    const connectivity = () => setOnline(navigator.onLine);
    window.addEventListener("online", connectivity);
    window.addEventListener("offline", connectivity);
    return () => { clearInterval(timer); window.removeEventListener("online", connectivity); window.removeEventListener("offline", connectivity); };
  }, []);
  useEffect(() => {
    if (!paused && online && now >= nextRefresh) void refreshAll();
  }, [now, nextRefresh, paused, online, refreshAll]);

  const isRefreshing = sources.some(s => s.query.isFetching);
  const coreSources = sources.slice(0, 5);
  const connectionStatus = !online ? "offline" : coreSources.some(s => s.state === "checking") ? "checking" :
    coreSources.some(s => s.state !== "current") ? "partial" : "current";
  return { gauges, news, weather, riverForecasts, gridpointData, forecast, webcams, communityFeed, groundwater, soilMoisture,
    sources, refreshAll, now, paused, setPaused, online, isRefreshing, connectionStatus,
    countdown: Math.max(0, Math.ceil((nextRefresh - now) / 1000)) };
}
