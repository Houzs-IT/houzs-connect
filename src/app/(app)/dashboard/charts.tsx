// Dependency-free inline SVG charts for the Dashboard. No chart library: colours
// come in as var(--color-*) tokens from the caller, and every chart uses a fixed
// viewBox that scales to its container width.

export interface Series {
  name: string;
  /** A CSS colour, always a var(--color-*) token from the caller. */
  color: string;
  points: number[];
  /** Dashed line, no fill — for the comparison series. */
  dashed?: boolean;
}

function niceMax(v: number) {
  if (v <= 4) return 4;
  const pow = 10 ** Math.floor(Math.log10(v));
  const step = [1, 2, 2.5, 5, 10].find((s) => s * pow * 4 >= v) ?? 10;
  return step * pow * 4;
}

/**
 * Area chart over evenly spaced day buckets: non-dashed series get a soft
 * gradient fill, dashed series are drawn on top. Y gridlines at quarters with
 * labels; x labels thinned to about seven.
 */
export function AreaChart({
  series,
  labels,
  height = 220,
  id,
}: {
  series: Series[];
  labels: string[];
  height?: number;
  /** Unique per page — the gradient is referenced by id. */
  id: string;
}) {
  const W = 840;
  const H = height;
  const padL = 34;
  const padR = 8;
  const padT = 10;
  const padB = 24;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const n = labels.length;
  const max = niceMax(Math.max(0, ...series.flatMap((s) => s.points)));
  const x = (i: number) => (n <= 1 ? padL + innerW / 2 : padL + (innerW * i) / (n - 1));
  const y = (v: number) => padT + innerH - (innerH * v) / max;
  const every = Math.max(1, Math.ceil(n / 7));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img">
      <defs>
        {series.map((s, si) => (
          <linearGradient key={si} id={`${id}-g${si}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={s.color} stopOpacity={0.22} />
            <stop offset="100%" stopColor={s.color} stopOpacity={0.02} />
          </linearGradient>
        ))}
      </defs>
      {[0, 0.25, 0.5, 0.75, 1].map((f) => {
        const yy = padT + innerH * (1 - f);
        return (
          <g key={f}>
            <line x1={padL} x2={W - padR} y1={yy} y2={yy} stroke="var(--color-border-subtle)" strokeDasharray={f === 0 ? undefined : "3 5"} />
            <text x={padL - 8} y={yy + 3.5} textAnchor="end" fontSize={10} fill="var(--color-faint)">
              {Math.round(max * f)}
            </text>
          </g>
        );
      })}
      {series.map((s, si) => {
        if (!s.points.length) return null;
        const line = s.points.map((v, i) => `${i ? "L" : "M"}${x(i)},${y(v)}`).join(" ");
        const area = `${line} L${x(s.points.length - 1)},${padT + innerH} L${x(0)},${padT + innerH} Z`;
        return (
          <g key={s.name}>
            {!s.dashed && <path d={area} fill={`url(#${id}-g${si})`} />}
            <path
              d={line}
              fill="none"
              stroke={s.color}
              strokeWidth={s.dashed ? 1.6 : 2.2}
              strokeDasharray={s.dashed ? "4 4" : undefined}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </g>
        );
      })}
      {labels.map((l, i) =>
        i % every === 0 || i === n - 1 ? (
          <text
            key={i}
            x={x(i)}
            y={H - 6}
            textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}
            fontSize={10}
            fill="var(--color-faint)"
          >
            {l}
          </text>
        ) : null
      )}
    </svg>
  );
}

/** Ring chart: segments in order, with a figure and caption in the hole. */
export function Donut({
  segments,
  center,
  caption,
  size = 124,
}: {
  segments: { value: number; color: string }[];
  center: string;
  caption: string;
  size?: number;
}) {
  const total = segments.reduce((a, s) => a + s.value, 0);
  const r = 46;
  const c = 2 * Math.PI * r;
  const arcs = segments.reduce<{ len: number; offset: number; color: string }[]>((acc, s) => {
    const prev = acc[acc.length - 1];
    const offset = prev ? prev.offset + prev.len : 0;
    return [...acc, { len: total ? (s.value / total) * c : 0, offset, color: s.color }];
  }, []);
  return (
    <svg viewBox="0 0 120 120" width={size} height={size} role="img" className="shrink-0">
      <circle cx={60} cy={60} r={r} fill="none" stroke="var(--color-surface-2)" strokeWidth={13} />
      {arcs.map((a, i) => (
        <circle
          key={i}
          cx={60}
          cy={60}
          r={r}
          fill="none"
          stroke={a.color}
          strokeWidth={13}
          strokeDasharray={`${a.len} ${c - a.len}`}
          strokeDashoffset={-a.offset}
          transform="rotate(-90 60 60)"
        />
      ))}
      <text x={60} y={60} textAnchor="middle" fontSize={21} fontWeight={500} fill="var(--color-ink)">
        {center}
      </text>
      <text x={60} y={76} textAnchor="middle" fontSize={9.5} fill="var(--color-faint)">
        {caption}
      </text>
    </svg>
  );
}
