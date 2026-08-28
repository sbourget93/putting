/**
 * Command plumbing for the event-sourced backend.
 *
 * Every aggregate submits the same generic event shape to POST /api/commands;
 * the backend routes by `type`. This app is last-write-wins (see backend
 * AGENTS.md): commands carry no `expected_version`, so there is no conflict
 * response — only success, a permanent 4xx rejection, or a transient failure.
 */
import { fetchWithTimeout } from '../lib/http'
import type { CommandEvent } from './types'

/** Build a client-generated command event (ids + timestamp filled in). */
export function newEvent(
  type: string,
  aggregateId: string,
  data?: Record<string, unknown>,
): CommandEvent {
  return {
    event_id: crypto.randomUUID(),
    type,
    aggregate_id: aggregateId,
    data,
    created_at: new Date().toISOString(),
  }
}

/**
 * A 4xx that isn't a network problem — an unknown event type or a payload a
 * projection handler refused. Retrying can never succeed, so the engine
 * dead-letters these instead of re-queuing them.
 */
export class RejectedError extends Error {
  status: number
  detail: string
  constructor(status: number, detail: string) {
    super(`command rejected: ${status}`)
    this.name = 'RejectedError'
    this.status = status
    this.detail = detail
  }
}

/**
 * Submit a batch as one atomic command. Resolves with the new server version on
 * success; throws RejectedError on a 4xx (permanent — dead-letter it) and a
 * plain Error on 5xx / network failure (transient — keep the batch and retry).
 */
export async function postCommands(events: CommandEvent[]): Promise<{ version: number }> {
  const res = await fetchWithTimeout('/api/commands', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ events }),
  })
  if (res.status >= 400 && res.status < 500) {
    const body = (await res.json().catch(() => null)) as { detail?: unknown } | null
    const detail = typeof body?.detail === 'string' ? body.detail : `HTTP ${res.status}`
    throw new RejectedError(res.status, detail)
  }
  if (!res.ok) throw new Error(`command failed: ${res.status}`)
  return (await res.json()) as { version: number }
}
