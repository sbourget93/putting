/**
 * A horizontally scrollable row of number chips.
 *
 * Two modes. In 'select' mode one chip is the current value (highlighted), tapping
 * another selects it, and the selected chip is scrolled to center. In 'action'
 * mode there is no persistent selection; tapping a chip fires onSelect once (used
 * for the "how many did you make?" row, where a tap records immediately).
 *
 * Far better than +/- steppers on a phone: the whole range is one thumb-swipe and
 * one tap away.
 */
import { useEffect, useRef } from 'react'
import './NumberStrip.css'

export default function NumberStrip({
  values,
  selected,
  onSelect,
  suffix,
  ariaLabel,
  mode = 'select',
}: {
  values: number[]
  selected?: number
  onSelect: (value: number) => void
  suffix?: string
  ariaLabel: string
  mode?: 'select' | 'action'
}) {
  const scroller = useRef<HTMLDivElement>(null)
  const selectedChip = useRef<HTMLButtonElement>(null)

  // Center the selected chip. Set scrollLeft directly (not scrollIntoView) so we
  // never nudge the page's own vertical scroll.
  useEffect(() => {
    const c = scroller.current
    const chip = selectedChip.current
    if (!c || !chip) return
    c.scrollLeft = chip.offsetLeft - c.clientWidth / 2 + chip.clientWidth / 2
  }, [selected])

  return (
    <div className="number-strip" role="group" aria-label={ariaLabel} ref={scroller}>
      {values.map((value) => {
        const isSelected = mode === 'select' && value === selected
        return (
          <button
            key={value}
            ref={isSelected ? selectedChip : undefined}
            type="button"
            className={isSelected ? 'strip-chip selected' : 'strip-chip'}
            aria-pressed={mode === 'select' ? isSelected : undefined}
            onClick={() => onSelect(value)}
          >
            {value}
            {suffix && <span className="strip-suffix">{suffix}</span>}
          </button>
        )
      })}
    </div>
  )
}
