/**
 * Reads for the History page's "view anybody" feature.
 *
 * `useUsers` lists the known players for the picker (public GET /api/users, keyed
 * by the stable Google `sub`, never an email). `useUserHistory` fetches one
 * player's full tests and batches online (GET /api/tests, /api/batches, with an
 * optional `?sub=`).
 *
 * These are online reads by design: History is not cached on the device (only
 * Daily Putts is), so it fetches on demand whether you are viewing your own
 * history or someone else's.
 */
import { useEffect, useState } from 'react'
import type { AppUser, Batch, Test } from './putting'

export interface UsersData {
  users: AppUser[]
  loading: boolean
  error: string | null
}

/** Every known player identity, for the "whose history" picker. */
export function useUsers(): UsersData {
  const [users, setUsers] = useState<AppUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void (async () => {
      try {
        const res = await fetch('/api/users')
        if (!res.ok) throw new Error(`Could not load players (${res.status})`)
        const body = (await res.json()) as { users: AppUser[] }
        if (!cancelled) {
          setUsers(body.users)
          setError(null)
        }
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return { users, loading, error }
}

export interface UserHistoryData {
  tests: Test[]
  batches: Batch[]
  /** Whose data this is — the resolved player's public sub and display name. */
  ownerSub: string | null
  ownerName: string | null
  loading: boolean
  error: string | null
}

/**
 * One player's full tests and batches, fetched online (History is not cached on
 * the device). `sub = null` fetches the default owner — your own if you are an
 * admin, else the demo owner — so History can default to whoever is viewing.
 */
export function useUserHistory(sub: string | null): UserHistoryData {
  const [data, setData] = useState<{
    tests: Test[]
    batches: Batch[]
    ownerSub: string | null
    ownerName: string | null
  }>({ tests: [], batches: [], ownerSub: null, ownerName: null })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const q = sub ? `?sub=${encodeURIComponent(sub)}` : ''
    void (async () => {
      try {
        const [tRes, bRes] = await Promise.all([
          fetch(`/api/tests${q}`),
          fetch(`/api/batches${q}`),
        ])
        if (!tRes.ok) throw new Error(`Could not load tests (${tRes.status})`)
        if (!bRes.ok) throw new Error(`Could not load batches (${bRes.status})`)
        const tBody = (await tRes.json()) as { tests: Test[] }
        const bBody = (await bRes.json()) as {
          batches: Batch[]
          owner_sub: string | null
          owner_name: string | null
        }
        if (!cancelled) {
          setData({
            tests: tBody.tests,
            batches: bBody.batches,
            ownerSub: bBody.owner_sub,
            ownerName: bBody.owner_name,
          })
          setError(null)
        }
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [sub])

  return { ...data, loading, error }
}
