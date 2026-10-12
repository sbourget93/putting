/**
 * The daily prompt for a user who tracks misses.
 *
 * Instead of the 0–5 count buttons, every putt starts made (a green check); you
 * only touch the ones you missed. Tapping a slot opens the MissPicker to say where
 * it missed, which turns that slot red and shows the direction. "I made N putts!"
 * then records the batch, N tracking the slots still made.
 *
 * This owns only the in-progress slots; it hands the finished putts up through
 * onRecord and never writes itself. The parent remounts it per distance (keyed on
 * the distance), so each distance starts from a clean five-made slate.
 */
import { useState } from 'react'
import PuttSlots, { type PuttSlot } from './PuttSlots'
import { TEST_PUTTS, type MissType } from '../lib/putting'
import './MissPrompt.css'

const ALL_MADE: PuttSlot[] = Array.from({ length: TEST_PUTTS }, () => ({ made: true, miss: null }))

export default function MissPrompt({
  distance,
  disabled = false,
  onRecord,
}: {
  distance: number
  disabled?: boolean
  onRecord: (putts: { made: boolean; miss_type: MissType | null }[]) => void
}) {
  const [slots, setSlots] = useState<PuttSlot[]>(ALL_MADE)

  const madeCount = slots.filter((s) => s.made).length

  function submit() {
    onRecord(slots.map((s) => ({ made: s.made, miss_type: s.made ? null : s.miss })))
  }

  return (
    <>
      <PuttSlots
        slots={slots}
        distance={distance}
        disabled={disabled}
        onChange={(i, slot) => setSlots((prev) => prev.map((s, j) => (j === i ? slot : s)))}
      />
      <button
        type="button"
        className="btn btn-primary record-btn"
        disabled={disabled}
        onClick={submit}
      >
        I made {madeCount} {madeCount === 1 ? 'putt' : 'putts'}!
      </button>
    </>
  )
}
