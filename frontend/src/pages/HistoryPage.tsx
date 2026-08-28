/**
 * History — one entry per daily test, newest first.
 *
 * Each entry is a row: the test's date and that day's overall make percentage.
 * Tapping a row expands it to the same make-%-by-distance graph the completed
 * daily-putts summary shows — that day's line against the player's all-time line.
 *
 * A picker at the top chooses whose history to view, defaulting to the viewer's
 * own (or the demo owner's). All of it is fetched online on demand (see
 * useUserHistory) — History is not cached on the device, only Daily Putts is.
 * Editing was removed for now.
 *
 * Legacy free batches (no test) are grouped by their calendar day into their own
 * entries so nothing is hidden, even though free putting is no longer recorded.
 */
import { useMemo, useRef, useState } from 'react'
import { useUserHistory, useUsers } from '../lib/useUserHistory'
import StatsChartPanel from '../components/StatsChartPanel'
import PercentTrendChart from '../components/PercentTrendChart'
import {
  isTestComplete,
  localDay,
  overallPct,
  remainingTestDistances,
  statsByDistance,
  type Batch,
  type Test,
} from '../lib/putting'
import './HistoryPage.css'

/** Format a YYYY-MM-DD calendar day as a local, human-readable date. */
function formatDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  const date = new Date(y, (m ?? 1) - 1, d ?? 1)
  if (Number.isNaN(date.getTime())) return day
  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

/** One collapsible entry: a day (test or legacy free) and the batches under it. */
interface DayEntry {
  key: string
  day: string
  isTest: boolean
  batches: Batch[]
}

/**
 * Group batches into one entry per test, newest first. Test batches attach to
 * their test; legacy free batches (no test) are bucketed by their calendar day.
 */
function buildEntries(tests: Test[], batches: Batch[]): DayEntry[] {
  const byTest = new Map<string, Batch[]>()
  const freeByDay = new Map<string, Batch[]>()

  for (const b of batches) {
    if (b.kind === 'test' && b.test_id) {
      const list = byTest.get(b.test_id) ?? []
      list.push(b)
      byTest.set(b.test_id, list)
    } else {
      const day = localDay(new Date(b.created_at))
      const list = freeByDay.get(day) ?? []
      list.push(b)
      freeByDay.set(day, list)
    }
  }

  const entries: DayEntry[] = []
  for (const t of tests) {
    const testBatches = byTest.get(t.test_id) ?? []
    if (testBatches.length === 0) continue
    entries.push({ key: t.test_id, day: t.test_date, isTest: true, batches: testBatches })
  }
  for (const [day, list] of freeByDay) {
    entries.push({ key: `free-${day}`, day, isTest: false, batches: list })
  }

  return entries.sort((a, b) => b.day.localeCompare(a.day))
}

function HistoryPage() {
  const { users } = useUsers()
  const [selectedSub, setSelectedSub] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [searchFocused, setSearchFocused] = useState(false)
  const searchInput = useRef<HTMLInputElement>(null)

  // Whose history is on screen, fetched online on demand: the picker's choice, or
  // the default owner (your own if admin, else the demo owner) when none is picked.
  const { tests, batches, ownerSub, ownerName, loading, error } = useUserHistory(selectedSub)
  const viewingSub = selectedSub ?? ownerSub

  const entries = useMemo(() => buildEntries(tests, batches), [tests, batches])

  // Only complete tests (a putt at every distance) feed the stats and graphs, like
  // the backend. Incomplete days still appear in the list below, just not here.
  const completeEntries = useMemo(
    () => entries.filter((e) => e.isTest && isTestComplete(e.batches)),
    [entries],
  )

  // The player's all-time make-% by distance over complete tests: the identical
  // grey baseline every day's graph compares against.
  const baselineStats = useMemo(
    () => statsByDistance(completeEntries.flatMap((e) => e.batches)),
    [completeEntries],
  )

  // Each complete test's overall %, oldest to newest, for the trend graph.
  const trend = useMemo(
    () =>
      completeEntries
        .map((e) => ({ day: e.day, pct: Math.round(overallPct(e.batches) ?? 0) }))
        .reverse(),
    [completeEntries],
  )

  function toggle(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const sortedUsers = useMemo(
    () => [...users].sort((a, b) => a.name.localeCompare(b.name)),
    [users],
  )

  // Combobox: the input shows the player on screen until focused, then becomes a
  // name search. Suggestions are all players, filtered by the typed query.
  const viewingName =
    sortedUsers.find((u) => u.sub === viewingSub)?.name ?? ownerName ?? ''
  const q = search.trim().toLowerCase()
  const suggestions = q
    ? sortedUsers.filter((u) => u.name.toLowerCase().includes(q))
    : sortedUsers

  return (
    <section className="page history">
      <div className="page-head">
        <h1>History</h1>
      </div>

      {sortedUsers.length > 0 && (
        <div className="history-picker">
          <span className="history-picker-label">Viewing</span>
          <div className="history-search">
            <input
              ref={searchInput}
              type="text"
              className="history-search-input"
              value={searchFocused ? search : viewingName}
              placeholder="Search players…"
              onChange={(e) => setSearch(e.target.value)}
              onFocus={() => {
                setSearchFocused(true)
                setSearch('')
              }}
              onBlur={() => setSearchFocused(false)}
              aria-label="Search players to view"
            />
            {searchFocused && suggestions.length > 0 && (
              <ul className="history-search-results">
                {suggestions.map((u) => (
                  <li key={u.sub}>
                    {/* onMouseDown (not onClick) so the pick lands before the
                        input blurs and closes the list. */}
                    <button
                      type="button"
                      onMouseDown={(e) => {
                        // preventDefault keeps the click from blurring mid-pick;
                        // we then blur explicitly so the field is released and a
                        // later click reopens the search cleanly.
                        e.preventDefault()
                        setSelectedSub(u.sub)
                        setSearch('')
                        setSearchFocused(false)
                        searchInput.current?.blur()
                      }}
                    >
                      {u.picture && (
                        <img className="result-avatar" src={u.picture} alt="" referrerPolicy="no-referrer" />
                      )}
                      <span className="result-name">{u.name}</span>
                      {u.sub === viewingSub && <span className="result-current" aria-hidden="true">✓</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {searchFocused && q.length > 0 && suggestions.length === 0 && (
              <p className="muted history-search-none">No matching players.</p>
            )}
          </div>
        </div>
      )}

      {error && <p className="error" role="alert">{error}</p>}

      {loading ? (
        <p className="muted">Loading…</p>
      ) : entries.length === 0 ? (
        <div className="panel"><p className="muted">No putts recorded yet.</p></div>
      ) : (
        <>
        {trend.length > 0 && (
          <div className="panel chart-panel history-trend">
            <h2 className="section-title">C1X putting percentage</h2>
            <PercentTrendChart points={trend} />
          </div>
        )}
        <ul className="history-list">
          {entries.map((entry) => {
            const isOpen = expanded.has(entry.key)
            const dayPct = Math.round(overallPct(entry.batches) ?? 0)
            // An unfinished test hasn't a putt at every distance yet, so its
            // percentage would be misleading. Flag it and say how much is left
            // instead. Free groups have no fixed size, so they never show this.
            const remaining = entry.isTest
              ? remainingTestDistances(entry.batches, entry.key).length
              : 0
            const incomplete = entry.isTest && remaining > 0
            return (
              <li key={entry.key} className="history-entry">
                <button
                  type="button"
                  className="test-row"
                  aria-expanded={isOpen}
                  onClick={() => toggle(entry.key)}
                >
                  <span className={`chevron${isOpen ? ' open' : ''}`} aria-hidden="true">›</span>
                  <span className="test-date">{formatDay(entry.day)}</span>
                  {!entry.isTest && <span className="kind-badge free">Free</span>}
                  {incomplete ? (
                    <span className="test-remaining">
                      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                        <path
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinejoin="round"
                          strokeLinecap="round"
                          d="M12 3 1.5 21h21z M12 10v5 M12 18h.01"
                        />
                      </svg>
                      {remaining} {remaining === 1 ? 'batch' : 'batches'} remaining
                    </span>
                  ) : (
                    <span className="test-pct">{dayPct}%</span>
                  )}
                </button>

                {isOpen && (
                  <div className="entry-detail">
                    <StatsChartPanel
                      batches={entry.batches}
                      baselineStats={baselineStats}
                      emptyNote="No putts recorded."
                      seriesLabel="This day"
                      baselineLabel="All-time"
                    />
                  </div>
                )}
              </li>
            )
          })}
        </ul>
        </>
      )}
    </section>
  )
}

export default HistoryPage
