/**
 * The "misses tracked" marker: a small muted target shown to the right of a
 * player's name (Leaderboard) or a test's date (Player Profile) when that row has
 * tracked misses to show. Shared so both places read identically.
 */
import './TargetIcon.css'

export default function TargetIcon() {
  return (
    <svg
      className="target-icon"
      viewBox="0 0 24 24"
      role="img"
      aria-label="Misses tracked"
      focusable="false"
    >
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" />
      <circle cx="12" cy="12" r="4.5" fill="none" stroke="currentColor" strokeWidth="2" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" />
    </svg>
  )
}
