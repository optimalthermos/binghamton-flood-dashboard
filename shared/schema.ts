import { z } from "zod";

export const gaugeThresholdsSchema = z.object({
  action: z.number().optional(),
  minor: z.number().optional(),
  moderate: z.number().optional(),
  major: z.number().optional(),
});

export const timeSeriesPointSchema = z.object({
  timestamp: z.string(),
  value: z.number().nullable(),
});

export const gaugeDataSchema = z.object({
  id: z.string(),
  name: z.string(),
  river: z.string(),
  stage: z.number().nullable(),
  flow: z.number().nullable(),
  stageTimeSeries: z.array(timeSeriesPointSchema),
  flowTimeSeries: z.array(timeSeriesPointSchema),
  lastUpdated: z.string().nullable(),
  trend: z.enum(["Rising", "Falling", "Steady", "Unknown"]),
  thresholds: gaugeThresholdsSchema,
  isBinghamton: z.boolean(),
  isOffline: z.boolean(),
});

export const forecastDataSchema = z.object({
  afd: z.object({
    synopsis: z.string(),
    shortTerm: z.string(),
    longTerm: z.string(),
    rawText: z.string(),
    issuedAt: z.string(),
  }),
  riverSummary: z.object({
    text: z.string(),
    issuedAt: z.string(),
  }),
  stale: z.boolean().optional(),
  error: z.string().optional(),
});

export const weatherDataSchema = z.object({
  current: z.object({
    temp: z.number().nullable(),
    windSpeed: z.string().nullable(),
    windDir: z.string().nullable(),
    conditions: z.string().nullable(),
    humidity: z.number().nullable(),
    pressure: z.number().nullable(),
  }),
  forecast: z.array(z.object({
    name: z.string(),
    temp: z.number().nullable(),
    shortForecast: z.string(),
    detailedForecast: z.string(),
    isDaytime: z.boolean(),
  })),
  stale: z.boolean().optional(),
  error: z.string().optional(),
});

export const ensembleDataSchema = z.object({
  rawHtml: z.string(),
  timestamp: z.string(),
  stale: z.boolean().optional(),
  error: z.string().optional(),
});

export type GaugeThresholds = z.infer<typeof gaugeThresholdsSchema>;
export type TimeSeriesPoint = z.infer<typeof timeSeriesPointSchema>;
export type GaugeData = z.infer<typeof gaugeDataSchema>;
export type ForecastData = z.infer<typeof forecastDataSchema>;
export type WeatherData = z.infer<typeof weatherDataSchema>;
export type EnsembleData = z.infer<typeof ensembleDataSchema>;
