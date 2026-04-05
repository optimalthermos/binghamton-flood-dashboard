import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import type { GaugeData, ForecastData, WeatherData, EnsembleData } from "@shared/schema";

const REFRESH_INTERVAL = 300000; // 5 minutes

export function useDashboardData() {
  const queryClient = useQueryClient();
  const [countdown, setCountdown] = useState(REFRESH_INTERVAL / 1000);
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const timerRef = useRef<ReturnType<typeof setInterval>>();
  const countdownRef = useRef<ReturnType<typeof setInterval>>();

  const gauges = useQuery<GaugeData[]>({
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

  const refreshAll = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["/api/gauges"] });
    queryClient.invalidateQueries({ queryKey: ["/api/forecast"] });
    queryClient.invalidateQueries({ queryKey: ["/api/weather"] });
    queryClient.invalidateQueries({ queryKey: ["/api/ensemble"] });
    setLastRefresh(new Date());
    setCountdown(REFRESH_INTERVAL / 1000);
  }, [queryClient]);

  // Auto-refresh timer
  useEffect(() => {
    timerRef.current = setInterval(refreshAll, REFRESH_INTERVAL);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [refreshAll]);

  // Countdown timer
  useEffect(() => {
    countdownRef.current = setInterval(() => {
      setCountdown(c => Math.max(0, c - 1));
    }, 1000);
    return () => { if (countdownRef.current) clearInterval(countdownRef.current); };
  }, []);

  const isAnyLoading = gauges.isLoading || forecast.isLoading || weather.isLoading;
  const isAnyError = gauges.isError || forecast.isError || weather.isError;

  // Check if data is stale (>10 min old)
  const isDataStale = Date.now() - lastRefresh.getTime() > 10 * 60 * 1000;

  const connectionStatus: "live" | "stale" | "offline" =
    isAnyError ? "offline" : isDataStale ? "stale" : "live";

  return {
    gauges,
    forecast,
    weather,
    ensemble,
    refreshAll,
    countdown,
    lastRefresh,
    isAnyLoading,
    connectionStatus,
    isDataStale,
  };
}
