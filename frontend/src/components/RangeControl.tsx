/**
 * Segmented radio control for the shared date range (Today / Last 30 days / All
 * time). Presentational: the caller owns the selected `range` and is told when it
 * changes. Used by the Leaderboard and Compare pages so both offer the identical
 * window choice.
 */
import { RANGES, type Range } from '../lib/range'
import './RangeControl.css'

export default function RangeControl({
  range,
  onChange,
  name,
}: {
  range: Range
  onChange: (range: Range) => void
  /** Radio group name, unique per page so two controls never share a group. */
  name: string
}) {
  return (
    <fieldset className="range-control">
      <legend className="sr-only">Time range</legend>
      {RANGES.map((r) => (
        <label key={r.id} className={range === r.id ? 'range-option active' : 'range-option'}>
          <input
            type="radio"
            name={name}
            value={r.id}
            checked={range === r.id}
            onChange={() => onChange(r.id)}
          />
          {r.label}
        </label>
      ))}
    </fieldset>
  )
}
