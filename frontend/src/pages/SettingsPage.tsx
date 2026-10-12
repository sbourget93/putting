/**
 * Settings — the signed-in user's own preferences.
 *
 * One toggle today: "Track misses" (the `track_misses` setting), off by default.
 * Flipping it enqueues a UserSettingChanged through the offline engine, reusing the
 * existing record's id when there is one so a user keeps a single row per setting
 * (see offline/aggregates/userSettings.ts and backend/projections/user_settings.py).
 *
 * Settings are a per-user write, so they need a signed-in writer. A logged-out or
 * read-only visitor sees the page explain that signing in is required, with no toggle.
 */
import { useSync } from '../offline/SyncContext'
import { newEvent } from '../offline/commands'
import { useUserSettings } from '../offline/aggregates/userSettings'
import { useAuth } from '../auth-context'
import { TRACK_MISSES } from '../lib/putting'
import './SettingsPage.css'

function SettingsPage() {
  const { canWrite } = useAuth()
  const { enqueue } = useSync()
  const settings = useUserSettings()

  const trackMissesRow = settings.find((s) => s.name === TRACK_MISSES)
  const trackMisses = trackMissesRow?.value ?? false

  function toggleTrackMisses() {
    // Reuse the existing record's id so the backend upsert updates that row rather
    // than creating a second; a first-ever change mints a new client id.
    const id = trackMissesRow?.user_setting_id ?? crypto.randomUUID()
    enqueue([newEvent('UserSettingChanged', id, { name: TRACK_MISSES, value: !trackMisses })])
  }

  return (
    <section className="page settings">
      <div className="page-head">
        <h1>Settings</h1>
      </div>

      {canWrite ? (
        <div className="panel">
          <label className="setting-row">
            <span className="setting-label">Track misses</span>
            <button
              type="button"
              role="switch"
              aria-checked={trackMisses}
              className={trackMisses ? 'toggle on' : 'toggle'}
              onClick={toggleTrackMisses}
            >
              <span className="toggle-knob" aria-hidden="true" />
            </button>
          </label>
        </div>
      ) : (
        <div className="panel">
          <p className="muted">Sign in to change your settings.</p>
        </div>
      )}
    </section>
  )
}

export default SettingsPage
