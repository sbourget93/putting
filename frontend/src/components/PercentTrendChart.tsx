/**
 * Overall make-% over time, drawn as a self-contained SVG.
 *
 * X is the calendar day (spaced by real time, so gaps between sessions show as
 * gaps), bounded by the first and last day given. Y is make % (0–100). One brand
 * polyline + dots, theme-aware via CanvasText, scaling to its container via
 * viewBox — the same conventions as PuttingChart, whose CSS classes it reuses.
 */
import './PuttingChart.css'

export interface TrendPoint {
  day: string // YYYY-MM-DD
  pct: number // 0–100
}

const W = 340
const H = 96
const PAD = { top: 10, right: 16, bottom: 26, left: 34 }
const PLOT_W = W - PAD.left - PAD.right
const PLOT_H = H - PAD.top - PAD.bottom

// A tight Y window around the data rather than a fixed 0–100, so day-to-day
// changes in a narrow band are legible. Round the min down and the max up to a
// multiple of 10, then pad two more each way (65–78 → 58–82), clamped to [0, 100].
function yBounds(pcts: number[]): { lo: number; hi: number } {
  const lo = Math.max(0, Math.floor(Math.min(...pcts) / 10) * 10 - 2)
  const hi = Math.min(100, Math.ceil(Math.max(...pcts) / 10) * 10 + 2)
  return hi > lo ? { lo, hi } : { lo: Math.max(0, lo - 10), hi: Math.min(100, hi + 10) }
}

/** Gridline values: every multiple of 10 inside [lo, hi]. */
function yTicks(lo: number, hi: number): number[] {
  const ticks: number[] = []
  for (let t = Math.ceil(lo / 10) * 10; t <= hi; t += 10) ticks.push(t)
  return ticks
}

/** Local midnight timestamp for a YYYY-MM-DD day (parsed as a local date). */
function dayTime(day: string): number {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1).getTime()
}

/** Compact axis label for a day, e.g. "8/25". */
function fmtDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  const date = new Date(y, (m ?? 1) - 1, d ?? 1)
  if (Number.isNaN(date.getTime())) return day
  return date.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' })
}

export default function PercentTrendChart({ points }: { points: TrendPoint[] }) {
  const pts = [...points].sort((a, b) => a.day.localeCompare(b.day))
  if (pts.length === 0) return null

  const tMin = dayTime(pts[0].day)
  const tMax = dayTime(pts[pts.length - 1].day)
  const span = tMax - tMin || 1 // avoid /0 when there's a single day

  const { lo, hi } = yBounds(pts.map((p) => p.pct))
  const yRange = hi - lo
  const x = (t: number) => PAD.left + (tMax === tMin ? PLOT_W / 2 : ((t - tMin) / span) * PLOT_W)
  const y = (pct: number) => PAD.top + (1 - (pct - lo) / yRange) * PLOT_H

  const coords = pts.map((p) => ({ ...p, cx: x(dayTime(p.day)), cy: y(p.pct) }))
  const line = coords.map((c) => `${c.cx},${c.cy}`).join(' ')

  // Label the ends (and the middle when there's room), anchored so the first and
  // last dates never clip past the plot edges.
  const last = pts.length - 1
  const labelIdx =
    pts.length >= 3 ? [0, Math.floor(last / 2), last] : Array.from(new Set([0, last]))

  const summary =
    pts.length === 1
      ? `Overall make percentage: ${Math.round(pts[0].pct)}% on ${fmtDay(pts[0].day)}`
      : `Overall make percentage over time, from ${fmtDay(pts[0].day)} to ${fmtDay(pts[last].day)}`

  return (
    <svg
      className="putting-chart"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={summary}
      preserveAspectRatio="xMidYMid meet"
    >
      {/* Y gridlines + labels */}
      {yTicks(lo, hi).map((t) => (
        <g key={t}>
          <line className="grid" x1={PAD.left} y1={y(t)} x2={W - PAD.right} y2={y(t)} />
          <text className="axis-label" x={PAD.left - 6} y={y(t)} dominantBaseline="middle" textAnchor="end">
            {t}
          </text>
        </g>
      ))}

      {/* X date labels at the ends (and middle) */}
      {labelIdx.map((i) => {
        const anchor = i === 0 ? 'start' : i === last ? 'end' : 'middle'
        return (
          <text
            key={pts[i].day}
            className="axis-label"
            x={coords[i].cx}
            y={H - PAD.bottom + 16}
            textAnchor={anchor}
          >
            {fmtDay(pts[i].day)}
          </text>
        )
      })}

      {/* One brand line + dots */}
      {pts.length > 1 && (
        <polyline
          className="series-line"
          points={line}
          style={{ stroke: 'var(--brand)', strokeWidth: 2.4 }}
        />
      )}
      {coords.map((c) => (
        <circle
          key={c.day}
          className="series-dot"
          cx={c.cx}
          cy={c.cy}
          r={3.5}
          style={{ fill: 'var(--brand)' }}
        >
          <title>
            {fmtDay(c.day)} — {Math.round(c.pct)}%
          </title>
        </circle>
      ))}
    </svg>
  )
}
