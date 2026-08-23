/**
 * Statistics — compare users' make-percentage-by-distance.
 *
 * Every line comes from the public GET /stats (see lib/useStats): comparing other
 * users is inherently an online read, since their data isn't in the local cache.
 *
 * Defaults: a signed-in user with data sees their own line (global average off);
 * everyone else sees only the global average (on). From there anyone can add users
 * via the look-ahead search, remove them, and toggle the global average. Each user
 * gets a stable palette color (see lib/seriesColors) carried by a name chip, so a
 * line's identity is never color-alone.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../auth-context'
import { useStats } from '../lib/useStats'
import type { DistanceStat, UserStats } from '../lib/putting'
import { GLOBAL_COLOR, SERIES_SLOTS, seriesColor } from '../lib/seriesColors'
import PuttingChart, { type SeriesSpec } from '../components/PuttingChart'
import './StatsPage.css'

const GLOBAL_ID = '__global'
const DEFAULT_SUGGESTIONS = 6 // users shown in the picker before any typing

/** "Name - 77%", or just the name when the player has no attempts yet. */
function nameWithPct(name: string, stats: DistanceStat[]): string {
  const pct = overallPct(stats)
  return pct != null ? `${name} - ${pct}%` : name
}

/** A user's pooled overall make % across all distances, or null with no attempts. */
function overallPct(stats: DistanceStat[]): number | null {
  let made = 0
  let attempts = 0
  for (const s of stats) {
    made += s.made
    attempts += s.attempts
  }
  return attempts ? Math.round((100 * made) / attempts) : null
}

/** The global line as chart points; attempts:0 marks it as a computed series. */
function globalSeriesStats(global: { distance: number; pct: number }[]): DistanceStat[] {
  return global.map((g) => ({ distance: g.distance, pct: g.pct, made: 0, attempts: 0 }))
}

function StatsPage() {
  const { user } = useAuth()
  const { users, global, loading, error } = useStats()

  const [selectedSubs, setSelectedSubs] = useState<string[]>([])
  const [showGlobal, setShowGlobal] = useState(false)
  const [search, setSearch] = useState('')
  const [searchFocused, setSearchFocused] = useState(false)

  const usersBySub = useMemo(() => new Map(users.map((u) => [u.sub, u])), [users])

  // Stable sub -> palette slot. Assigned on add and kept, so removing one user
  // never repaints the survivors (color follows the entity, not its position).
  const slots = useRef(new Map<string, number>())
  function slotFor(sub: string, currentlySelected: string[]): number {
    const map = slots.current
    const taken = new Set(
      currentlySelected.map((s) => map.get(s)).filter((n): n is number => n != null),
    )
    const existing = map.get(sub)
    if (existing != null && !taken.has(existing)) return existing // reuse if free
    let slot = 0
    while (taken.has(slot) && slot < SERIES_SLOTS) slot++
    map.set(sub, slot)
    return slot
  }

  // One-time default: your own line if you have data, else the global average.
  const initialized = useRef(false)
  useEffect(() => {
    if (loading || initialized.current) return
    initialized.current = true
    if (user?.sub && usersBySub.has(user.sub)) {
      slotFor(user.sub, [])
      setSelectedSubs([user.sub])
      setShowGlobal(false)
    } else {
      setShowGlobal(true)
    }
    // Runs once when stats finish loading; slotFor only mutates a ref.
  }, [loading, usersBySub, user?.sub])

  const atCapacity = selectedSubs.length >= SERIES_SLOTS

  // Addable users, best make % first. With no query we still surface the top few,
  // so the picker is useful without typing; a query filters by name.
  const q = search.trim().toLowerCase()
  const candidates = users
    .filter((u) => !selectedSubs.includes(u.sub))
    .map((u) => ({ user: u, pct: overallPct(u.stats) }))
    .filter(({ user: u }) => (q ? u.name.toLowerCase().includes(q) : true))
    .sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1))
  const suggestions = q ? candidates : candidates.slice(0, DEFAULT_SUGGESTIONS)

  function addUser(sub: string) {
    if (atCapacity || selectedSubs.includes(sub)) return
    slotFor(sub, selectedSubs)
    setSelectedSubs((prev) => [...prev, sub])
    setSearch('')
  }

  function removeUser(sub: string) {
    setSelectedSubs((prev) => prev.filter((s) => s !== sub))
  }

  const selectedUsers = selectedSubs
    .map((sub) => usersBySub.get(sub))
    .filter((u): u is UserStats => u != null)

  const series: SeriesSpec[] = [
    ...selectedUsers.map((u) => ({
      id: u.sub,
      label: u.name,
      color: seriesColor(slots.current.get(u.sub) ?? 0),
      stats: u.stats,
      emphasis: u.sub === user?.sub,
    })),
    ...(showGlobal
      ? [{ id: GLOBAL_ID, label: 'Global average', color: GLOBAL_COLOR, stats: globalSeriesStats(global), dashed: true }]
      : []),
  ]

  const noPlayers = users.length === 0
  const soleOverall =
    selectedUsers.length === 1 ? overallPct(selectedUsers[0].stats) : null

  if (loading) {
    return (
      <section className="page">
        <p className="muted">Loading…</p>
      </section>
    )
  }

  return (
    <section className="page stats">
      <div className="page-head">
        <h1>Statistics</h1>
        {soleOverall != null && <span className="progress-pill">{soleOverall}%</span>}
      </div>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <div className="panel chart-panel">
        {/* Always render the chart (empty = just axes) so the page never shifts
            as series toggle on and off. */}
        <PuttingChart series={series} />

        {selectedUsers.length > 0 && (
          <ul className="stats-legend" aria-label="Players shown">
            {selectedUsers.map((u) => (
              <li key={u.sub}>
                <button
                  type="button"
                  className="legend-chip"
                  onClick={() => removeUser(u.sub)}
                  aria-label={`Remove ${u.name}`}
                >
                  <span
                    className="legend-swatch"
                    style={{ background: seriesColor(slots.current.get(u.sub) ?? 0) }}
                    aria-hidden="true"
                  />
                  {nameWithPct(u.name, u.stats)}
                  <span className="chip-x" aria-hidden="true">
                    ×
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="panel stats-controls">
        <div className="stats-search">
          <input
            type="text"
            className="stats-search-input"
            placeholder={atCapacity ? 'Maximum players shown' : 'Add a player to compare…'}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            disabled={atCapacity}
            aria-label="Search players to compare"
          />
          {searchFocused && suggestions.length > 0 && (
            <ul className="stats-search-results">
              {suggestions.map(({ user: u, pct }) => (
                <li key={u.sub}>
                  {/* onMouseDown (not onClick) so adding fires before the input
                      blurs — the picker stays open to add several in a row. */}
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault()
                      addUser(u.sub)
                    }}
                  >
                    {u.picture && (
                      <img className="result-avatar" src={u.picture} alt="" referrerPolicy="no-referrer" />
                    )}
                    <span className="result-name">{u.name}</span>
                    {pct != null && <span className="result-pct">{pct}%</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {noPlayers ? (
            <p className="muted stats-search-none">
              No players yet — sign in to record your own stats.
            </p>
          ) : (
            q.length > 0 &&
            suggestions.length === 0 && <p className="muted stats-search-none">No matching players.</p>
          )}
        </div>

        <label className="stats-toggle">
          <input
            type="checkbox"
            checked={showGlobal}
            onChange={(e) => setShowGlobal(e.target.checked)}
          />
          <span className="switch" aria-hidden="true" />
          Global average
        </label>
      </div>
    </section>
  )
}

export default StatsPage
