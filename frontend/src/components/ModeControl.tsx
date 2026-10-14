/**
 * Segmented radio control for the Leaderboard's board (Daily / Average / Best).
 * Presentational: the caller owns the selected `mode` and is told when it changes.
 */
import { MODES, type LeaderboardMode } from '../lib/leaderboard'
import './ModeControl.css'

export default function ModeControl({
  mode,
  onChange,
}: {
  mode: LeaderboardMode
  onChange: (mode: LeaderboardMode) => void
}) {
  return (
    <fieldset className="mode-control">
      <legend className="sr-only">Leaderboard board</legend>
      {MODES.map((m) => (
        <label key={m.id} className={mode === m.id ? 'mode-option active' : 'mode-option'}>
          <input
            type="radio"
            name="leaderboard-mode"
            value={m.id}
            checked={mode === m.id}
            onChange={() => onChange(m.id)}
          />
          {m.label}
        </label>
      ))}
    </fieldset>
  )
}
