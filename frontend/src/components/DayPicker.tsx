/**
 * Date picker for the Daily leaderboard: a trigger button showing the current day,
 * opening a traditional month calendar. Only days that have a completed test are
 * selectable (the caller passes `days`; the page includes today so it is always
 * pickable); every other day is shown but disabled. Today's cell carries the usual
 * today ring, and the selected cell is filled — no other day is specially marked.
 *
 * Month navigation is bounded to the range that actually holds selectable days, so
 * paging never wanders into empty months.
 */
import { useEffect, useRef, useState } from 'react'
import { dayLabel } from '../lib/leaderboard'
import { localDay } from '../lib/putting'
import './DayPicker.css'

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

function Chevron({ dir }: { dir: 'left' | 'right' }) {
  const d = dir === 'left' ? 'M15 5 8 12l7 7' : 'M9 5l7 7-7 7'
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d={d} />
    </svg>
  )
}

const monthKey = (year: number, month: number) => year * 12 + month

export default function DayPicker({
  day,
  days,
  onChange,
}: {
  day: string
  days: string[]
  onChange: (day: string) => void
}) {
  const [open, setOpen] = useState(false)
  // The month shown in the grid, as {year, month} with a 0-based month.
  const [view, setView] = useState(() => {
    const [y, m] = day.split('-').map(Number)
    return { year: y, month: m - 1 }
  })
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  function openCalendar() {
    const [y, m] = day.split('-').map(Number)
    setView({ year: y, month: m - 1 })
    setOpen(true)
  }

  const selectable = new Set(days)
  const today = localDay()

  // The arrows step through selectable days (‹ older, › newer); `days` is newest-first.
  const idx = days.indexOf(day)
  const canNewer = idx > 0
  const canOlder = days.length > 0 && (idx === -1 || idx < days.length - 1)

  // The months that hold a selectable day, so paging stops at the real bounds.
  const viewKey = monthKey(view.year, view.month)
  const sorted = [...days].sort() // ascending YYYY-MM-DD
  const oldest = sorted[0] ?? today
  const newest = sorted[sorted.length - 1] ?? today
  const [oy, om] = oldest.split('-').map(Number)
  const [ny, nm] = newest.split('-').map(Number)
  const canPrev = viewKey > monthKey(oy, om - 1)
  const canNext = viewKey < monthKey(ny, nm - 1)

  function step(delta: number) {
    setView((v) => {
      const next = new Date(v.year, v.month + delta, 1)
      return { year: next.getFullYear(), month: next.getMonth() }
    })
  }

  const firstWeekday = new Date(view.year, view.month, 1).getDay()
  const daysInMonth = new Date(view.year, view.month + 1, 0).getDate()
  // Leading blanks to line the 1st up under its weekday, then each day of the month.
  const cells: (number | null)[] = Array(firstWeekday).fill(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)

  function pick(d: number) {
    onChange(localDay(new Date(view.year, view.month, d)))
    setOpen(false)
  }

  return (
    <div className="day-picker" ref={root}>
      <div className="day-bar">
        <button
          type="button"
          className="day-step"
          aria-label="Previous day"
          disabled={!canOlder}
          onClick={() => onChange(idx === -1 ? days[0] : days[idx + 1])}
        >
          <Chevron dir="left" />
        </button>

        <button
          type="button"
          className="day-trigger"
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => (open ? setOpen(false) : openCalendar())}
        >
          {dayLabel(day)}
        </button>

        <button
          type="button"
          className="day-step"
          aria-label="Next day"
          disabled={!canNewer}
          onClick={() => onChange(days[idx - 1])}
        >
          <Chevron dir="right" />
        </button>
      </div>

      {open && (
        <div className="day-cal" role="dialog" aria-label="Choose a date">
          <div className="cal-head">
            <button type="button" className="cal-nav" aria-label="Previous month" disabled={!canPrev} onClick={() => step(-1)}>
              <Chevron dir="left" />
            </button>
            <span className="cal-month">
              {MONTHS[view.month]} {view.year}
            </span>
            <button type="button" className="cal-nav" aria-label="Next month" disabled={!canNext} onClick={() => step(1)}>
              <Chevron dir="right" />
            </button>
          </div>

          <div className="cal-grid cal-weekdays" aria-hidden="true">
            {WEEKDAYS.map((w, i) => (
              <span key={i} className="cal-weekday">
                {w}
              </span>
            ))}
          </div>

          <div className="cal-grid">
            {cells.map((d, i) => {
              if (d === null) return <span key={`b${i}`} className="cal-blank" />
              const date = localDay(new Date(view.year, view.month, d))
              const classes = ['cal-cell']
              if (date === day) classes.push('selected')
              if (date === today) classes.push('today')
              return (
                <button
                  key={date}
                  type="button"
                  className={classes.join(' ')}
                  disabled={!selectable.has(date)}
                  aria-current={date === today ? 'date' : undefined}
                  aria-pressed={date === day}
                  onClick={() => pick(d)}
                >
                  <span className="cal-num">{d}</span>
                  {date === today && <span className="cal-today-tag">today</span>}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
