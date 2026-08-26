/**
 * Make-percentage-by-distance line chart, drawn as a self-contained SVG.
 *
 * X is distance (ft), Y is make % (0–100). Takes N named series and draws one
 * polyline + dots per series, each in its own color (set inline, since colors are
 * assigned dynamically from the categorical palette). No chart library: a handful
 * of scales and SVG polylines keep it tiny, offline, and theme-aware (axes use
 * CanvasText). The SVG scales to its container via viewBox.
 *
 * A `dashed` series (e.g. the global average) is drawn thinner and behind the
 * solid ones; an `emphasis` series (e.g. "you") is drawn thicker and on top.
 * Identity is carried by the caller's legend, never by color alone.
 */
import type { DistanceStat } from '../lib/putting'
import './PuttingChart.css'

export interface SeriesSpec {
  id: string
  label: string
  color: string // any CSS color, typically a var(--series-N)
  stats: DistanceStat[]
  dashed?: boolean
  emphasis?: boolean
}

const W = 340
const H = 240
const PAD = { top: 12, right: 14, bottom: 30, left: 34 }
const PLOT_W = W - PAD.left - PAD.right
const PLOT_H = H - PAD.top - PAD.bottom
const Y_TICKS = [0, 20, 40, 60, 80, 100]

// Draw dashed (background) series first, plain next, emphasized last (on top).
function depth(s: SeriesSpec): number {
  if (s.dashed) return 0
  return s.emphasis ? 2 : 1
}

export default function PuttingChart({ series }: { series: SeriesSpec[] }) {
  const drawn = series.filter((s) => s.stats.length > 0)

  // Scale X across every series so all lines share one domain and line up.
  const allDistances = drawn.flatMap((s) => s.stats.map((p) => p.distance))
  const minD = allDistances.length ? Math.min(...allDistances) : 0
  const maxD = allDistances.length ? Math.max(...allDistances) : 1
  const span = maxD - minD || 1 // avoid /0 when there's a single distance

  const x = (d: number) => PAD.left + (span === 0 ? PLOT_W / 2 : ((d - minD) / span) * PLOT_W)
  const y = (pct: number) => PAD.top + (1 - pct / 100) * PLOT_H

  // X-axis ticks come from whichever series covers the most distances.
  const axisStats = drawn.reduce<DistanceStat[]>(
    (widest, s) => (s.stats.length > widest.length ? s.stats : widest),
    [],
  )
  const labelStep = Math.max(1, Math.ceil(axisStats.length / 8))

  // Subtle vertical guides at every 5 ft from 15 up, so the eye can read a
  // distance off the line without counting ticks.
  const fiveFtMarks: number[] = []
  for (let d = 15; d <= maxD; d += 5) {
    if (d >= minD) fiveFtMarks.push(d)
  }

  const ordered = [...drawn].sort((a, b) => depth(a) - depth(b))

  const summary = allDistances.length
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

      {/* Faint 5-ft vertical guides */}
      {fiveFtMarks.map((d) => (
        <line key={`v${d}`} className="grid grid-v" x1={x(d)} y1={y(100)} x2={x(d)} y2={y(0)} />
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

      {/* One polyline + dots per series, in back-to-front order. */}
      {ordered.map((s) => {
        const points = s.stats.map((p) => `${x(p.distance)},${y(p.pct)}`).join(' ')
        const lineWidth = s.emphasis ? 3 : s.dashed ? 1.5 : 2.2
        const dotR = s.emphasis ? 4 : s.dashed ? 2.5 : 3.5
        return (
          <g key={s.id}>
            {s.stats.length > 1 && (
              <polyline
                className="series-line"
                points={points}
                style={{
                  stroke: s.color,
                  strokeWidth: lineWidth,
                  strokeDasharray: s.dashed ? '5 4' : undefined,
                }}
              />
            )}
            {s.stats.map((p) => (
              <circle
                key={p.distance}
                className="series-dot"
                cx={x(p.distance)}
                cy={y(p.pct)}
                r={dotR}
                style={{ fill: s.color }}
              >
                <title>
                  {/* attempts === 0 marks a computed line (the global average) with
                      no underlying made/attempts, so show the percentage alone. */}
                  {s.label} — {p.distance} ft —{' '}
                  {p.attempts > 0 ? `${p.made}/${p.attempts} (${Math.round(p.pct)}%)` : `${Math.round(p.pct)}%`}
                </title>
              </circle>
            ))}
          </g>
        )
      })}
    </svg>
  )
}
