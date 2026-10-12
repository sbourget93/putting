/**
 * The `user_settings` aggregate for the sync engine (per-user preferences).
 *
 * `fetch` reads the signed-in user's own settings (GET /settings), the sparse set
 * of toggles they have changed away from the default. `reduce` folds a queued
 * UserSettingChanged onto those rows, upserting by `name`, mirroring
 * backend/projections/user_settings.py — so a toggle shows instantly and reconciles
 * on the next sync. Every row belongs to the current user (the fetch is scoped), so
 * `name` alone identifies a setting here. When the backend handler changes, mirror
 * it here and in `eventTypes`.
 */
import type { AggregateDescriptor, CommandEvent, Snapshot } from '../types'
import { useAggregateRows } from '../SyncContext'
import type { AppSetting } from '../../lib/putting'

const NAME = 'user_settings'

function str(data: Record<string, unknown> | undefined, key: string): string {
  const value = data?.[key]
  return typeof value === 'string' ? value : ''
}

function bool(data: Record<string, unknown> | undefined, key: string): boolean {
  return data?.[key] === true
}

async function fetchSettings(): Promise<Snapshot<AppSetting>> {
  const res = await fetch('/api/settings')
  if (!res.ok) throw new Error(`fetch settings failed: ${res.status}`)
  const body = (await res.json()) as { version: number; settings: AppSetting[] }
  return {
    version: body.version,
    rows: body.settings.map((s) => ({
      user_setting_id: s.user_setting_id,
      name: s.name,
      value: s.value,
    })),
  }
}

function reduce(rows: AppSetting[], ev: CommandEvent): AppSetting[] {
  switch (ev.type) {
    case 'UserSettingChanged': {
      const name = str(ev.data, 'name')
      const value = bool(ev.data, 'value')
      const i = rows.findIndex((r) => r.name === name)
      // Updating keeps the existing record's id; a first change inserts a new row
      // under the event's aggregate id, mirroring the backend upsert on (owner, name).
      if (i === -1) return [...rows, { user_setting_id: ev.aggregate_id, name, value }]
      const copy = rows.slice()
      copy[i] = { ...copy[i], value }
      return copy
    }
    default:
      return rows
  }
}

function describe(ev: CommandEvent): string {
  switch (ev.type) {
    case 'UserSettingChanged':
      return `Set ${str(ev.data, 'name')} to ${bool(ev.data, 'value') ? 'on' : 'off'}`
    default:
      return ev.type
  }
}

export const userSettingsDescriptor: AggregateDescriptor<AppSetting> = {
  name: NAME,
  eventTypes: ['UserSettingChanged'],
  fetch: fetchSettings,
  reduce,
  describe,
}

/** This user's stored settings: the server snapshot with pending writes folded on top. */
export function useUserSettings(): AppSetting[] {
  return useAggregateRows<AppSetting>(NAME)
}
