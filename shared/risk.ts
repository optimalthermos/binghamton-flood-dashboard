/** Same steps the 48-hour rain total already uses. */
export function qpfScore(inches: number) {
  if (inches <= 0) return 0;
  if (inches <= 0.5) return 30;
  if (inches <= 1) return 50;
  if (inches <= 2) return 75;
  return Math.min(100, 75 + (inches - 2) * 12.5);
}

/** Modest scale: 50 mph is the top of the factor, and the factor's weight stays small. */
export function windScore(mph: number) {
  if (mph <= 10) return 0;
  return Math.min(100, (mph - 10) * 2.5);
}

/** Known zero snow and no freezing-level crossing score zero. */
export function frozenScore(snowInches: number, rainSnowHours: number | null) {
  const fromSnow = qpfScore(Math.max(0, snowInches));
  const crossing = rainSnowHours !== null && rainSnowHours >= 0 && rainSnowHours <= 48;
  return crossing ? Math.max(fromSnow, 40) : fromSnow;
}

export function scoreToRiskLevel(score: number): "LOW" | "MODERATE" | "ELEVATED" | "HIGH" {
  if (score <= 25) return "LOW";
  if (score <= 50) return "MODERATE";
  if (score <= 70) return "ELEVATED";
  return "HIGH";
}

export const RISK_WEIGHTS = {
  stage: 0.22,
  basin: 0.12,
  qpf48: 0.16,
  rain6h: 0.10,
  wind: 0.05,
  frozen: 0.05,
  soil: 0.10,
  groundwater: 0.08,
  confluence: 0.07,
  recession: 0.05,
};

export interface RiskFactorInput {
  name: string;
  score: number;
  weight: number;
  detail: string;
  available?: boolean;
}

export interface RiskFactor {
  name: string;
  score: number;
  weight: number;
  contribution: number;
  detail: string;
}

export function composeRisk(inputs: RiskFactorInput[]) {
  const factors = inputs.map(factor => factor.available === false
    ? { ...factor, score: 0, weight: 0, detail: "Unavailable or stale; excluded from score" }
    : factor);
  const availableWeight = factors.reduce((sum, factor) => sum + factor.weight, 0);
  const compositeScore = availableWeight <= 0
    ? 0
    : Math.round(factors.reduce((sum, factor) => sum + factor.score * factor.weight, 0) / availableWeight);
  const listed: RiskFactor[] = factors
    .map(factor => ({
      name: factor.name,
      score: Math.round(factor.score),
      weight: factor.weight,
      contribution: Math.round(factor.score * factor.weight * 10) / 10,
      detail: factor.detail,
    }))
    .sort((a, b) => b.contribution - a.contribution);
  return {
    compositeScore,
    riskLevel: scoreToRiskLevel(compositeScore),
    factors: listed,
    availableWeight,
    availableCount: factors.filter(factor => factor.weight > 0).length,
  };
}

export interface BasinRiskInput {
  stageScore: number;
  stageDetail: string;
  basinScore: number;
  basinDetail: string;
  qpf48Inches: number;
  rain6hInches: number;
  windMph: number | null;
  snowInches: number;
  rainSnowHours: number | null;
  soilPct: number | null;
  soilDetail: string;
  gwScore: number;
  gwDetail: string;
  gwAvailable: boolean;
  confluenceScore: number;
  confluenceDetail: string;
  confluenceAvailable: boolean;
  recessionScore: number;
  recessionDetail: string;
}

export function basinRiskFactors(input: BasinRiskInput, qpfInches = input.qpf48Inches, recession = input.recessionScore): RiskFactorInput[] {
  const wind = input.windMph;
  const snowDetail = input.rainSnowHours !== null && input.rainSnowHours >= 0 && input.rainSnowHours <= 48
    ? `${input.snowInches.toFixed(2)}" of snow in 48h, with a rain/snow crossing in ${Math.round(input.rainSnowHours)}h`
    : `${input.snowInches.toFixed(2)}" of snow in 48h`;
  return [
    { name: "Stage Proximity", score: input.stageScore, weight: RISK_WEIGHTS.stage, detail: input.stageDetail },
    { name: "Basin Trend", score: input.basinScore, weight: RISK_WEIGHTS.basin, detail: input.basinDetail },
    { name: "QPF (48h)", score: qpfScore(qpfInches), weight: RISK_WEIGHTS.qpf48, detail: `${qpfInches.toFixed(2)}" QPF in next 48h` },
    { name: "Peak 6h rain", score: qpfScore(input.rain6hInches), weight: RISK_WEIGHTS.rain6h, detail: `Peak ${input.rain6hInches.toFixed(2)}" in any 6 hours of the next 48h` },
    {
      name: "Forecast wind",
      score: wind === null ? 0 : windScore(wind),
      weight: RISK_WEIGHTS.wind,
      detail: wind === null ? "Unavailable or stale; excluded from score" : `Peak forecast wind ${Math.round(wind)} mph in the next 48h`,
      available: wind !== null,
    },
    { name: "Frozen precipitation", score: frozenScore(input.snowInches, input.rainSnowHours), weight: RISK_WEIGHTS.frozen, detail: snowDetail },
    {
      name: "Soil Moisture",
      score: input.soilPct ?? 0,
      weight: RISK_WEIGHTS.soil,
      detail: input.soilDetail,
      available: input.soilPct !== null,
    },
    { name: "Groundwater", score: input.gwScore, weight: RISK_WEIGHTS.groundwater, detail: input.gwDetail, available: input.gwAvailable },
    { name: "Confluence Sync", score: input.confluenceScore, weight: RISK_WEIGHTS.confluence, detail: input.confluenceDetail, available: input.confluenceAvailable },
    { name: "Recession Phase", score: recession, weight: RISK_WEIGHTS.recession, detail: input.recessionDetail },
  ];
}

export function scoreBasin(input: BasinRiskInput) {
  return composeRisk(basinRiskFactors(input));
}

export function horizonScore(input: BasinRiskInput, qpfInches: number, recessionScore: number) {
  return composeRisk(basinRiskFactors(input, qpfInches, recessionScore)).compositeScore;
}
