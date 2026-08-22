/**
 * A labelled −/＋ number stepper with 44px touch targets.
 *
 * Shared by the Free Putt form and the history edit dialog. Values are clamped to
 * [min, max] and the buttons disable at the bounds.
 */
import { clamp } from '../lib/putting'
import './Stepper.css'

export default function Stepper({
  label,
  value,
  min,
  max,
  suffix,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  suffix?: string
  onChange: (next: number) => void
}) {
  return (
    <div className="stepper">
      <span className="stepper-label">{label}</span>
      <div className="stepper-controls">
        <button
          type="button"
          className="step-btn"
          aria-label={`Decrease ${label}`}
          disabled={value <= min}
          onClick={() => onChange(clamp(value - 1, min, max))}
        >
          −
        </button>
        <span className="stepper-value">
          {value}
          {suffix && <span className="stepper-suffix">{suffix}</span>}
        </span>
        <button
          type="button"
          className="step-btn"
          aria-label={`Increase ${label}`}
          disabled={value >= max}
          onClick={() => onChange(clamp(value + 1, min, max))}
        >
          ＋
        </button>
      </div>
    </div>
  )
}
