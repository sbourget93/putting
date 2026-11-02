/**
 * The comment-count marker: a small muted speech bubble with the comment count
 * inside it, shown to the right of a player's name on the daily leaderboard when
 * their test has at least one comment. Quiet neutral styling, matching the target
 * icon beside it (see CommentIcon.css), so it reads as metadata, not a score.
 *
 * The caller only renders this when count > 0 (see LeaderboardPage), so there is no
 * empty state. Counts above 9 show as "9+" to stay legible inside the small bubble.
 */
import './CommentIcon.css'

export default function CommentIcon({ count }: { count: number }) {
  const label = count > 9 ? '9+' : String(count)
  return (
    <svg
      className="comment-icon"
      viewBox="0 0 24 24"
      role="img"
      aria-label={`${count} ${count === 1 ? 'comment' : 'comments'}`}
      focusable="false"
    >
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
        d="M3 5.5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H9l-4 4v-4H5a2 2 0 0 1-2-2z"
      />
      <text
        x="12"
        y="9.5"
        textAnchor="middle"
        dominantBaseline="central"
        fontSize="9"
        fontWeight="700"
        fill="currentColor"
        stroke="none"
      >
        {label}
      </text>
    </svg>
  )
}
