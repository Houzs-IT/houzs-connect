// Dependency-free inline SVG charts for the Dashboard. No external chart lib —
// the whole point is to stay on the Ink & Petrol tokens (colours come in as CSS
// var() strings from the caller) and ship zero KB of vendor code. Every chart
// uses a fixed viewBox and scales to its container width via CSS.

/** A single line series: a colour token and one value per bucket. */
export interface Series {
  name: string;
  /** A CSS colour, always a var(--color-*) token from the caller. */
  color: string;
  points: number[];
}

/**
 * Multi-series line chart over evenly-spaced buckets (e.g. days). Draws a soft
 * baseline grid, one polyline per series, and dots at each vertex. Used by
 * Message Analytics and Calling Analytics.
 */
export function LineChart({
  series,
  labels,
  height = 132,
}: {
  series: Series[];
  labels: string[];
  height?: number;
}) {
  const W = 320;
  const H = height;
  const padL = 4;
  const padR = 4;
  const padT = 8;
  const padB = 18;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const n = labels.length;
  const max = Math.max(1, ...series.flatMap((s) => s.points));
  // x for bucket i; when n === 1 pin to the centre to avoid a divide-by-zero.
  const x = (i: number) => (n <= 1 ? W / 2 : padL + (innerW * i) / (n - 1));
  const y = (v: number) => padT + innerH - (innerH * v) / max;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="h-auto w-full"
      role="img"
    >
      {/* horizontal gridlines at 0/50/100% */}
      {[0, 0.5, 1].map((f) => (
        <line
          key={f}
          x1={padL}
          x2={W - padR}
          y1={padT + innerH * f}
          y2={padT + innerH * f}
          stroke="var(--color-border)"
          strokeWidth={1}
          strokeDasharray={f === 1 ? undefined : "3 4"}
        />
      ))}
      {series.map((s) => {
        const d = s.points.map((v, i) => `${x(i)},${y(v)}`).join(" ");
        return (
          <g key={s.name}>
            <polyline
              points={d}
              fill="none"
              stroke={s.color}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {s.points.map((v, i) => (
              <circle key={i} cx={x(i)} cy={y(v)} r={2.2} fill={s.color} />
            ))}
          </g>
        );
      })}
      {/* x labels — thin, only the ends + middle to avoid clutter */}
      {labels.map((l, i) => {
        if (n > 4 && i !== 0 && i !== n - 1 && i !== Math.floor(n / 2)) return null;
        return (
          <text
            key={i}
            x={x(i)}
            y={H - 5}
            textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}
            fontSize={9}
            fill="var(--color-faint)"
          >
            {l}
          </text>
        );
      })}
    </svg>
  );
}

/**
 * Simple vertical bar chart for a small set of labelled values (tags reach,
 * calling-activity buckets). Bars use a single colour token; values are shown
 * beneath each bar.
 */
export function BarChart({
  data,
  color = "var(--color-accent)",
  height = 132,
}: {
  data: { label: string; value: number }[];
  color?: string;
  height?: number;
}) {
  const W = 320;
  const H = height;
  const padT = 10;
  const padB = 20;
  const innerH = H - padT - padB;
  const max = Math.max(1, ...data.map((d) => d.value));
  const n = Math.max(1, data.length);
  const slot = W / n;
  const barW = Math.min(34, slot * 0.55);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img">
      <line
        x1={0}
        x2={W}
        y1={padT + innerH}
        y2={padT + innerH}
        stroke="var(--color-border)"
        strokeWidth={1}
      />
      {data.map((d, i) => {
        const h = (innerH * d.value) / max;
        const cx = slot * i + slot / 2;
        return (
          <g key={d.label}>
            <rect
              x={cx - barW / 2}
              y={padT + innerH - h}
              width={barW}
              height={h}
              rx={3}
              fill={color}
            />
            <text
              x={cx}
              y={H - 6}
              textAnchor="middle"
              fontSize={9}
              fill="var(--color-faint)"
            >
              {d.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
