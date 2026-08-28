/**
 * useAdminUsers — the role-management page's read model, plus the role write.
 *
 * Lists every known user with their stored role from the op/admin-only
 * GET /api/admin/users (email-free, keyed by the stable Google `sub`). An online
 * read by nature: it spans every user, none of whom are in this device's offline
 * cache, and it is a rare, deliberate admin action rather than an offline one.
 *
 * `changeUserRole` posts to the op-gated POST /api/users/{sub}/role; callers
 * reload the list afterwards so the displayed role reflects the server.
 */
import { useCallback, useEffect, useState } from 'react'
import { fetchWithTimeout } from './http'

/** Roles a user may be assigned. `admin` is the live overlay, never assignable. */
export type Role = 'public' | 'user' | 'op'

export interface AdminUser {
  sub: string
  name: string
  picture: string | null
  role: Role
  /** Allowlisted admin (ADMIN_EMAILS overlay), regardless of the stored `role`. */
  is_admin: boolean
}

export interface AdminUsersData {
  users: AdminUser[]
  loading: boolean
  error: string | null
  reload: () => Promise<void>
}

export function useAdminUsers(): AdminUsersData {
  const [users, setUsers] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetchWithTimeout('/api/admin/users')
      if (!res.ok) throw new Error(`Could not load users (${res.status})`)
      const body = (await res.json()) as { users: AdminUser[] }
      setUsers(body.users)
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  return { users, loading, error, reload }
}

/** Set a user's stored role. Throws on a non-2xx response so the caller can surface it. */
export async function changeUserRole(sub: string, role: Role): Promise<void> {
  const res = await fetchWithTimeout(`/api/users/${encodeURIComponent(sub)}/role`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role }),
  })
  if (!res.ok) throw new Error(`Could not change role (${res.status})`)
}
