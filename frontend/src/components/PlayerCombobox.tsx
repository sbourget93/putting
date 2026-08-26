/**
 * A lookahead combobox for choosing one player from a list.
 *
 * The input shows the chosen player's name until focused, then becomes a name
 * search over the given users. Picking one (or clearing) reports the new value and
 * releases focus, so the next click reopens the search cleanly. `exclude` hides a
 * player already chosen elsewhere (e.g. the other side of a comparison).
 */
import { useRef, useState } from 'react'
import type { AppUser } from '../lib/putting'
import './PlayerCombobox.css'

export default function PlayerCombobox({
  users,
  value,
  onChange,
  exclude,
  label,
  placeholder = 'Search players…',
}: {
  users: AppUser[]
  value: string | null
  onChange: (sub: string | null) => void
  exclude?: string | null
  label: string
  placeholder?: string
}) {
  const [search, setSearch] = useState('')
  const [focused, setFocused] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  const selectedName = users.find((u) => u.sub === value)?.name ?? ''
  const q = search.trim().toLowerCase()
  const candidates = users
    .filter((u) => u.sub !== exclude)
    .filter((u) => (q ? u.name.toLowerCase().includes(q) : true))

  return (
    <div className="player-combobox">
      <span className="player-combobox-label">{label}</span>
      <div className="player-combobox-field">
        <input
          ref={input}
          type="text"
          className="player-combobox-input"
          value={focused ? search : selectedName}
          placeholder={placeholder}
          onChange={(e) => setSearch(e.target.value)}
          onFocus={() => {
            setFocused(true)
            setSearch('')
          }}
          onBlur={() => setFocused(false)}
          aria-label={label}
        />
        {value && !focused && (
          <button
            type="button"
            className="player-combobox-clear"
            aria-label={`Clear ${label}`}
            // onMouseDown so the clear lands before the input blurs.
            onMouseDown={(e) => {
              e.preventDefault()
              onChange(null)
            }}
          >
            ×
          </button>
        )}
        {focused && candidates.length > 0 && (
          <ul className="player-combobox-results">
            {candidates.map((u) => (
              <li key={u.sub}>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault()
                    onChange(u.sub)
                    setSearch('')
                    setFocused(false)
                    input.current?.blur()
                  }}
                >
                  {u.picture && (
                    <img className="result-avatar" src={u.picture} alt="" referrerPolicy="no-referrer" />
                  )}
                  <span className="result-name">{u.name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {focused && q.length > 0 && candidates.length === 0 && (
          <p className="muted player-combobox-none">No matching players.</p>
        )}
      </div>
    </div>
  )
}
