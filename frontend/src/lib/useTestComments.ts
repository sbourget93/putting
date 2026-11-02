/**
 * useTestComments — the comments on one daily test, for the leaderboard thread.
 *
 * An online read by design, like the rest of the leaderboard (nothing here is in the
 * device's offline cache). Comments come back in server arrival order from the public
 * GET /api/comments, each carrying its author's public sub / name / picture (no email
 * is ever returned). `reload` refetches after the viewer posts, edits, or deletes a
 * comment, so the thread reflects the write without a full board reload.
 */
import { useCallback, useState } from 'react'
import { fetchWithTimeout } from './http'
import { useResilientFetch } from './useResilientFetch'

export interface TestComment {
  comment_id: string
  /** The author's stable Google sub; compared to the viewer's to show edit/delete. */
  owner_sub: string
  /** The author's current display name, or null if their user row is unknown. */
  name: string | null
  picture: string | null
  body: string
  created_at: string
  /** True once the comment has been changed since it was posted. */
  edited: boolean
}

export interface TestCommentsData {
  comments: TestComment[]
  loading: boolean
  error: string | null
  /** Refetch the thread (call after a successful post / edit / delete). */
  reload: () => void
}

export function useTestComments(testId: string): TestCommentsData {
  const [nonce, setNonce] = useState(0)
  const reload = useCallback(() => setNonce((n) => n + 1), [])

  const { data, loading, error } = useResilientFetch(async () => {
    const res = await fetchWithTimeout(`/api/comments?test_id=${encodeURIComponent(testId)}`)
    if (!res.ok) throw new Error(`Could not load comments (${res.status})`)
    const body = (await res.json()) as { comments: TestComment[] }
    return body.comments
  }, [testId, nonce])

  return { comments: data ?? [], loading, error, reload }
}
