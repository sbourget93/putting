/**
 * Role picker dialog for a single user.
 *
 * Laid out like the daily-test batch editor: a small label, the user's name, then
 * the assignable roles as buttons. Tapping one only selects it, and an explicit
 * Save commits the change (the caller posts it), so a misfire is harmless until
 * confirmed. The solid brand fill tracks the working selection while a dashed
 * outline stays on the currently-assigned role, so it's always clear where you
 * started. `admin` is never here — it is the ADMIN_EMAILS overlay, not an
 * assignable role. Closes on Escape or a backdrop tap.
 */
import { useEffect, useState } from 'react'
import type { AdminUser, Role } from '../lib/useAdminUsers'
import './RoleEditModal.css'

const ROLE_OPTIONS: { value: Role; label: string }[] = [
  { value: 'user', label: 'User' },
  { value: 'op', label: 'Op' },
  { value: 'public', label: 'Public' },
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
        className="modal role-edit-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Edit role for ${user.name}`}
        onClick={(e) => e.stopPropagation()}
      >
        <p className="role-label">Edit player</p>
        <p className="role-name">{user.name}</p>
        <div className="role-field">
          <p className="role-field-label">Role</p>
          <div className="role-options">
            {ROLE_OPTIONS.map((o) => {
              const isOriginal = o.value === user.role
              const className = ['role-option']
              if (o.value === selected) className.push('current')
              if (isOriginal) className.push('orig')
              return (
                <button
                  key={o.value}
                  type="button"
                  className={className.join(' ')}
                  aria-pressed={o.value === selected}
                  aria-label={isOriginal ? `${o.label}, current role` : undefined}
                  onClick={() => setSelected(o.value)}
                >
                  {o.label}
                </button>
              )
            })}
          </div>
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
