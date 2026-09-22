// Official NWPS products. No inferred percentiles or synthetic forecast values.
const UA = "(Floodwatch, https://github.com/optimalthermos/binghamton-flood-dashboard)";
const entries = new Map<string, { data: any; time: number }>();
const pending = new Map<string, Promise<any>>();

export async function officialJSON(url: string, ttl = 300_000): Promise<any> {
  const cached = entries.get(url);
  if (cached && Date.now() - cached.time < ttl) return cached.data;
  if (pending.has(url)) return pending.get(url);
  const request = (async () => {
    const response = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`Official feed returned HTTP ${response.status}`);
    const data = await response.json();
    entries.set(url, { data, time: Date.now() });
    return data;
  })();
  pending.set(url, request);
  try { return await request; } finally { pending.delete(url); }
}

export const forecastSites = ["01503000", "01513500", "01512500", "01515000"];

export async function gaugeMetadata(id: string) {
  return officialJSON(`https://api.water.noaa.gov/nwps/v1/gauges/${id}`, 6 * 3600_000);
}

export function officialThresholds(meta: any) {
  if (meta?.flood?.stageUnits !== "ft") return {};
  return Object.fromEntries(
    Object.entries(meta?.flood?.categories || {})
      .filter(([key, value]: any) => ["action", "minor", "moderate", "major"].includes(key)
        && typeof value?.stage === "number" && value.stage > -999)
      .map(([key, value]: any) => [key, value.stage]),
  );
}

export async function weatherPoint() {
  const data = await officialJSON("https://api.weather.gov/points/42.0987,-75.9180", 86400_000);
  if (!data.properties?.forecastGridData) throw new Error("NWS point metadata unavailable");
  return data.properties;
}

export async function riverForecasts() {
  const sites = await Promise.all(forecastSites.map(async id => {
    try {
      const [meta, series] = await Promise.all([
        gaugeMetadata(id),
        officialJSON(`https://api.water.noaa.gov/nwps/v1/gauges/${id}/stageflow`),
      ]);
      const product = series.forecast;
      const correctUnits = product?.primaryUnits === "ft" && product?.primaryName === "Stage";
      const points = correctUnits ? (product.data || [])
        .filter((p: any) => Number.isFinite(p.primary) && p.primary > -999
          && Date.parse(p.validTime) >= Date.now())
        .map((p: any) => ({ time: p.validTime, stage: p.primary })) : [];
      const peak = points.reduce((max: any, point: any) => !max || point.stage > max.stage ? point : max, null);
      const issuedAt = product?.issuedTime || null;
      const stale = !issuedAt || Date.now() - Date.parse(issuedAt) > 36 * 3600_000;
      return {
        id, lid: meta.lid, name: meta.name, issuedAt, points, peak, stale,
        thresholds: officialThresholds(meta),
        sourceUrl: `https://water.noaa.gov/gauges/${meta.lid?.toLowerCase() || id}`,
        error: points.length ? null : "No future stage forecast is published for this station.",
      };
    } catch (error: any) {
      return { id, name: id, points: [], peak: null, issuedAt: null, stale: true, thresholds: {},
        error: error.message, sourceUrl: `https://water.noaa.gov/gauges/${id}` };
    }
  }));
  return { sites, source: "NOAA National Water Prediction Service",
    stale: sites.every(s => s.stale), error: sites.every(s => !s.points.length) ? "Forecasts unavailable" : null };
}

export async function activeAlerts() {
  const data = await officialJSON("https://api.weather.gov/alerts/active?zone=NYC007,NYC107,NYC017,NYC025");
  if (!Array.isArray(data.features)) throw new Error("Invalid NWS alert response");
  const alerts = data.features.filter((f: any) =>
    f.properties?.status === "Actual" &&
    (!f.properties.expires || Date.parse(f.properties.expires) > Date.now()),
  ).map((f: any) => {
    const p = f.properties;
    const event = (p.event || "").toLowerCase();
    return {
      headline: p.headline || p.event, event: p.event, source: p.senderName || "National Weather Service",
      date: p.sent || p.effective, expires: p.expires, area: p.areaDesc,
      description: p.description, instruction: p.instruction,
      url: p["@id"] || f.id, severity: event.includes("warning") ? "warning" :
        event.includes("watch") ? "watch" : event.includes("advisory") ? "advisory" : "info",
      isNWSAlert: true,
    };
  });
  return { alerts, curatedReports: [], checkedAt: new Date().toISOString(),
    coverage: "Broome, Tioga, Chenango and Delaware counties, NY" };
}
