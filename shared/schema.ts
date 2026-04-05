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
  isReservoir: z.boolean().optional(),
  poolElevation: z.number().nullable().optional(),
  conservationPool: z.number().optional(),
  floodStoragePct: z.number().nullable().optional(),
  recessionRate: z.number().nullable().optional(),
  recessionPhase: z.enum(["FAST_RECESSION", "BASEFLOW", "LOADING"]).nullable().optional(),
});

export const confluenceSyncSchema = z.object({
  state: z.enum(["BOTH_RISING", "BOTH_FALLING", "SUSQ_RISING_CHEN_FALLING", "CHEN_RISING_SUSQ_FALLING", "STABLE"]),
  conklinTrend: z.string(),
  chenangoTrend: z.string(),
  riskLevel: z.enum(["HIGH", "MODERATE", "LOW"]),
});

export const basinTrendSchema = z.object({
  direction: z.enum(["Loading", "Draining", "Stable"]),
  weightedTrend: z.number(),
  netDischarge: z.number(),
});

export const gaugesResponseSchema = z.object({
  gauges: z.array(gaugeDataSchema),
  confluenceSync: confluenceSyncSchema,
  basinTrend: basinTrendSchema,
});

export const frostDataSchema = z.object({
  cumulativeFDH: z.number(),
  estimatedDepthInches: z.number(),
  significance: z.enum(["NONE", "NUISANCE", "HYDROLOGIC"]),
});

export const qpfDataSchema = z.object({
  amount: z.string(),
  hoursUntil: z.number(),
  description: z.string(),
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
  frostData: frostDataSchema.optional(),
  qpf: qpfDataSchema.nullable().optional(),
  stale: z.boolean().optional(),
  error: z.string().optional(),
});

export const ensembleBoundsSchema = z.record(z.string(), z.object({
  p10: z.number(),
  p50: z.number(),
  p90: z.number(),
}));

export const ensembleDataSchema = z.object({
  rawHtml: z.string(),
  timestamp: z.string(),
  ensembleBounds: ensembleBoundsSchema.optional(),
  stale: z.boolean().optional(),
  error: z.string().optional(),
});

export const newsItemSchema = z.object({
  headline: z.string(),
  source: z.string(),
  date: z.string(),
  url: z.string(),
  severity: z.enum(["warning", "watch", "advisory", "info"]).optional(),
  isNWSAlert: z.boolean().optional(),
});

export const newsDataSchema = z.object({
  alerts: z.array(newsItemSchema),
  curatedReports: z.array(newsItemSchema),
  stale: z.boolean().optional(),
  error: z.string().optional(),
});

export type GaugeThresholds = z.infer<typeof gaugeThresholdsSchema>;
export type TimeSeriesPoint = z.infer<typeof timeSeriesPointSchema>;
export type GaugeData = z.infer<typeof gaugeDataSchema>;
export type ConfluenceSync = z.infer<typeof confluenceSyncSchema>;
export type BasinTrend = z.infer<typeof basinTrendSchema>;
export type GaugesResponse = z.infer<typeof gaugesResponseSchema>;
export type FrostData = z.infer<typeof frostDataSchema>;
export type QPFData = z.infer<typeof qpfDataSchema>;
export type ForecastData = z.infer<typeof forecastDataSchema>;
export type WeatherData = z.infer<typeof weatherDataSchema>;
export type EnsembleBounds = z.infer<typeof ensembleBoundsSchema>;
export type EnsembleData = z.infer<typeof ensembleDataSchema>;
export type NewsItem = z.infer<typeof newsItemSchema>;
export type NewsData = z.infer<typeof newsDataSchema>;

// V3: Groundwater
export const groundwaterDataSchema = z.object({
  depth: z.number().nullable(),
  trend: z.enum(["Rising", "Falling", "Steady", "Unknown"]),
  timeSeries: z.array(timeSeriesPointSchema),
  interpretation: z.string(),
  lastUpdated: z.string().nullable(),
});

// V3: Surface Observations (KBGM expanded)
export const surfaceObsSchema = z.object({
  temperature: z.number().nullable(),
  dewpoint: z.number().nullable(),
  dewpointDepression: z.number().nullable(),
  relativeHumidity: z.number().nullable(),
  windDirection: z.number().nullable(),
  windDirectionCardinal: z.string().nullable(),
  windSpeed: z.number().nullable(),
  windGust: z.number().nullable(),
  textDescription: z.string().nullable(),
  visibility: z.number().nullable(),
  isRaining: z.boolean(),
  isSnowing: z.boolean(),
  timestamp: z.string(),
});

// V3: Gridpoint Forecast Data
export const gridpointTimelinePointSchema = z.object({
  time: z.string(),
  value: z.number(),
});

export const windTimelinePointSchema = z.object({
  time: z.string(),
  direction: z.number(),
  speed: z.number(),
});

export const gridpointDataSchema = z.object({
  temperatureTimeline: z.array(gridpointTimelinePointSchema),
  dewpointTimeline: z.array(gridpointTimelinePointSchema),
  qpfTimeline: z.array(gridpointTimelinePointSchema),
  snowTimeline: z.array(gridpointTimelinePointSchema),
  windTimeline: z.array(windTimelinePointSchema),
  rainSnowTransition: z.object({
    time: z.string(),
    hoursUntil: z.number(),
  }).nullable(),
});

// V3: Historical Stats
export const historicalStatEntrySchema = z.object({
  beginYear: z.number().nullable(),
  endYear: z.number().nullable(),
  count: z.number().nullable(),
  max: z.number().nullable(),
  maxYear: z.number().nullable(),
  min: z.number().nullable(),
  minYear: z.number().nullable(),
  mean: z.number().nullable(),
  p05: z.number().nullable(),
  p10: z.number().nullable(),
  p20: z.number().nullable(),
  p25: z.number().nullable(),
  p50: z.number().nullable(),
  p75: z.number().nullable(),
  p80: z.number().nullable(),
  p90: z.number().nullable(),
  p95: z.number().nullable(),
});

export const historicalStatsSchema = z.object({
  date: z.string(),
  stats: z.record(z.string(), historicalStatEntrySchema),
});

// V3: Soil Moisture
export const soilMoistureSchema = z.object({
  percentile: z.number().nullable(),
  date: z.string().nullable(),
  interpretation: z.string(),
  error: z.string().nullable(),
});

export type GroundwaterData = z.infer<typeof groundwaterDataSchema>;
export type SurfaceObs = z.infer<typeof surfaceObsSchema>;
export type GridpointData = z.infer<typeof gridpointDataSchema>;
export type HistoricalStatEntry = z.infer<typeof historicalStatEntrySchema>;
export type HistoricalStats = z.infer<typeof historicalStatsSchema>;
export type SoilMoisture = z.infer<typeof soilMoistureSchema>;

// V4: Predictive Outlook
export const predictiveOutlookSchema = z.object({
  compositeScore: z.number(),
  riskLevel: z.enum(["LOW", "MODERATE", "ELEVATED", "HIGH"]),
  outlook24h: z.object({ score: z.number(), level: z.string() }),
  outlook48h: z.object({ score: z.number(), level: z.string() }),
  outlook72h: z.object({ score: z.number(), level: z.string() }),
  factors: z.array(z.object({
    name: z.string(),
    score: z.number(),
    weight: z.number(),
    contribution: z.number(),
    detail: z.string(),
  })),
  historicalMatches: z.array(z.object({
    name: z.string(),
    similarity: z.number(),
    severity: z.string(),
    description: z.string(),
    peakComparison: z.string(),
  })),
  narrative: z.string(),
  triggers: z.object({
    escalation: z.string(),
    deescalation: z.string(),
  }),
  generatedAt: z.string(),
});

export type PredictiveOutlook = z.infer<typeof predictiveOutlookSchema>;

// V5: Webcam feeds
export const webcamSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(["nws", "dot", "usgs", "mesonet"]),
  category: z.enum(["river", "weather", "traffic"]).optional(),
  imageUrl: z.string(),
  refreshInterval: z.number(),
  description: z.string().optional(),
});

export const communityPostSchema = z.object({
  title: z.string(),
  date: z.string(),
  subreddit: z.string(),
  link: z.string(),
  hasImage: z.boolean(),
  imageUrl: z.string().nullable(),
  isFloodRelated: z.boolean(),
  anonymizedAuthor: z.string(),
});

export const communityFeedSchema = z.object({
  posts: z.array(communityPostSchema),
  lastUpdated: z.string(),
  floodPostCount: z.number(),
  totalPosts: z.number(),
});

export type Webcam = z.infer<typeof webcamSchema>;
export type CommunityPost = z.infer<typeof communityPostSchema>;
export type CommunityFeed = z.infer<typeof communityFeedSchema>;
