/**
 * AuthProvider — restores and holds app-wide auth state.
 *
 * The backend's signed session cookie is the source of truth and lasts ~10
 * years, so a signed-in device stays signed in effectively forever: on load we
 * call `/auth/me`, and if the cookie is still valid the user comes back without
 * touching Google again. Admin status is whatever the backend reports live from
 * its `sub` allowlist — never decided here.
 *
 * That restore needs the server, though. On a cold boot with the server down,
 * `/auth/me` fails and the viewer would otherwise fall back to a logged-out,
 * read-only day whose baseline is fetched live — the "Failed to fetch" an offline
 * writer hits before their offline (IndexedDB) path ever runs. So we also cache
 * the last known session in localStorage and seed state from it, letting a writer
 * boot straight into the offline path. The cache only unlocks the local UI and
 * write queue; the backend re-gates every write regardless (a revoked role's
 * queued writes are rejected on the next sync and parked in the dead-letter),
 * so a tampered cache grants nothing server-side.
 *
 * Sign-in itself (Google Identity Services) lives in GoogleSignInButton; this
 * provider just exposes `signInWithCredential`, which trades a Google ID token
 * for the backend session, and the resulting user/isAdmin state. The context,
 * hook, and types live in auth-context.ts.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { AuthContext, type Role, type User } from './auth-context'

type MeResponse = { user: User | null; is_admin: boolean; role?: Role }

// The Google client id comes from /api/auth/config, which is unreachable offline.
// It's a stable, non-secret public value, so we cache it in localStorage: this
// keeps the sign-in button (its offline placeholder) visible on an offline start
// instead of vanishing when the config fetch fails.
const CLIENT_ID_KEY = 'auth.googleClientId'

// Last known session, cached so a cold offline boot restores the writer path
// before the network resolves. Only innocuous fields are stored (no email — the
// backend never returns one; see the root AGENTS.md "No Sensitive Data").
const SESSION_KEY = 'auth.session'

type RememberedSession = { user: User | null; isAdmin: boolean; role: Role }

function rememberedClientId(): string {
  try {
    return localStorage.getItem(CLIENT_ID_KEY) ?? ''
  } catch {
    return ''
  }
}

function rememberedSession(): RememberedSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const s = JSON.parse(raw) as RememberedSession
    return { user: s.user ?? null, isAdmin: Boolean(s.isAdmin), role: s.role ?? 'public' }
  } catch {
    return null
  }
}

function rememberSession(session: RememberedSession): void {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session))
  } catch {
    // Private mode / storage disabled: the session just won't survive a cold
    // offline start, same as before.
  }
}

function forgetSession(): void {
  try {
    localStorage.removeItem(SESSION_KEY)
  } catch {
    // Nothing to clean up if storage is unavailable.
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  // Seed from the cached session so a signed-in writer's `canWrite` is true on the
  // first render, before `/auth/me` resolves — a cold offline boot then takes the
  // offline (IndexedDB) path instead of the read-only, server-dependent one. Lazy
  // initializers read localStorage once at mount, not on every render.
  const [user, setUser] = useState<User | null>(() => rememberedSession()?.user ?? null)
  const [isAdmin, setIsAdmin] = useState(() => rememberedSession()?.isAdmin ?? false)
  const [role, setRole] = useState<Role>(() => rememberedSession()?.role ?? 'public')
  const [googleClientId, setGoogleClientId] = useState(rememberedClientId)

  useEffect(() => {
    let cancelled = false
    async function bootstrap() {
      try {
        const [meRes, cfgRes] = await Promise.all([
          fetch('/api/auth/me'),
          fetch('/api/auth/config'),
        ])
        if (!cancelled && meRes.ok) {
          const me = (await meRes.json()) as MeResponse
          setUser(me.user)
          setIsAdmin(Boolean(me.is_admin))
          setRole(me.role ?? 'public')
          // Reconcile the cache with the server's truth: remember a live session,
          // forget it once the server says we're signed out.
          if (me.user) {
            rememberSession({ user: me.user, isAdmin: Boolean(me.is_admin), role: me.role ?? 'public' })
          } else {
            forgetSession()
          }
        }
        if (!cancelled && cfgRes.ok) {
          const cfg = (await cfgRes.json()) as { google_client_id: string }
          const id = cfg.google_client_id ?? ''
          setGoogleClientId(id)
          // Cache it so the next offline start can still show the sign-in button.
          try {
            if (id) localStorage.setItem(CLIENT_ID_KEY, id)
          } catch {
            // Private mode / storage disabled: fall back to per-load config only.
          }
        }
      } catch {
        // Offline or server unreachable: stay logged out for now. A remembered
        // session restores on the next successful /auth/me once back online.
      } finally {
        if (!cancelled) setReady(true)
      }
    }
    void bootstrap()
    return () => {
      cancelled = true
    }
  }, [])

  const signInWithCredential = useCallback(async (credential: string) => {
    const res = await fetch('/api/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential }),
    })
    if (!res.ok) throw new Error(`Sign-in failed (${res.status})`)
    const body = (await res.json()) as MeResponse
    setUser(body.user)
    setIsAdmin(Boolean(body.is_admin))
    setRole(body.role ?? 'public')
    rememberSession({ user: body.user, isAdmin: Boolean(body.is_admin), role: body.role ?? 'public' })
  }, [])

  const signOut = useCallback(async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' })
    } finally {
      // Clear local state regardless; the cookie is gone (or will be re-fetched).
      setUser(null)
      setIsAdmin(false)
      setRole('public')
      forgetSession()
      // Stop Google from silently re-selecting the same account on next sign-in.
      window.google?.accounts.id.disableAutoSelect()
    }
  }, [])

  // A signed-in user may write unless downgraded to the read-only `public` role.
  const canWrite = role !== 'public'

  return (
    <AuthContext.Provider
      value={{ ready, user, isAdmin, role, canWrite, googleClientId, signInWithCredential, signOut }}
    >
      {children}
    </AuthContext.Provider>
  )
}
