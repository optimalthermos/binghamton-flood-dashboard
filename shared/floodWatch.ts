/** Official flood products only. The experimental score is not one of these. */
const FLOOD_EVENT = /^(Flash Flood Warning|Flood Warning|Flash Flood Watch|Flood Watch)$/i;

export function officialFloodProducts<T extends { event?: string | null }>(alerts: T[]): T[] {
  return alerts
    .filter(alert => FLOOD_EVENT.test(alert.event || ""))
    .sort((a, b) => Number(/watch/i.test(a.event || "")) - Number(/watch/i.test(b.event || "")));
}

export const CREST_SITES = [
  { id: "01503000", name: "Conklin" },
  { id: "01503500", name: "Binghamton" },
  { id: "01512500", name: "Chenango Forks" },
  { id: "01513500", name: "Vestal" },
] as const;

export interface CrestReading {
  id: string;
  name?: string;
  stale?: boolean;
  error?: string | null;
  peak?: { stage: number } | null;
  thresholds?: { action?: number; minor?: number };
}

/** Describes a published NWPS crest against published stages. A stale or missing crest stays unpublished. */
export function crestStatement(site: CrestReading) {
  const name = site.name || CREST_SITES.find(item => item.id === site.id)?.name || site.id;
  const stage = site.peak?.stage;
  const published = !site.stale && !site.error && typeof stage === "number" && Number.isFinite(stage);
  if (!published) return `${name}: forecast crest unpublished`;
  const crest = `${stage.toFixed(1)} ft`;
  const action = site.thresholds?.action;
  const minor = site.thresholds?.minor;
  if (typeof minor === "number" && stage >= minor) {
    return `${name}: forecast crest ${crest}, at or above the ${minor} ft minor flood stage`;
  }
  if (typeof action === "number" && stage < action) {
    return `${name}: forecast crest ${crest}, below the ${action} ft action stage`;
  }
  if (typeof action === "number" && typeof minor === "number") {
    return `${name}: forecast crest ${crest}, above the ${action} ft action stage and below the ${minor} ft minor flood stage`;
  }
  if (typeof action === "number") {
    return `${name}: forecast crest ${crest}, at or above the ${action} ft action stage`;
  }
  return `${name}: forecast crest ${crest}`;
}
