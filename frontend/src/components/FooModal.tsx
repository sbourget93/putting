/**
 * Template-only add/edit dialog for the demo `foo` aggregate.
 *
 * Seeded from `initial` when editing, empty when adding. Closes on submit,
 * Cancel, Escape, or a backdrop tap. It reports the submitted field values and
 * nothing else — deciding which events that implies is the caller's job (see
 * TemplateTestPage), which keeps the form ignorant of the event vocabulary.
 *
 * Delete alongside TemplateTestPage and backend/projections/foo.py.
 */
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import './FooModal.css'

export type FooFields = {
  public_value: string
  private_value: string
}

function FooModal({
  initial,
  onClose,
  onSubmit,
}: {
  initial?: FooFields
  onClose: () => void
  onSubmit: (fields: FooFields) => void
}) {
  const editing = initial != null
  const [publicValue, setPublicValue] = useState(initial?.public_value ?? '')
  const [privateValue, setPrivateValue] = useState(initial?.private_value ?? '')

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const public_value = publicValue.trim()
    // The backend rejects a blank public value too; stopping here just avoids a
    // pointless round trip.
    if (!public_value) return
    onSubmit({ public_value, private_value: privateValue.trim() })
    onClose()
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={editing ? 'Edit foo' : 'Add foo'}
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="modal-title">{editing ? 'Edit foo' : 'Add foo'}</h2>
        <form className="modal-form" onSubmit={handleSubmit}>
          <label className="field">
            <span>Public value</span>
            <input
              autoFocus
              value={publicValue}
              onChange={(event) => setPublicValue(event.target.value)}
            />
          </label>
          <label className="field">
            <span>Private value (optional)</span>
            <input
              value={privateValue}
              onChange={(event) => setPrivateValue(event.target.value)}
            />
          </label>
          <div className="modal-actions">
            <button type="button" className="secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit">{editing ? 'Save' : 'Add'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default FooModal
