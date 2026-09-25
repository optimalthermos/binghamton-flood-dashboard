import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import type { GaugesResponse, ForecastData, WeatherData, EnsembleData, NewsData } from "@shared/schema";

const REFRESH_INTERVAL = 300000; // 5 minutes

export function useDashboardData() {
  const queryClient = useQueryClient();
  const [countdown, setCountdown] = useState(REFRESH_INTERVAL / 1000);
  const [lastRefresh, setLastRefresh] = useState(new Date(0));
  const timerRef = useRef<ReturnType<typeof setInterval>>();
  const countdownRef = useRef<ReturnType<typeof setInterval>>();

  const gauges = useQuery<GaugesResponse>({
    queryKey: ["/api/gauges"],
    staleTime: REFRESH_INTERVAL,
    refetchInterval: false,
  });

  const forecast = useQuery<ForecastData>({
    queryKey: ["/api/forecast"],
    staleTime: REFRESH_INTERVAL,
    refetchInterval: false,
  });

  const weather = useQuery<WeatherData>({
    queryKey: ["/api/weather"],
    staleTime: REFRESH_INTERVAL,
    refetchInterval: false,
  });

  const ensemble = useQuery<EnsembleData>({
    queryKey: ["/api/ensemble"],
    staleTime: REFRESH_INTERVAL,
    refetchInterval: false,
  });

  const news = useQuery<NewsData>({
    queryKey: ["/api/news"],
    staleTime: REFRESH_INTERVAL,
    refetchInterval: false,
  });

  // V3 new queries
  const groundwater = useQuery<any>({
    queryKey: ["/api/groundwater"],
    staleTime: REFRESH_INTERVAL,
    refetchInterval: false,
  });

  const surfaceObs = useQuery<any>({
    queryKey: ["/api/surface-obs"],
    staleTime: REFRESH_INTERVAL,
    refetchInterval: false,
  });

  const gridpointData = useQuery<any>({
    queryKey: ["/api/gridpoint-data"],
    staleTime: 600000, // 10 min
    refetchInterval: false,
  });

  const historicalStats = useQuery<any>({
    queryKey: ["/api/historical-stats"],
    staleTime: 86400000, // 24 hours
    refetchInterval: false,
  });

  const soilMoisture = useQuery<any>({
    queryKey: ["/api/soil-moisture"],
    staleTime: 86400000,
    refetchInterval: false,
  });

  const predictiveOutlook = useQuery<any>({
    queryKey: ["/api/predictive-outlook"],
    staleTime: REFRESH_INTERVAL,
    refetchInterval: false,
  });

  // V5: Webcam metadata + community feed
  const webcams = useQuery<any>({
    queryKey: ["/api/webcams"],
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  const communityFeed = useQuery<any>({
    queryKey: ["/api/community-feed"],
    staleTime: REFRESH_INTERVAL,
    refetchInterval: false,
  });

  const refreshAll = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["/api/gauges"] });
    queryClient.invalidateQueries({ queryKey: ["/api/forecast"] });
    queryClient.invalidateQueries({ queryKey: ["/api/weather"] });
    queryClient.invalidateQueries({ queryKey: ["/api/ensemble"] });
    queryClient.invalidateQueries({ queryKey: ["/api/news"] });
    queryClient.invalidateQueries({ queryKey: ["/api/groundwater"] });
    queryClient.invalidateQueries({ queryKey: ["/api/surface-obs"] });
    queryClient.invalidateQueries({ queryKey: ["/api/gridpoint-data"] });
    queryClient.invalidateQueries({ queryKey: ["/api/predictive-outlook"] });
    queryClient.invalidateQueries({ queryKey: ["/api/community-feed"] });
    queryClient.invalidateQueries({ queryKey: ["/api/webcams"] });
    // Don't refresh daily caches on every cycle
    setCountdown(REFRESH_INTERVAL / 1000);
  }, [queryClient]);

  useEffect(() => {
    timerRef.current = setInterval(refreshAll, REFRESH_INTERVAL);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [refreshAll]);

  useEffect(() => {
    countdownRef.current = setInterval(() => {
      setCountdown(c => Math.max(0, c - 1));
    }, 1000);
    return () => { if (countdownRef.current) clearInterval(countdownRef.current); };
  }, []);

  useEffect(() => {
    const queries = [gauges, forecast, weather];
    if (queries.every(q => q.dataUpdatedAt && !(q.data as any)?.stale && !q.isError)) {
      setLastRefresh(new Date(Math.min(...queries.map(q => q.dataUpdatedAt))));
    }
  }, [gauges.dataUpdatedAt, forecast.dataUpdatedAt, weather.dataUpdatedAt, gauges.isError, forecast.isError, weather.isError]);

  const isAnyLoading = gauges.isFetching || forecast.isFetching || weather.isFetching;
  const isAnyError = gauges.isError || forecast.isError || weather.isError;
  const isDataStale = !lastRefresh.getTime() || Date.now() - lastRefresh.getTime() > 10 * 60 * 1000 ||
    [gauges, forecast, weather].some(q => (q.data as any)?.stale);

  const connectionStatus: "live" | "stale" | "offline" =
    isAnyError ? "offline" : isDataStale ? "stale" : "live";

  return {
    gauges,
    forecast,
    weather,
    ensemble,
    news,
    groundwater,
    surfaceObs,
    gridpointData,
    historicalStats,
    soilMoisture,
    predictiveOutlook,
    webcams,
    communityFeed,
    refreshAll,
    countdown,
    lastRefresh,
    isAnyLoading,
    connectionStatus,
    isDataStale,
  };
}
