/**
 * Reads for the History page's "view anybody" feature.
 *
 * `useUsers` lists the known players for the picker (public GET /api/users, keyed
 * by the stable Google `sub`, never an email). `useUserHistory` fetches one
 * player's full tests and batches online (GET /api/tests, /api/batches, with an
 * optional `?sub=`). `useUserMisses` fetches their miss distribution.
 *
 * These are online reads by design: History is not cached on the device (only
 * Daily Putts is), so it fetches on demand whether you are viewing your own
 * history or someone else's. They go through useResilientFetch, so a blip retries
 * and a failed load heals on reconnect / when the app regains visibility instead
 * of leaving the page blank until a manual reload.
 */
import { fetchWithTimeout } from './http'
import { useResilientFetch } from './useResilientFetch'
import type { AppUser, Batch, MissType, Test } from './putting'

export interface UsersData {
  users: AppUser[]
  loading: boolean
  error: string | null
}

/** Every known player identity, for the "whose history" picker. */
export function useUsers(): UsersData {
  const { data, loading, error } = useResilientFetch<AppUser[]>(async () => {
    const res = await fetchWithTimeout('/api/users')
    if (!res.ok) throw new Error(`Could not load players (${res.status})`)
    const body = (await res.json()) as { users: AppUser[] }
    return body.users
  }, [])

  return { users: data ?? [], loading, error }
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
  const { data, loading, error } = useResilientFetch(async () => {
    const q = sub ? `?sub=${encodeURIComponent(sub)}` : ''
    const [tRes, bRes] = await Promise.all([
      fetchWithTimeout(`/api/tests${q}`),
      fetchWithTimeout(`/api/batches${q}`),
    ])
    if (!tRes.ok) throw new Error(`Could not load tests (${tRes.status})`)
    if (!bRes.ok) throw new Error(`Could not load batches (${bRes.status})`)
    const tBody = (await tRes.json()) as { tests: Test[] }
    const bBody = (await bRes.json()) as {
      batches: Batch[]
      owner_sub: string | null
      owner_name: string | null
    }
    return {
      tests: tBody.tests,
      batches: bBody.batches,
      ownerSub: bBody.owner_sub,
      ownerName: bBody.owner_name,
    }
  }, [sub])

  return {
    tests: data?.tests ?? [],
    batches: data?.batches ?? [],
    ownerSub: data?.ownerSub ?? null,
    ownerName: data?.ownerName ?? null,
    loading,
    error,
  }
}

export interface UserMissesData {
  /** Missed putts per location; a location the player never missed to is absent. */
  counts: Partial<Record<MissType, number>>
  total: number
  loading: boolean
  error: string | null
}

/**
 * One player's missed putts grouped by location (GET /api/misses), fetched online
 * like the rest of the profile. `sub = null` resolves the default owner server-side,
 * matching useUserHistory. The optional scope matches the map to the graph beside it:
 * by default the lifetime distribution over complete tests; `day` (a local
 * YYYY-MM-DD) just that day's test (the Daily leaderboard's per-day map); `average`
 * the same tests the Average board pools.
 */
export function useUserMisses(
  sub: string | null,
  opts?: { day?: string; scope?: 'average' },
): UserMissesData {
  const day = opts?.day
  const scope = opts?.scope
  const { data, loading, error } = useResilientFetch(async () => {
    const params = new URLSearchParams()
    if (sub) params.set('sub', sub)
    if (day) params.set('day', day)
    if (scope) params.set('scope', scope)
    const q = params.toString()
    const res = await fetchWithTimeout(`/api/misses${q ? `?${q}` : ''}`)
    if (!res.ok) throw new Error(`Could not load misses (${res.status})`)
    return (await res.json()) as { counts: Partial<Record<MissType, number>>; total: number }
  }, [sub, day, scope])

  return { counts: data?.counts ?? {}, total: data?.total ?? 0, loading, error }
}
