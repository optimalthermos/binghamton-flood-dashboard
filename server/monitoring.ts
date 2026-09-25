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

export const forecastSites = ["01503000", "01502731", "01503500", "01513500", "01512500", "01515000"];

export async function gaugeMetadata(id: string) {
  return officialJSON(`https://api.water.noaa.gov/nwps/v1/gauges/${id}`, 6 * 3600_000);
}

export function parseObservedProduct(product: any, now = Date.now()) {
  const stageOK = product?.primaryUnits === "ft" && ["Stage", "Pool"].includes(product?.primaryName);
  const multiplier = product?.secondaryName === "Flow" ?
    product.secondaryUnits === "kcfs" ? 1000 : product.secondaryUnits === "cfs" ? 1 : null : null;
  const points = (product?.data || []).filter((p: any) =>
    Number.isFinite(Date.parse(p.validTime)) && Date.parse(p.validTime) >= now - 72 * 3600_000 && Date.parse(p.validTime) <= now)
    .sort((a: any, b: any) => Date.parse(a.validTime) - Date.parse(b.validTime));
  return {
    stageTS: points.map((p: any) => ({ timestamp: p.validTime,
      value: stageOK && Number.isFinite(p.primary) && p.primary > -999 ? p.primary : null })),
    flowTS: points.map((p: any) => ({ timestamp: p.validTime,
      value: multiplier !== null && Number.isFinite(p.secondary) && p.secondary >= 0 ? p.secondary * multiplier : null })),
  };
}

export async function officialObservations(id: string) {
  const data = await officialJSON(`https://api.water.noaa.gov/nwps/v1/gauges/${id}/stageflow`);
  return parseObservedProduct(data.observed);
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

export function officialCoordinate(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function officialImpacts(meta: any): Array<{ stage: number; statement: string }> {
  if (meta?.flood?.stageUnits !== "ft" || !Array.isArray(meta?.flood?.impacts)) return [];
  return meta.flood.impacts
    .filter((impact: any) => typeof impact?.stage === "number" && impact.stage > -999
      && typeof impact?.statement === "string" && impact.statement.trim())
    .map((impact: any) => ({ stage: impact.stage, statement: impact.statement.trim() }))
    .sort((a: { stage: number }, b: { stage: number }) => a.stage - b.stage);
}

export function officialRecordCrest(meta: any): { stage: number; occurredTime: string } | null {
  if (meta?.flood?.stageUnits !== "ft" || !Array.isArray(meta?.flood?.crests?.historic)) return null;
  let best: { stage: number; occurredTime: string } | null = null;
  for (const crest of meta.flood.crests.historic) {
    if (typeof crest?.stage !== "number" || crest.stage <= -999 || typeof crest?.occurredTime !== "string") continue;
    if (!best || crest.stage > best.stage) best = { stage: crest.stage, occurredTime: crest.occurredTime };
  }
  return best;
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

export async function flowEnsembles() {
  const sites = await Promise.all(forecastSites.map(async id => {
    try {
      const meta = await gaugeMetadata(id);
      const product = await officialJSON(`https://api.water.noaa.gov/hefs/v1/hydrograph-quantiles/?location_id=${meta.lid}&parameter_id=QINE`, 3600_000);
      if (product.metadata?.units !== "CFS") throw new Error("Flow ensemble units unavailable");
      const quantiles: number[] = product.metadata.exceedance_quantiles || [];
      const indices = [0.1, 0.5, 0.9].map(q => quantiles.indexOf(q));
      if (indices.some(i => i < 0)) throw new Error("Requested quantiles not published");
      const points = (product.value_set || []).filter((p: any) => Date.parse(p.valid_datetime) >= Date.now() &&
        Date.parse(p.valid_datetime) <= Date.now() + 72 * 3600_000).map((p: any) => ({
          time: p.valid_datetime, p10: p.quantile_values[indices[0]], p50: p.quantile_values[indices[1]], p90: p.quantile_values[indices[2]],
        })).filter((p: any) => [p.p10, p.p50, p.p90].every(v => Number.isFinite(v) && v >= 0));
      const issuedAt = product.metadata.forecast_datetime;
      return { id, name: meta.name, issuedAt, points,
        stale: !issuedAt || Date.now() - Date.parse(issuedAt) > 36 * 3600_000 };
    } catch (error: any) { return { id, name: id, points: [], stale: true, error: error.message }; }
  }));
  if (!sites.some(s => s.points.length && !s.stale)) throw new Error("No current HEFS flow ensembles available");
  return { rawHtml: "", timestamp: new Date().toISOString(), ensembleBounds: {}, flowEnsembles: sites,
    note: "NOAA HEFS flow quantiles in cfs; not stage values. No substituted ensemble numbers." };
}
