export type PathwayState = "quiet" | "watch" | "active" | "unknown";

export interface FloodPathway {
  id: string;
  name: string;
  state: PathwayState;
  how: string;
  now: string;
}

export interface PathwayReservoir {
  name: string;
  pool: number | null;
  action: number | null;
  minor: number | null;
}

export interface PathwayInput {
  conklinStage: number | null;
  conklinAction: number | null;
  binghamtonStage: number | null;
  binghamtonAction: number | null;
  loadingNames: string[];
  confluence: string | null;
  qpf24: number | null;
  qpf48: number | null;
  soilPct: number | null;
  gwDepth: number | null;
  frost: "NONE" | "NUISANCE" | "HYDROLOGIC" | null;
  precipMentioned: boolean;
  reservoirs: PathwayReservoir[];
}

function n(value: number | null, digits: number, unit: string): string {
  return value !== null && Number.isFinite(value) ? `${value.toFixed(digits)}${unit}` : "unavailable";
}

function stageLine(name: string, stage: number | null, action: number | null): string {
  if (stage === null) return `${name} stage unavailable`;
  const actionText = action !== null ? `, action ${action} ft` : "";
  return `${name} ${stage.toFixed(2)} ft${actionText}`;
}

export function buildFloodPathways(input: PathwayInput): FloodPathway[] {
  const near = (stage: number | null, action: number | null) =>
    stage !== null && action !== null && stage >= action - 2 && stage < action;
  const over = (stage: number | null, action: number | null) =>
    stage !== null && action !== null && stage >= action;

  const rising = input.loadingNames.length > 0;
  const mainActive = over(input.conklinStage, input.conklinAction)
    || over(input.binghamtonStage, input.binghamtonAction)
    || (rising && (near(input.conklinStage, input.conklinAction) || near(input.binghamtonStage, input.binghamtonAction)));
  const mainWatch = !mainActive && (
    near(input.conklinStage, input.conklinAction)
    || near(input.binghamtonStage, input.binghamtonAction)
    || rising
  );

  const wetGround = (input.soilPct !== null && input.soilPct >= 70)
    || (input.gwDepth !== null && input.gwDepth < 5);
  const meaningfulRain = input.qpf48 !== null && input.qpf48 >= 0.5;
  const someRain = (input.qpf48 !== null && input.qpf48 >= 0.25) || input.precipMentioned;
  const rainKnown = input.qpf48 !== null || input.soilPct !== null || input.gwDepth !== null;

  const pools = input.reservoirs.filter(r => r.pool !== null);
  const reservoirActive = pools.some(r => r.minor !== null && r.pool! >= r.minor);
  const reservoirWatch = !reservoirActive && pools.some(r =>
    (r.action !== null && r.pool! >= r.action - 10) || (r.minor !== null && r.pool! >= r.minor - 10));

  const pathways: FloodPathway[] = [
    {
      id: "mainstem",
      name: "Main-stem rise",
      state: mainActive ? "active" : mainWatch ? "watch" : "quiet",
      how: "A Susquehanna flood at Binghamton usually builds upstream. Rain or melt raises Windsor and Conklin first, and the Binghamton stage follows. Flood stage is the official action and minor levels, not a guessed height.",
      now: `${stageLine("Conklin", input.conklinStage, input.conklinAction)}. ${stageLine("Binghamton", input.binghamtonStage, input.binghamtonAction)}. ${
        input.loadingNames.length ? `${input.loadingNames.join(", ")} ${input.loadingNames.length === 1 ? "is" : "are"} rising over the last day.` : "No current gauge is in a loading phase."
      }`,
    },
    {
      id: "confluence",
      name: "Both rivers rising together",
      state: input.confluence === "BOTH_RISING" ? "active"
        : input.confluence === "SUSQ_RISING_CHEN_FALLING" || input.confluence === "CHEN_RISING_SUSQ_FALLING" ? "watch"
        : input.confluence ? "quiet" : "unknown",
      how: "The Chenango joins the Susquehanna in Binghamton. The city sees both rivers at once. The troublesome case is both rising at the same time, so one crest does not pass before the other arrives.",
      now: input.confluence === "BOTH_RISING" ? "Conklin and Chenango Forks are both rising."
        : input.confluence === "BOTH_FALLING" ? "Both rivers are falling, so the confluence is draining."
        : input.confluence === "SUSQ_RISING_CHEN_FALLING" ? "The Susquehanna is rising while the Chenango is falling."
        : input.confluence === "CHEN_RISING_SUSQ_FALLING" ? "The Chenango is rising while the Susquehanna is falling."
        : input.confluence === "STABLE" ? "Both rivers are steady."
        : "Confluence trend is unavailable.",
    },
    {
      id: "wet-ground",
      name: "Rain on wet ground",
      state: !rainKnown ? "unknown" : wetGround && meaningfulRain ? "active" : wetGround || someRain ? "watch" : "quiet",
      how: "Wet soil and a shallow water table leave less room for the next rain to soak in, so more of it reaches the creeks. This matters when rain is forecast onto ground that is already wet.",
      now: `Soil moisture ${input.soilPct !== null ? `${Math.round(input.soilPct)}th percentile` : "unavailable"}. Groundwater ${n(input.gwDepth, 1, " ft to water")}. Next 48 hours ${n(input.qpf48, 2, " in")} of forecast rain.`,
    },
    {
      id: "frozen-ground",
      name: "Rain or melt on frozen ground",
      state: input.frost === null ? "unknown"
        : input.frost === "HYDROLOGIC" && input.precipMentioned ? "active"
        : input.frost === "NONE" ? "quiet" : "watch",
      how: "Frozen ground sheds rain and snowmelt instead of absorbing it. That setup shows up in a thaw followed by rain, mostly in late winter and early spring.",
      now: input.frost === null ? "Frost estimate unavailable, so this pathway is not scored."
        : input.frost === "NONE" ? "The frost estimate is none."
        : `Frost estimate is ${input.frost.toLowerCase()}.${input.precipMentioned ? " The forecast mentions rain or snow." : " The forecast does not mention rain or snow."}`,
    },
    {
      id: "tributary",
      name: "Local tributary burst",
      state: input.qpf24 === null ? "unknown" : input.qpf24 >= 1 ? "active" : input.qpf24 >= 0.4 ? "watch" : "quiet",
      how: "A short, heavy storm over Castle Creek, Thomas Creek, or another small valley can flood local streets before the main Susquehanna gauges rise. Those tributaries are not in this gauge set.",
      now: input.qpf24 === null ? "The 24-hour precipitation forecast is unavailable."
        : `Forecast rain in the next 24 hours is ${input.qpf24.toFixed(2)} in. Main-stem gauges can still look ordinary during a local burst.`,
    },
    {
      id: "reservoirs",
      name: "Reservoir storage",
      state: pools.length === 0 ? "unknown" : reservoirActive ? "active" : reservoirWatch ? "watch" : "quiet",
      how: "Whitney Point and East Sidney store water until the pool reaches the official flood categories. A pool below those levels is storage, not a flood wave. Dam outflow is the separate East Sidney outflow gauge.",
      now: input.reservoirs.length === 0 ? "Reservoir observations are unavailable."
        : input.reservoirs.map(r => r.pool === null
          ? `${r.name} pool unavailable`
          : `${r.name} ${r.pool.toFixed(1)} ft${r.minor !== null ? `, minor ${r.minor} ft` : ""}`).join(". ") + ".",
    },
  ];

  return pathways;
}
