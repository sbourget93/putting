/**
 * The comment thread for one daily test, shown in the Comments view of a leaderboard
 * row (see ToggleChartPanel). Anyone can read it; a signed-in writer can post, and
 * can edit or delete their own comments (ownership is re-checked server-side, so the
 * controls are a convenience, not the gate).
 *
 * Comments come back in server arrival order from useTestComments. Writes go straight
 * to POST /commands (online), matching the leaderboard, which is online-only and not
 * part of the offline cache. After a write we reload the thread so it reflects the
 * change; the collapsed row's count badge catches up on the next board load.
 */
import { useState } from 'react'
import { useAuth } from '../auth-context'
import { useTestComments, type TestComment } from '../lib/useTestComments'
import { newEvent, postCommands } from '../offline/commands'
import './TestComments.css'

const BODY_MAX_LENGTH = 1000

export default function TestComments({ testId }: { testId: string }) {
  const { user, canWrite } = useAuth()
  const { comments, loading, error, reload } = useTestComments(testId)

  const [draft, setDraft] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [writeError, setWriteError] = useState<string | null>(null)

  async function submit(events: ReturnType<typeof newEvent>[], after: () => void) {
    setBusy(true)
    setWriteError(null)
    try {
      await postCommands(events)
      after()
      reload()
    } catch {
      setWriteError('Could not save. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  function post() {
    const body = draft.trim()
    if (!body) return
    void submit([newEvent('TestCommentAdded', crypto.randomUUID(), { test_id: testId, body })], () =>
      setDraft(''),
    )
  }

  function saveEdit(comment: TestComment) {
    const body = editDraft.trim()
    if (!body) return
    void submit([newEvent('TestCommentEdited', comment.comment_id, { body })], () =>
      setEditingId(null),
    )
  }

  function remove(comment: TestComment) {
    void submit([newEvent('TestCommentDeleted', comment.comment_id, {})], () => {})
  }

  return (
    <div className="test-comments">
      {error ? (
        <p className="test-comments-note error" role="alert">
          {error}
        </p>
      ) : loading ? (
        <p className="test-comments-note muted">Loading…</p>
      ) : comments.length === 0 ? (
        <p className="test-comments-note muted">No comments yet.</p>
      ) : (
        <ul className="comment-list">
          {comments.map((c) => {
            const mine = canWrite && user?.sub === c.owner_sub
            const isEditing = editingId === c.comment_id
            return (
              <li key={c.comment_id} className="comment">
                {c.picture && (
                  <img className="comment-avatar" src={c.picture} alt="" referrerPolicy="no-referrer" />
                )}
                <div className="comment-body">
                  <div className="comment-head">
                    <span className="comment-name">{c.name ?? 'Player'}</span>
                    {c.edited && <span className="comment-edited">edited</span>}
                  </div>
                  {isEditing ? (
                    <div className="comment-compose">
                      <textarea
                        className="comment-input"
                        value={editDraft}
                        maxLength={BODY_MAX_LENGTH}
                        rows={3}
                        onChange={(e) => setEditDraft(e.target.value)}
                        disabled={busy}
                      />
                      <div className="comment-compose-foot">
                        <span className="comment-count">
                          {editDraft.length}/{BODY_MAX_LENGTH}
                        </span>
                        <span className="comment-actions">
                          <button
                            type="button"
                            className="comment-btn"
                            onClick={() => setEditingId(null)}
                            disabled={busy}
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            className="comment-btn primary"
                            onClick={() => saveEdit(c)}
                            disabled={busy || !editDraft.trim()}
                          >
                            Save
                          </button>
                        </span>
                      </div>
                    </div>
                  ) : (
                    <>
                      <p className="comment-text">{c.body}</p>
                      {mine && (
                        <span className="comment-actions">
                          <button
                            type="button"
                            className="comment-btn"
                            onClick={() => {
                              setEditingId(c.comment_id)
                              setEditDraft(c.body)
                              setWriteError(null)
                            }}
                            disabled={busy}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="comment-btn"
                            onClick={() => remove(c)}
                            disabled={busy}
                          >
                            Delete
                          </button>
                        </span>
                      )}
                    </>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {writeError && (
        <p className="test-comments-note error" role="alert">
          {writeError}
        </p>
      )}

      {canWrite ? (
        <div className="comment-compose comment-new">
          <textarea
            className="comment-input"
            value={draft}
            maxLength={BODY_MAX_LENGTH}
            rows={3}
            placeholder="Add a comment…"
            onChange={(e) => setDraft(e.target.value)}
            disabled={busy}
          />
          <div className="comment-compose-foot">
            <span className="comment-count">
              {draft.length}/{BODY_MAX_LENGTH}
            </span>
            <button
              type="button"
              className="comment-btn primary"
              onClick={post}
              disabled={busy || !draft.trim()}
            >
              Post
            </button>
          </div>
        </div>
      ) : (
        <p className="test-comments-note muted">Sign in to comment.</p>
      )}
    </div>
  )
}
