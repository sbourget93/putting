/**
 * Admin sync indicator: an envelope in the app bar that badges the number of
 * unsynced (queued) events, and flags the dead-letter list in red when the
 * server has permanently rejected a batch. Tapping it opens a panel whose only
 * job is to review those failed batches — re-apply or dismiss them.
 *
 * Syncing itself is fully automatic (on write, on reconnect, on a retry timer),
 * so there are no manual pause / sync-now controls. Renders nothing without an
 * enabled engine (non-admins never write, so they have nothing to sync).
 */
import { useState } from 'react'
import { useSync } from './SyncContext'
import './SyncMenu.css'

export default function SyncMenu() {
  const { enabled, syncStatus, pendingCount, deadLetter, retryDeadLetter, dismissDeadLetter, describe } =
    useSync()
  const [open, setOpen] = useState(false)
  if (!enabled) return null

  const hasFailures = deadLetter.length > 0
  const statusLabel =
    syncStatus === 'syncing'
      ? 'Syncing…'
      : syncStatus === 'offline'
        ? 'Offline — will retry'
        : 'Up to date'

  return (
    <div className="sync-menu">
      <button
        type="button"
        className="sync-envelope"
        aria-label={`Sync status${pendingCount > 0 ? `, ${pendingCount} unsynced` : ''}`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
          <path
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinejoin="round"
            d="M3 6h18v12H3z M3 7l9 6 9-6"
          />
        </svg>
        {pendingCount > 0 && <span className="sync-badge">{pendingCount}</span>}
        {hasFailures && <span className="sync-badge sync-badge--alert">{deadLetter.length}</span>}
      </button>

      {open && (
        <>
          <div className="sync-panel-backdrop" onClick={() => setOpen(false)} />
          <div className="sync-panel" role="dialog" aria-label="Sync">
            <div className="sync-panel-status">
              <span className={`sync-dot sync-dot--${syncStatus}`} aria-hidden="true" />
              <span>{statusLabel}</span>
              <span className="sync-panel-pending">{pendingCount} queued</span>
            </div>

            {hasFailures && (
              <div className="sync-deadletter">
                <div className="sync-deadletter-title">Couldn’t sync — refreshed from server</div>
                {deadLetter.map((entry) => (
                  <div key={entry.id} className="sync-deadletter-entry">
                    <div className="sync-deadletter-events">
                      {entry.events.map((ev) => (
                        <div key={ev.event_id} className="sync-deadletter-event">
                          {describe(ev)}
                        </div>
                      ))}
                    </div>
                    <div className="sync-deadletter-meta">Rejected{entry.detail ? ` · ${entry.detail}` : ''}</div>
                    <div className="sync-panel-actions">
                      <button type="button" onClick={() => retryDeadLetter(entry.id)}>
                        Re-apply
                      </button>
                      <button
                        type="button"
                        className="sync-dismiss"
                        onClick={() => dismissDeadLetter(entry.id)}
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
