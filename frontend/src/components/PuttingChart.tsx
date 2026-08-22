/**
 * Make-percentage-by-distance line chart, drawn as a self-contained SVG.
 *
 * X is distance (ft), Y is make % (0–100). The primary series (--brand) is drawn
 * over an optional grey `baseline` series, letting a page compare, say, today's
 * putts against the user's all-time average. No chart library: a handful of scales
 * and an SVG polyline keep it tiny, offline, and theme-aware (axes use
 * currentColor). The SVG scales to its container via viewBox.
 */
import type { DistanceStat } from '../lib/putting'
import './PuttingChart.css'

const W = 340
const H = 240
const PAD = { top: 12, right: 14, bottom: 30, left: 34 }
const PLOT_W = W - PAD.left - PAD.right
const PLOT_H = H - PAD.top - PAD.bottom
const Y_TICKS = [0, 25, 50, 75, 100]

export default function PuttingChart({
  stats,
  baseline = [],
}: {
  stats: DistanceStat[]
  baseline?: DistanceStat[]
}) {
  // Scale X across both series so the two lines share a domain and line up.
  const allDistances = [...stats, ...baseline].map((s) => s.distance)
  const minD = allDistances.length ? Math.min(...allDistances) : 0
  const maxD = allDistances.length ? Math.max(...allDistances) : 1
  const span = maxD - minD || 1 // avoid /0 when there's a single distance

  const x = (d: number) => PAD.left + (span === 0 ? PLOT_W / 2 : ((d - minD) / span) * PLOT_W)
  const y = (pct: number) => PAD.top + (1 - pct / 100) * PLOT_H

  const points = stats.map((s) => `${x(s.distance)},${y(s.pct)}`).join(' ')
  const baselinePoints = baseline.map((s) => `${x(s.distance)},${y(s.pct)}`).join(' ')
  // X-axis ticks: label every distance in the wider series, thinned so they don't collide.
  const axisStats = baseline.length > stats.length ? baseline : stats
  const labelStep = Math.max(1, Math.ceil(axisStats.length / 8))

  const summary = stats.length
    ? `Make percentage by distance from ${minD} to ${maxD} feet`
    : 'No data'

  return (
    <svg
      className="putting-chart"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={summary}
      preserveAspectRatio="xMidYMid meet"
    >
      {/* Y gridlines + labels */}
      {Y_TICKS.map((t) => (
        <g key={t}>
          <line className="grid" x1={PAD.left} y1={y(t)} x2={W - PAD.right} y2={y(t)} />
          <text className="axis-label" x={PAD.left - 6} y={y(t)} dominantBaseline="middle" textAnchor="end">
            {t}
          </text>
        </g>
      ))}

      {/* X labels (thinned so they don't collide) */}
      {axisStats.map((s, i) =>
        i % labelStep === 0 || i === axisStats.length - 1 ? (
          <text
            key={s.distance}
            className="axis-label"
            x={x(s.distance)}
            y={H - PAD.bottom + 16}
            textAnchor="middle"
          >
            {s.distance}
          </text>
        ) : null,
      )}
      <text className="axis-title" x={PAD.left + PLOT_W / 2} y={H - 2} textAnchor="middle">
        distance (ft)
      </text>

      {/* The baseline (all-time) series, drawn behind the primary one */}
      {baseline.length > 1 && <polyline className="baseline-line" points={baselinePoints} />}
      {baseline.map((s) => (
        <circle key={s.distance} className="baseline-dot" cx={x(s.distance)} cy={y(s.pct)} r={2}>
          <title>
            All-time {s.distance} ft — {s.made}/{s.attempts} ({Math.round(s.pct)}%)
          </title>
        </circle>
      ))}

      {/* The primary series */}
      {stats.length > 1 && <polyline className="series-line" points={points} />}
      {stats.map((s) => (
        <circle key={s.distance} className="series-dot" cx={x(s.distance)} cy={y(s.pct)} r={3.5}>
          <title>
            {s.distance} ft — {s.made}/{s.attempts} ({Math.round(s.pct)}%)
          </title>
        </circle>
      ))}
    </svg>
  )
}
