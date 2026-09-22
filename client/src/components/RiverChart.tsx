import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export default function RiverChart({ points, threshold, forecast = false }: {
  points: Array<{ time: string; stage: number | null }>; threshold?: number; forecast?: boolean;
}) {
  if (!points.length) return <div className="chart-empty">No usable time-series data in this window.</div>;
  return <div className="river-chart" role="img" aria-label={forecast ? "Official forecast river stage in feet" : "Observed river stage in feet"}>
    <ResponsiveContainer width="100%" height={245}>
      <AreaChart data={points.map(p => ({ ...p, t: Date.parse(p.time) }))} margin={{ top: 18, right: 16, left: -16, bottom: 6 }}>
        <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="3 5" />
        <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} scale="time" minTickGap={45}
          tickFormatter={t => new Date(t).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric" })}
          tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} axisLine={false} tickLine={false} />
        <YAxis domain={["auto", "auto"]} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
          tickFormatter={n => `${n}′`} axisLine={false} tickLine={false} />
        <Tooltip contentStyle={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))", borderRadius: 8, fontSize: 13 }}
          labelFormatter={t => new Date(Number(t)).toLocaleString("en-US", { timeZone: "America/New_York", timeZoneName: "short" })}
          formatter={(value: number) => [`${value.toFixed(2)} ft`, forecast ? "Forecast stage" : "Observed stage"]} />
        {threshold !== undefined && <ReferenceLine y={threshold} stroke="hsl(var(--warning))" strokeDasharray="5 5"
          label={{ value: "Action", fill: "hsl(var(--muted-foreground))", position: "insideTopRight", fontSize: 12 }} />}
        <Area dataKey="stage" type="linear" stroke="hsl(var(--primary))" fill="hsl(var(--primary) / .10)"
          strokeWidth={2} strokeDasharray={forecast ? "5 3" : undefined} isAnimationActive={false} connectNulls={false} />
      </AreaChart>
    </ResponsiveContainer>
  </div>;
}
