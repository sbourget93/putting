/**
 * Template-only page: a place to exercise the template's plumbing end to end.
 *
 * It is reachable only while `.is_template` exists at the repo root, so a fork
 * drops both this route and its drawer link (see `IS_TEMPLATE` in ../config).
 * The file is intentionally left in forks as a worked example — delete it once
 * the app has pages of its own.
 *
 * Two data paths, by role, which is the whole demo:
 *  - Admins go through the offline sync engine (../offline). Reads are the server
 *    projection snapshot with pending writes folded on top (useFoos); writes
 *    enqueue optimistically and sync in the background — so add/edit/delete work
 *    offline and reconcile when online. SyncMenu shows connection/queue state.
 *  - Non-admins have no offline engine (the data layer is admin-only), so they
 *    read the gated `/foos` query online and see public values only. Write
 *    controls are hidden (and the backend rejects writes anyway).
 *
 * Deleting the demo `foo` aggregate means deleting this page too (and its
 * descriptor in ../offline/aggregates/foo.ts and backend/projections/foo.py).
 */
import { useCallback, useEffect, useState } from 'react'
import FooModal, { type FooFields } from '../components/FooModal'
import { useAuth } from '../auth-context'
import { useSync } from '../offline/SyncContext'
import { useFoos, type Foo } from '../offline/aggregates/foo'
import { newEvent } from '../offline/commands'
import type { CommandEvent } from '../offline/types'
import './TemplateTestPage.css'

function TemplateTestPage() {
  const { isAdmin } = useAuth()
  const { enqueue } = useSync()

  // Admin read path: the cached server snapshot + pending writes, kept live by
  // the sync engine.
  const adminFoos = useFoos()

  // Non-admin read path: the online public query. Never fetched for admins, who
  // get richer, offline-capable data from the engine above.
  const [onlineFoos, setOnlineFoos] = useState<Foo[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (isAdmin) return
    let cancelled = false
    void (async () => {
      try {
        const response = await fetch('/api/foos')
        if (!response.ok) throw new Error(`Could not load foos (${response.status})`)
        const body = (await response.json()) as {
          foos: { foo_id: string; public_value: string }[]
        }
        if (!cancelled) {
          setOnlineFoos(body.foos.map((f) => ({ ...f, private_value: '' })))
          setError(null)
        }
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [isAdmin])

  const foos = isAdmin ? adminFoos : onlineFoos

  const [adding, setAdding] = useState(false)
  // When set, the edit dialog is open for this foo.
  const [editingFoo, setEditingFoo] = useState<Foo | null>(null)

  // All writes enqueue through the engine, never straight to the server: that is
  // what lets them be composed offline and sync later. These controls render for
  // admins only.
  const submit = useCallback((events: CommandEvent[]) => enqueue(events), [enqueue])

  function handleCreate(fields: FooFields) {
    // IDs are generated on the client, never by the server — the precondition for
    // an offline write.
    submit([newEvent('FooCreated', crypto.randomUUID(), { ...fields })])
  }

  function handleEdit(foo: Foo, fields: FooFields) {
    // One narrow event per field that actually changed. Emitting a wide
    // "FooEdited" instead would make a concurrent edit of the other field silently
    // revert under last-write-wins.
    const events: CommandEvent[] = []
    if (fields.public_value !== foo.public_value) {
      events.push(newEvent('FooPublicValueChanged', foo.foo_id, { public_value: fields.public_value }))
    }
    if (fields.private_value !== foo.private_value) {
      events.push(
        newEvent('FooPrivateValueChanged', foo.foo_id, { private_value: fields.private_value }),
      )
    }
    if (events.length === 0) return
    submit(events)
  }

  function handleDelete(foo: Foo) {
    if (!window.confirm(`Delete ${foo.public_value}?`)) return
    submit([newEvent('FooDeleted', foo.foo_id)])
  }

  return (
    <section className="template-test">
      <div className="foo-header">
        <h1>Foos</h1>
        {isAdmin && (
          <button
            type="button"
            className="add-btn"
            aria-label="Add foo"
            title="Add foo"
            onClick={() => setAdding(true)}
          >
            +
          </button>
        )}
      </div>

      {error && (
        <p className="foo-error" role="alert">
          {error}
        </p>
      )}

      {foos.length === 0 ? (
        <p className="foo-empty">No foos yet.</p>
      ) : (
        <div className="foo-panel">
          <ul className="foo-list">
            {foos.map((foo) => (
              <li className="foo-entry" key={foo.foo_id}>
                <div className="foo-row">
                  <span className="foo-values">
                    <span className="foo-public">{foo.public_value}</span>
                    {isAdmin && (
                      <span className="foo-private">private: {foo.private_value || '—'}</span>
                    )}
                  </span>
                  {isAdmin && (
                    <span className="foo-actions">
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label={`Edit ${foo.public_value}`}
                        title="Edit"
                        onClick={() => setEditingFoo(foo)}
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                          <path d="M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3z" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label={`Delete ${foo.public_value}`}
                        title="Delete"
                        onClick={() => handleDelete(foo)}
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                          <path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" />
                        </svg>
                      </button>
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {adding && <FooModal onClose={() => setAdding(false)} onSubmit={handleCreate} />}
      {editingFoo && (
        <FooModal
          initial={{
            public_value: editingFoo.public_value,
            private_value: editingFoo.private_value,
          }}
          onClose={() => setEditingFoo(null)}
          onSubmit={(fields) => handleEdit(editingFoo, fields)}
        />
      )}
    </section>
  )
}

export default TemplateTestPage
