/**
 * A heat map of where a player's missed putts go, over the basket.
 *
 * The same 3×3 layout as the basket picker (MISS_GRID), so it reads as the mirror of
 * how misses are entered: top row high, bottom low, centre a spit-out. The basket
 * sits behind in soft greyscale; each cell is tinted in brand blue by its share of
 * the player's misses (deepest = most-missed) and labelled with its percentage.
 *
 * Shown only when the player has tracked misses (the caller checks total > 0). The
 * counts come from GET /api/misses (complete tests only); see useUserMisses.
 */
import { MISS_GRID, MISS_LABELS, type MissType } from '../lib/putting'
import basket from '../assets/basket.png'
import './MissHeatBasket.css'

export default function MissHeatBasket({
  counts,
  total,
  title = 'Miss distribution',
  embedded = false,
}: {
  counts: Partial<Record<MissType, number>>
  total: number
  title?: string
  /** Render only the heat grid, with no surrounding panel or title, for a caller
   *  that supplies its own frame (e.g. the Daily Putts top panel's Misses view). */
  embedded?: boolean
}) {
  const max = Math.max(1, ...MISS_GRID.flat().map((m) => counts[m] ?? 0))

  const grid = (
    <div className="miss-heat">
      <img src={basket} alt="" className="miss-heat-basket" aria-hidden="true" />
      <div className="miss-heat-grid" role="group" aria-label="Misses by location">
        {MISS_GRID.flat().map((m) => {
          const n = counts[m] ?? 0
          const pct = total ? Math.round((100 * n) / total) : 0
          // Tint from a faint floor up to a mid-strength cap, scaled by how this
          // cell compares to the most-missed one, so the hotspot stands out.
          const alpha = n ? 14 + Math.round((n / max) * 52) : 0
          return (
            <div
              key={m}
              className="miss-heat-cell"
              style={{
                backgroundColor: n
                  ? `color-mix(in srgb, var(--brand) ${alpha}%, transparent)`
                  : 'transparent',
              }}
              aria-label={`${MISS_LABELS[m]}: ${pct}% of misses`}
            >
              {n > 0 && <span className="miss-heat-pct">{pct}%</span>}
            </div>
          )
        })}
      </div>
    </div>
  )

  if (embedded) return grid

  return (
    <div className="panel miss-heat-panel">
      <h2 className="section-title">{title}</h2>
      {grid}
    </div>
  )
}
