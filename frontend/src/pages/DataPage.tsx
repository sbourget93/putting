/**
 * Data — the admin raw-table viewer.
 *
 * An admin picks a table (a history-style lookahead combobox), and for an
 * owner-scoped table also picks an owner, then sees that table's rows from the last
 * 30 days as a plain grid. A filter box narrows the visible rows to those with the
 * typed text in any column, entirely on the client. Gated to admins here; the
 * backend re-gates every read.
 */
import { useMemo, useState } from 'react'
import { useAuth } from '../auth-context'
import { useAdminTables, useAdminTable } from '../lib/useAdminTables'
import { useUsers } from '../lib/useUserHistory'
import Combobox, { type ComboOption } from '../components/Combobox'
import './DataPage.css'

/** Render any cell value as display text; null/undefined show as empty. */
function cellText(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value)
}

// Columns that wrap their value across multiple lines. Every other column is sized
// to exactly fit its widest value. Keyed by column name — `payload` (the events
// JSON) is the only long field so far; add others here as needed.
const WRAP_COLUMNS = new Set(['payload'])

/** Owner-scoped tables: everything except the users directory and sync cursors. */
function requiresOwner(table: string): boolean {
  return table !== 'users' && table !== 'sync_state'
}

function DataPage() {
  const { ready, isAdmin } = useAuth()
  const { tables, error: tablesError } = useAdminTables()
  const { users } = useUsers()
  const [table, setTable] = useState<string | null>(null)
  const [ownerSub, setOwnerSub] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  const needsOwner = table !== null && requiresOwner(table)
  // Fetch only once the selection is complete: a table, plus an owner if it needs one.
  const canView = table !== null && (!needsOwner || ownerSub !== null)
  const { data, loading, error } = useAdminTable(canView ? table : null, needsOwner ? ownerSub : null)

  // Client-side filter: keep rows whose text in any column contains the query.
  const filtered = useMemo(() => {
    if (!data) return []
    const q = query.trim().toLowerCase()
    if (!q) return data.rows
    return data.rows.filter((row) =>
      data.columns.some((col) => cellText(row[col]).toLowerCase().includes(q)),
    )
  }, [data, query])

  const tableOptions: ComboOption[] = useMemo(
    () => tables.map((t) => ({ id: t, label: t })),
    [tables],
  )
  const ownerOptions: ComboOption[] = useMemo(
    () =>
      [...users]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((u) => ({ id: u.sub, label: u.name, picture: u.picture })),
    [users],
  )

  if (!ready) return <section className="page"><p className="muted">Loading…</p></section>
  if (!isAdmin) {
    return (
      <section className="page">
        <div className="page-head"><h1>Data</h1></div>
        <div className="panel"><p className="muted">Admins only.</p></div>
      </section>
    )
  }

  return (
    <section className="page data">
      <div className="page-head"><h1>Data</h1></div>

      {tablesError && <p className="error" role="alert">{tablesError}</p>}

      <Combobox
        label="Table"
        options={tableOptions}
        value={table}
        onChange={(id) => {
          setTable(id)
          setQuery('')
        }}
        placeholder="Search tables…"
      />

      {needsOwner && (
        <Combobox
          label="Owner"
          options={ownerOptions}
          value={ownerSub}
          onChange={(id) => {
            setOwnerSub(id)
            setQuery('')
          }}
          placeholder="Search players…"
        />
      )}

      {table === null ? (
        <div className="panel"><p className="muted">Select a table to view its rows.</p></div>
      ) : needsOwner && ownerSub === null ? (
        <div className="panel"><p className="muted">Select an owner to view this table.</p></div>
      ) : (
        <>
          <input
            type="search"
            className="data-filter"
            placeholder="Filter rows…"
            aria-label="Filter rows by text in any column"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />

          {error && <p className="error" role="alert">{error}</p>}

          {loading ? (
            <p className="muted">Loading…</p>
          ) : !data ? (
            <div className="panel"><p className="muted">No data.</p></div>
          ) : (
            <>
              <p className="data-meta muted">
                {query
                  ? `${filtered.length} of ${data.count} rows match`
                  : `${data.count} row${data.count === 1 ? '' : 's'}`}
                {data.windowDays !== null && ` from the last ${data.windowDays} days`}
              </p>

              <div className="data-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      {data.columns.map((c) => (
                        <th key={c} className={WRAP_COLUMNS.has(c) ? 'wrap' : undefined}>{c}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((row, i) => (
                      <tr key={i}>
                        {data.columns.map((c) => (
                          <td key={c} className={WRAP_COLUMNS.has(c) ? 'wrap' : undefined}>
                            {cellText(row[c])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {filtered.length === 0 && (
                <div className="panel">
                  <p className="muted">
                    {query
                      ? 'No rows match your filter.'
                      : data.windowDays !== null
                        ? `No rows in the last ${data.windowDays} days.`
                        : 'This table is empty.'}
                  </p>
                </div>
              )}
            </>
          )}
        </>
      )}
    </section>
  )
}

export default DataPage
