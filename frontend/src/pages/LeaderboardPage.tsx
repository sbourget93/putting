/**
 * Leaderboard — players ranked by daily-test make %, across three boards:
 *
 * - Daily: one day's test, defaulting to today. A date picker steps through (or
 *   drops down) every day that has a completed test; "today"/"yesterday" are named,
 *   other days show their date.
 * - Average: each player's last 50 tests from the past year, pooled.
 * - Best: each player's single best test ever.
 *
 * Tapping a player expands their make-%-by-distance graph for that board. All reads
 * are online (see useLeaderboard): the board spans every player, so there is nothing
 * to fold from the local cache.
 *
 * On today's Daily board, players who have started but not finished today's test
 * show at the bottom with a caution sign instead of a rank. That only makes sense
 * for today; a past day's unfinished test is abandoned, so in-progress is hidden there.
 */
import { useMemo, useState } from 'react'
import { useLeaderboard } from '../lib/useLeaderboard'
import { useGlobalStats } from '../lib/useGlobalStats'
import { useUserMisses } from '../lib/useUserHistory'
import { MODE_BLURB, formatDay, type LeaderboardMode } from '../lib/leaderboard'
import { localDay, type DistanceStat } from '../lib/putting'
import ModeControl from '../components/ModeControl'
import DayPicker from '../components/DayPicker'
import ToggleChartPanel from '../components/ToggleChartPanel'
import './LeaderboardPage.css'

/**
 * One expanded player's chart, in the Daily Putts page's format: their board result
 * vs a grey comparison line, with a Putts / Misses toggle when they have recorded
 * misses. The comparison and the misses are scoped to match the board (see the
 * caller): Daily and Best compare against the player's own all-time; Average compares
 * against the all-players line, and both its line and its map cover only the pooled
 * selection. Misses are fetched per player, so this is a component — it mounts when a
 * row opens.
 */
function ExpandedChart({
  sub,
  stats,
  baselineStats,
  baselineLabel,
  seriesLabel,
  missDay,
  missScope,
}: {
  sub: string
  stats: DistanceStat[]
  baselineStats: DistanceStat[]
  baselineLabel: string
  seriesLabel: string
  /** On the Daily board, the day to scope the miss map to. */
  missDay?: string
  /** On the Average board, 'average' to scope the miss map to the pooled tests. */
  missScope?: 'average'
}) {
  const { counts, total } = useUserMisses(sub, { day: missDay, scope: missScope })
  return (
    <ToggleChartPanel
      seriesLabel={seriesLabel}
      stats={stats}
      baselineStats={baselineStats}
      baselineLabel={baselineLabel}
      missCounts={counts}
      missTotal={total}
      showMissToggle={total > 0}
      emptyNote="No data yet."
      alwaysRenderChart
    />
  )
}

/** A small "M" pill marking a row whose expanded view has a miss map to show. */
function MissFlag() {
  return (
    <span className="miss-flag" aria-label="Misses tracked" title="Misses tracked">
      M
    </span>
  )
}

/** Caution triangle shown in the rank slot for a mid-round player. */
function CautionIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
        d="M12 3 1.5 21h21z M12 10v5 M12 18h.01"
      />
    </svg>
  )
}

function LeaderboardPage() {
  const [mode, setMode] = useState<LeaderboardMode>('daily')
  const [day, setDay] = useState<string>(() => localDay())
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const { entries, inProgress, days, averageAll, loading, error } = useLeaderboard(mode, day)
  // Each player's own all-time make-% by distance, the grey comparison line the
  // Daily and Best boards draw behind a player's result (the same lifetime line the
  // Daily Putts page compares against).
  const { users: allTimeUsers } = useGlobalStats()
  const allTimeBySub = useMemo(
    () => new Map(allTimeUsers.map((u) => [u.sub, u.stats])),
    [allTimeUsers],
  )

  // In-progress players only make sense for today's Daily board.
  const today = localDay()
  const showInProgress = mode === 'daily' && day === today
  const pending = showInProgress ? inProgress : []
  const blurb = MODE_BLURB[mode]

  // Label for a player's primary line, naming what the board is showing.
  const resultLabel =
    mode === 'daily' ? (day === today ? 'Today' : formatDay(day)) : mode === 'average' ? 'Average' : 'Best'

  // The comparison line and the miss map are scoped to match the board. Comparison:
  // Average is the all-players filtered line; Daily and Best compare against the
  // player's own all-time. Misses: Average over its pooled tests, Daily over the
  // selected day, Best over its best test's day (set per entry below).
  const baselineLabel = mode === 'average' ? 'All players' : 'All-time'
  const missDay = mode === 'daily' ? day : undefined
  const missScope = mode === 'average' ? ('average' as const) : undefined
  const baselineFor = (sub: string) =>
    mode === 'average' ? averageAll : (allTimeBySub.get(sub) ?? [])

  // Today is always offered, even before anyone has putted: `days` lists only dates
  // with a completed test, so prepend today when it isn't there yet (it is newest).
  const pickerDays = days.includes(today) ? days : [today, ...days]

  function toggle(sub: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(sub)) next.delete(sub)
      else next.add(sub)
      return next
    })
  }

  return (
    <section className="page leaderboard">
      <div className="page-head">
        <h1>Leaderboard</h1>
      </div>

      {/* Mode picker, date picker, and description share one bordered card. The
          second row keeps a fixed height across modes so the board below never
          shifts when you switch. */}
      <div className="board-controls">
        <ModeControl
          mode={mode}
          onChange={(m) => {
            setMode(m)
            setExpanded(new Set())
          }}
        />
        <div className="board-controls-sub">
          {mode === 'daily' ? (
            <DayPicker
              day={day}
              days={pickerDays}
              onChange={(d) => {
                setDay(d)
                setExpanded(new Set())
              }}
            />
          ) : (
            <p className="board-blurb">{blurb}</p>
          )}
        </div>
      </div>

      {error && <p className="error" role="alert">{error}</p>}

      {loading ? (
        <p className="muted">Loading…</p>
      ) : entries.length === 0 && pending.length === 0 ? (
        <div className="panel">
          <p className="muted">
            {mode === 'daily' ? 'No completed tests for this day yet.' : 'No scores yet.'}
          </p>
        </div>
      ) : (
        <ol className="board-list">
          {entries.map((entry, i) => {
            const isOpen = expanded.has(entry.sub)
            return (
              <li key={entry.sub} className="board-entry">
                <button
                  type="button"
                  className="board-row"
                  aria-expanded={isOpen}
                  onClick={() => toggle(entry.sub)}
                >
                  <span className="board-rank">{i + 1}</span>
                  {entry.picture && (
                    <img className="board-avatar" src={entry.picture} alt="" referrerPolicy="no-referrer" />
                  )}
                  <span className="board-namecol">
                    <span className="board-name">{entry.name}</span>
                    {mode === 'average' && entry.sessions != null && (
                      <span className="board-sub">
                        {entry.sessions} {entry.sessions === 1 ? 'session' : 'sessions'} included
                      </span>
                    )}
                    {mode === 'best' && entry.date && (
                      <span className="board-sub">{formatDay(entry.date)}</span>
                    )}
                    {mode === 'daily' && entry.message && (
                      <span className="board-sub board-message">{entry.message}</span>
                    )}
                  </span>
                  {entry.has_misses && <MissFlag />}
                  <span className="board-pct">{Math.round(entry.overall_pct)}%</span>
                </button>

                {isOpen && (
                  <div className="entry-detail">
                    <ExpandedChart
                      sub={entry.sub}
                      stats={entry.stats}
                      baselineStats={baselineFor(entry.sub)}
                      baselineLabel={baselineLabel}
                      seriesLabel={resultLabel}
                      // Best scopes to that player's best test's day (the line's test);
                      // Daily to the board's day; Average uses missScope instead.
                      missDay={mode === 'best' ? entry.date : missDay}
                      missScope={missScope}
                    />
                  </div>
                )}
              </li>
            )
          })}

          {/* Mid-round players, pinned below the ranked board: no rank or score
              yet, a caution and how many batches remain instead. Tapping one opens
              their partial make-%-by-distance line, like a ranked row. */}
          {pending.map((p) => {
            const isOpen = expanded.has(p.sub)
            return (
              <li key={p.sub} className="board-entry">
                <button
                  type="button"
                  className="board-row"
                  aria-expanded={isOpen}
                  onClick={() => toggle(p.sub)}
                >
                  <span className="board-rank" aria-hidden="true" />
                  {p.picture && (
                    <img className="board-avatar" src={p.picture} alt="" referrerPolicy="no-referrer" />
                  )}
                  <span className="board-namecol">
                    <span className="board-name">{p.name}</span>
                  </span>
                  {p.has_misses && <MissFlag />}
                  <span className="board-remaining">
                    <CautionIcon />
                    {p.remaining} {p.remaining === 1 ? 'batch' : 'batches'} remaining
                  </span>
                </button>

                {isOpen && (
                  <div className="entry-detail">
                    <ExpandedChart
                      sub={p.sub}
                      stats={p.stats}
                      baselineStats={allTimeBySub.get(p.sub) ?? []}
                      baselineLabel="All-time"
                      seriesLabel="Today"
                      missDay={day}
                    />
                  </div>
                )}
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}

export default LeaderboardPage
