/**
 * Role picker dialog for a single user.
 *
 * Names the user and shows the assignable roles as buttons; tapping one only
 * selects it, and an explicit Save commits the change (the caller posts it), so a
 * misfire is harmless until confirmed. `admin` is never here — it is the
 * ADMIN_EMAILS overlay, not an assignable role. Closes on Escape or a backdrop tap.
 */
import { useEffect, useState } from 'react'
import type { AdminUser, Role } from '../lib/useAdminUsers'
import './RoleEditModal.css'

const ROLE_OPTIONS: { value: Role; label: string; hint: string }[] = [
  { value: 'user', label: 'User', hint: 'Can log putts' },
  { value: 'op', label: 'Op', hint: 'Can manage roles' },
  { value: 'public', label: 'Public', hint: 'Read-only' },
]

export default function RoleEditModal({
  user,
  onClose,
  onPick,
}: {
  user: AdminUser
  onClose: () => void
  onPick: (role: Role) => void
}) {
  const [selected, setSelected] = useState<Role>(user.role)

  useEffect(() => {
    const onEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onEscape)
    return () => document.removeEventListener('keydown', onEscape)
  }, [onClose])

  function save() {
    if (selected !== user.role) onPick(selected)
    onClose()
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Edit role for ${user.name}`}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="modal-title">{user.name} — role</h2>
        <div className="role-options">
          {ROLE_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              className={o.value === selected ? 'role-option current' : 'role-option'}
              aria-pressed={o.value === selected}
              onClick={() => setSelected(o.value)}
            >
              <span className="role-option-label">{o.label}</span>
              <span className="role-option-hint">{o.hint}</span>
            </button>
          ))}
        </div>
        <div className="role-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={selected === user.role}
            onClick={save}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
