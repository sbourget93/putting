/**
 * Edit dialog for a history entry.
 *
 * A free batch is fully editable (distance, size, made). A test batch is a fixed
 * slot in the daily test, so only its made count can change; distance and size are
 * shown read-only. Save reports the new field values (the caller turns them into a
 * BatchEdited event); Delete reports a delete. Closes on Escape or a backdrop tap.
 */
import { useEffect, useState } from 'react'
import Stepper from './Stepper'
import { clamp, FREE_MAX, FREE_MIN, type Batch } from '../lib/putting'
import './BatchEditModal.css'

export interface BatchFields {
  distance: number
  batch_size: number
  made: number
}

export default function BatchEditModal({
  batch,
  onClose,
  onSave,
  onDelete,
}: {
  batch: Batch
  onClose: () => void
  onSave: (fields: BatchFields) => void
  onDelete: () => void
}) {
  const isTest = batch.kind === 'test'
  const [distance, setDistance] = useState(batch.distance)
  const [batchSize, setBatchSize] = useState(batch.batch_size)
  const [made, setMade] = useState(batch.made)

  useEffect(() => {
    const onEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onEscape)
    return () => document.removeEventListener('keydown', onEscape)
  }, [onClose])

  function save() {
    onSave({ distance, batch_size: batchSize, made })
    onClose()
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Edit batch"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="modal-title">{isTest ? 'Edit test putt' : 'Edit free putt'}</h2>

        <div className="modal-body">
          {isTest ? (
            <p className="modal-fixed muted">
              Daily test, {distance} ft, {batchSize} putts
            </p>
          ) : (
            <>
              <Stepper label="Distance" value={distance} min={FREE_MIN} max={FREE_MAX} suffix="ft" onChange={setDistance} />
              <Stepper
                label="Batch size"
                value={batchSize}
                min={1}
                max={50}
                onChange={(n) => {
                  setBatchSize(n)
                  setMade((m) => clamp(m, 0, n))
                }}
              />
            </>
          )}
          <Stepper label="Made" value={made} min={0} max={batchSize} onChange={setMade} />
        </div>

        <div className="modal-actions">
          <button type="button" className="btn danger-link" onClick={onDelete}>
            Delete
          </button>
          <span className="modal-actions-right">
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" onClick={save}>
              Save
            </button>
          </span>
        </div>
      </div>
    </div>
  )
}
