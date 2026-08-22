/**
 * History — every batch, newest first, free and test alike.
 *
 * Each entry is a single compact row: a kind badge (Test / Free), when it was
 * recorded, and the result. Admins tap a row to edit or delete it (BatchEdited /
 * BatchDeleted, through the sync engine); non-admins see the demo owner's history
 * read-only.
 */
import { useMemo, useState } from 'react'
import { useSync } from '../offline/SyncContext'
import { newEvent } from '../offline/commands'
import { usePuttingData } from '../lib/usePuttingData'
import BatchEditModal, { type BatchFields } from '../components/BatchEditModal'
import type { Batch } from '../lib/putting'
import './HistoryPage.css'

function pct(made: number, size: number): number {
  return size ? Math.round((100 * made) / size) : 0
}

function formatWhen(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return (
    d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
    ', ' +
    d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  )
}

function HistoryPage() {
  const { enqueue } = useSync()
  const { batches, readOnly, loading, error } = usePuttingData()
  const [editing, setEditing] = useState<Batch | null>(null)

  const ordered = useMemo(
    () => [...batches].sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [batches],
  )

  function handleSave(batch: Batch, fields: BatchFields) {
    enqueue([
      newEvent('BatchEdited', batch.batch_id, {
        distance: fields.distance,
        batch_size: fields.batch_size,
        made: fields.made,
      }),
    ])
  }

  function handleDelete(batch: Batch) {
    if (!window.confirm(`Delete this ${batch.made}/${batch.batch_size} from ${batch.distance} ft?`)) return
    enqueue([newEvent('BatchDeleted', batch.batch_id)])
    setEditing(null)
  }

  if (loading) return <section className="page"><p className="muted">Loading…</p></section>

  return (
    <section className="page history">
      <div className="page-head">
        <h1>History</h1>
      </div>

      {error && <p className="error" role="alert">{error}</p>}

      {ordered.length === 0 ? (
        <div className="panel"><p className="muted">No putts recorded yet.</p></div>
      ) : (
        <ul className="history-list">
          {ordered.map((b) => {
            const isTest = b.kind === 'test'
            return (
              <li
                key={b.batch_id}
                className="history-row"
                onClick={readOnly ? undefined : () => setEditing(b)}
                role={readOnly ? undefined : 'button'}
                tabIndex={readOnly ? undefined : 0}
                onKeyDown={
                  readOnly
                    ? undefined
                    : (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          setEditing(b)
                        }
                      }
                }
              >
                <span className={isTest ? 'kind-badge test' : 'kind-badge free'}>
                  {isTest ? 'Test' : 'Free'}
                </span>
                <span className="row-when muted">{formatWhen(b.created_at)}</span>
                <span className="row-stats">
                  <span className="row-distance">{b.distance}′</span>
                  <span className="row-made">{b.made}/{b.batch_size}</span>
                  <span className="row-pct">{pct(b.made, b.batch_size)}%</span>
                </span>
              </li>
            )
          })}
        </ul>
      )}

      {editing && (
        <BatchEditModal
          batch={editing}
          onClose={() => setEditing(null)}
          onSave={(fields) => handleSave(editing, fields)}
          onDelete={() => handleDelete(editing)}
        />
      )}
    </section>
  )
}

export default HistoryPage
