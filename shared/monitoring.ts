export const STALE_OBSERVATION_MS = 2 * 60 * 60 * 1000;

export function observationState(timestamp: string | null | undefined, offline = false, now = Date.now()) {
  if (offline || !timestamp || !Number.isFinite(Date.parse(timestamp))) return "unavailable";
  const age = now - Date.parse(timestamp);
  if (age < -300_000 || age > STALE_OBSERVATION_MS) return "stale";
  return "current";
}

export function ageLabel(timestamp: string | null | undefined, now = Date.now()) {
  if (!timestamp || !Number.isFinite(Date.parse(timestamp))) return "Not reported";
  const minutes = Math.floor((now - Date.parse(timestamp)) / 60_000);
  if (minutes < -5) return "Check source time";
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ${minutes % 60}m ago`;
  return `${Math.floor(minutes / 1440)}d ago`;
}

export function stageCategory(stage: number | null, thresholds: Record<string, number | undefined>, current = true) {
  if (!current || stage === null || !Number.isFinite(stage)) return "Unknown";
  for (const [key, label] of [["major", "Major flood"], ["moderate", "Moderate flood"], ["minor", "Minor flood"], ["action", "Action stage"]]) {
    if (thresholds[key] !== undefined && stage >= thresholds[key]!) return label;
  }
  return Object.keys(thresholds).length ? "Below action" : "No threshold";
}

// NWS amounts describe an entire validTime interval. Only count its overlap
// with the requested future window, assuming uniform precipitation within it.
export function durationMs(duration: string) {
  const match = duration.match(/^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?)?$/);
  return match ? ((+(match[1] || 0) * 24 + +(match[2] || 0)) * 60 + +(match[3] || 0)) * 60_000 : 0;
}

function intervalOverlap(entries: Array<{ validTime: string; value: number | null }>, windowStart: number, windowEnd: number) {
  let total = 0, covered = 0;
  for (const entry of entries) {
    if (entry.value === null || !Number.isFinite(entry.value)) continue;
    const [startText, duration] = entry.validTime.split("/");
    const start = Date.parse(startText), length = durationMs(duration || "");
    if (!Number.isFinite(start) || length <= 0) continue;
    const overlap = Math.max(0, Math.min(windowEnd, start + length) - Math.max(windowStart, start));
    total += entry.value * overlap / length / 25.4;
    covered += overlap;
  }
  return { inches: total, covered };
}

export function precipitationTotal(entries: Array<{ validTime: string; value: number | null }>, hours: number, now = Date.now()) {
  const { inches, covered } = intervalOverlap(entries, now, now + hours * 3600_000);
  return { inches: Math.round(inches * 100) / 100, coverageHours: Math.round(covered / 3600_000 * 10) / 10 };
}

/** Heaviest rainfall inside any window of windowHours during the next horizonHours. */
export function peakPrecipitationWindow(
  entries: Array<{ validTime: string; value: number | null }>,
  windowHours: number,
  horizonHours: number,
  now = Date.now(),
) {
  let peak = 0;
  const lastOffset = Math.max(0, horizonHours - windowHours);
  for (let offset = 0; offset <= lastOffset; offset++) {
    const start = now + offset * 3600_000;
    const { inches } = intervalOverlap(entries, start, start + windowHours * 3600_000);
    if (inches > peak) peak = inches;
  }
  return Math.round(peak * 100) / 100;
}
