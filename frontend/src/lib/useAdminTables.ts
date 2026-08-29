/**
 * useAdminTables / useAdminTable — read models for the admin raw-table viewer.
 *
 * Both are online-only admin reads, re-gated on the server. `useAdminTables` lists
 * the browsable tables (GET /api/admin/tables): the two core tables plus every
 * projection. `useAdminTable` fetches one table's columns and rows
 * (GET /api/admin/tables/{table}); the server caps the rows and sets `truncated`
 * when it hid some. Nothing here is cached offline — it is a rare, deliberate admin
 * action over data that isn't in this device's local store.
 */
import { useEffect, useState } from 'react'
import { fetchWithTimeout } from './http'

export interface TableData {
  table: string
  columns: string[]
  rows: Record<string, unknown>[]
  count: number
  /** Rows are limited to this many days for owner-scoped tables; null for tables shown in full. */
  windowDays: number | null
}

export function useAdminTables() {
  const [tables, setTables] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoading(true)
      try {
        const res = await fetchWithTimeout('/api/admin/tables')
        if (!res.ok) throw new Error(`Could not load tables (${res.status})`)
        const body = (await res.json()) as { tables: string[] }
        if (!cancelled) {
          setTables(body.tables)
          setError(null)
        }
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return { tables, loading, error }
}

export function useAdminTable(table: string | null, sub: string | null) {
  const [data, setData] = useState<TableData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!table) {
      setData(null)
      return
    }
    let cancelled = false
    const q = sub ? `?sub=${encodeURIComponent(sub)}` : ''
    void (async () => {
      setLoading(true)
      try {
        const res = await fetchWithTimeout(`/api/admin/tables/${encodeURIComponent(table)}${q}`)
        if (!res.ok) throw new Error(`Could not load ${table} (${res.status})`)
        const body = (await res.json()) as {
          table: string
          columns: string[]
          rows: Record<string, unknown>[]
          count: number
          window_days: number | null
        }
        if (!cancelled) {
          setData({
            table: body.table,
            columns: body.columns,
            rows: body.rows,
            count: body.count,
            windowDays: body.window_days,
          })
          setError(null)
        }
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : String(cause))
          setData(null)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [table, sub])

  return { data, loading, error }
}
