/**
 * Combobox — a labelled lookahead picker, the same interaction the History page
 * uses to choose a player: the field shows the current selection until focused,
 * then becomes a search that filters the options. Scales past a native pulldown
 * when there are many, and works the same for tables (no avatar) or players (avatar).
 */
import { useRef, useState } from 'react'
import './Combobox.css'

export interface ComboOption {
  id: string
  label: string
  picture?: string | null
}

interface ComboboxProps {
  label: string
  options: ComboOption[]
  value: string | null
  onChange: (id: string) => void
  placeholder?: string
  /** Field text when `value` matches no option (nothing picked yet). */
  emptyText?: string
}

function Combobox({
  label,
  options,
  value,
  onChange,
  placeholder = 'Search…',
  emptyText = '',
}: ComboboxProps) {
  const [search, setSearch] = useState('')
  const [focused, setFocused] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const selectedLabel = options.find((o) => o.id === value)?.label ?? emptyText
  const q = search.trim().toLowerCase()
  const suggestions = q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options

  return (
    <div className="combo">
      <span className="combo-label">{label}</span>
      <div className="combo-field">
        <input
          ref={inputRef}
          type="text"
          className="combo-input"
          value={focused ? search : selectedLabel}
          placeholder={placeholder}
          onChange={(e) => setSearch(e.target.value)}
          onFocus={() => {
            setFocused(true)
            setSearch('')
          }}
          onBlur={() => setFocused(false)}
          aria-label={label}
        />
        {focused && suggestions.length > 0 && (
          <ul className="combo-results">
            {suggestions.map((o) => (
              <li key={o.id}>
                {/* onMouseDown (not onClick) so the pick lands before the input
                    blurs and closes the list. */}
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault()
                    onChange(o.id)
                    setSearch('')
                    setFocused(false)
                    inputRef.current?.blur()
                  }}
                >
                  {o.picture && (
                    <img className="combo-avatar" src={o.picture} alt="" referrerPolicy="no-referrer" />
                  )}
                  <span className="combo-option-label">{o.label}</span>
                  {o.id === value && <span className="combo-current" aria-hidden="true">✓</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
        {focused && q.length > 0 && suggestions.length === 0 && (
          <p className="muted combo-none">No matches.</p>
        )}
      </div>
    </div>
  )
}

export default Combobox
