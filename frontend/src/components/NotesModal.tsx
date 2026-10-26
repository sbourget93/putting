/**
 * Player notes: a full-height editor for the free-form notes a player keeps to
 * reference on future days (something they figured out, something to try next time).
 *
 * Opened from the Daily Putts header. A large textarea fills the sheet so there's
 * room to read and write at length. Editing is local to the dialog until an explicit
 * Save commits it (Save stays disabled while unchanged), so referencing the notes and
 * backing out leaves them untouched. The header's close button, Escape, and a backdrop
 * tap all dismiss without saving — the same discard-on-cancel flow as the other
 * daily-test modals.
 *
 * `onSave` hands the edited text back to the caller, which persists it through the
 * user_data aggregate (key `notes`).
 */
import { useEffect, useState } from 'react'
import './NotesModal.css'

export default function NotesModal({
  notes,
  onSave,
  onClose,
}: {
  notes: string
  onSave: (next: string) => void
  onClose: () => void
}) {
  const [draft, setDraft] = useState(notes)

  useEffect(() => {
    const onEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onEscape)
    return () => document.removeEventListener('keydown', onEscape)
  }, [onClose])

  function save() {
    onSave(draft)
    onClose()
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal notes-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Notes"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="notes-modal-head">
          <div className="notes-modal-title">
            <h2>Notes</h2>
            <p className="notes-modal-privacy">private notes for future reference</p>
          </div>
          <button
            type="button"
            className="notes-modal-close"
            aria-label="Close notes"
            onClick={onClose}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
            </svg>
          </button>
        </div>
        <textarea
          className="notes-textarea"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={
            'fill this out with things you want to remember to focus on when putting\n\n' +
            'e.g.\n\n' +
            "- don't forget to use your legs\n" +
            '- keep a loose grip\n' +
            '- follow through towards the basket\n' +
            '- etc.'
          }
        />
        <div className="notes-modal-actions">
          <button
            type="button"
            className="btn btn-primary"
            disabled={draft === notes}
            onClick={save}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
