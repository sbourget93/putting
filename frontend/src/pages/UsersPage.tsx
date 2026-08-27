/**
 * Users — the admin role-management page.
 *
 * Lists every known user with a search box that filters by name as you type, and
 * lets an admin change a user's stored role (public / user / op) via a pencil that
 * opens a role picker, mirroring the daily-test edit flow. Admin itself is the
 * ADMIN_EMAILS overlay, not an assignable role, so allowlisted accounts show a
 * fixed "Admin" badge instead of a pencil. Gated to admins here; the backend
 * re-gates every read and write.
 */
import { useMemo, useState } from 'react'
import { useAuth } from '../auth-context'
import { useAdminUsers, changeUserRole, type AdminUser, type Role } from '../lib/useAdminUsers'
import RoleEditModal from '../components/RoleEditModal'
import './UsersPage.css'

const ROLE_LABELS: Record<Role, string> = {
  user: 'User',
  op: 'Op',
  public: 'Public',
}

function UsersPage() {
  const { ready, isAdmin } = useAuth()
  const { users, loading, error, reload } = useAdminUsers()
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<AdminUser | null>(null)
  const [changeError, setChangeError] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return users
    return users.filter((u) => u.name.toLowerCase().includes(q))
  }, [users, query])

  if (!ready) return <section className="page"><p className="muted">Loading…</p></section>
  if (!isAdmin) {
    return (
      <section className="page">
        <div className="page-head"><h1>Users</h1></div>
        <div className="panel"><p className="muted">Admins only.</p></div>
      </section>
    )
  }

  async function saveRole(sub: string, role: Role) {
    setChangeError(null)
    try {
      await changeUserRole(sub, role)
      await reload()
    } catch (cause) {
      setChangeError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  return (
    <section className="page users">
      <div className="page-head"><h1>Users</h1></div>

      <input
        type="search"
        className="user-search"
        placeholder="Search users…"
        aria-label="Search users by name"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {error && <p className="error" role="alert">{error}</p>}
      {changeError && <p className="error" role="alert">{changeError}</p>}

      {loading ? (
        <p className="muted">Loading…</p>
      ) : filtered.length === 0 ? (
        <div className="panel">
          <p className="muted">{query ? 'No users match your search.' : 'No users yet.'}</p>
        </div>
      ) : (
        <ul className="user-list">
          {filtered.map((u) => (
            <li key={u.sub} className="user-row">
              <span className="user-name">{u.name}</span>
              {u.is_admin ? (
                <span className="user-badge">Admin</span>
              ) : (
                <>
                  <span className="user-role-tag">{ROLE_LABELS[u.role]}</span>
                  <button
                    type="button"
                    className="user-edit-btn"
                    aria-label={`Edit role for ${u.name}`}
                    onClick={() => setEditing(u)}
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                      <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" />
                    </svg>
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <RoleEditModal
          user={editing}
          onClose={() => setEditing(null)}
          onPick={(role) => void saveRole(editing.sub, role)}
        />
      )}
    </section>
  )
}

export default UsersPage
