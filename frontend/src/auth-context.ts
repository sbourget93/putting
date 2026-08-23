/**
 * Auth context, hook, and types — the non-component half of the auth module.
 *
 * Kept separate from the AuthProvider component (auth.tsx) so each file exports
 * only one kind of thing, which is what React Fast Refresh needs to hot-reload
 * cleanly. Components read auth state with `useAuth`; the provider lives in
 * auth.tsx.
 */
import { createContext, useContext } from 'react'

export type User = {
  /** Google's stable per-account id; used as the aggregate id for UserSignedIn. */
  sub: string
  email: string
  name: string
  picture: string | null
}

export type AuthState = {
  /** True once the initial `/auth/me` has resolved (success or failure). */
  ready: boolean
  user: User | null
  isAdmin: boolean
  /** Google OAuth client id, or '' if the backend hasn't been configured. */
  googleClientId: string
  /** Exchange a Google ID token for a backend session. */
  signInWithCredential: (credential: string) => Promise<void>
  signOut: () => Promise<void>
}

export const AuthContext = createContext<AuthState | null>(null)

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>')
  return ctx
}
