/**
 * IndexedDB persistence for the sync engine.
 *
 * Holds everything needed to render instantly (and offline) on the next load:
 * each aggregate's last server snapshot, the un-acked command queue, the
 * dead-letter list, and the last synced version. This is a cache, not the source
 * of truth — the server projection is — so a corrupt or empty store just means a
 * refetch, never data loss (unsent writes live in the queue, which is persisted).
 *
 * Two object stores: `snapshots` (keyPath name) and `kv` (keyPath key) for the
 * queue / dead-letter / version singletons.
 */
import type { CommandEvent, DeadLetter, Snapshot } from './types'

const DB_NAME = 'app-offline'
// Bump this whenever the object-store layout changes. The DB is a disposable
// cache (the server projection is the source of truth), so a version bump just
// resets it to the current schema — see onupgradeneeded.
const DB_VERSION = 2
const SNAPSHOTS = 'snapshots'
const KV = 'kv'

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

let dbPromise: Promise<IDBDatabase> | null = null

function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      // The DB is a disposable cache, so any version bump drops whatever stores
      // exist and recreates the current schema — the simplest correct migration.
      // (A fresh DB has none to drop; an older one may hold stores from a previous
      // layout, which would otherwise linger or, worse, shadow the new ones.)
      for (const name of Array.from(db.objectStoreNames)) db.deleteObjectStore(name)
      db.createObjectStore(SNAPSHOTS, { keyPath: 'name' })
      db.createObjectStore(KV, { keyPath: 'key' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  return dbPromise
}

async function putKv(key: string, value: unknown): Promise<void> {
  const db = await open()
  await promisify(db.transaction(KV, 'readwrite').objectStore(KV).put({ key, value }))
}

async function getKv<T>(key: string): Promise<T | undefined> {
  const db = await open()
  const row = await promisify<{ key: string; value: T } | undefined>(
    db.transaction(KV, 'readonly').objectStore(KV).get(key) as IDBRequest<
      { key: string; value: T } | undefined
    >,
  )
  return row?.value
}

export async function saveSnapshot(name: string, snapshot: Snapshot): Promise<void> {
  const db = await open()
  await promisify(
    db
      .transaction(SNAPSHOTS, 'readwrite')
      .objectStore(SNAPSHOTS)
      .put({ name, version: snapshot.version, rows: snapshot.rows }),
  )
}

export const saveQueue = (queue: CommandEvent[]) => putKv('queue', queue)
export const saveDeadLetter = (deadLetter: DeadLetter[]) => putKv('deadLetter', deadLetter)
export const saveVersion = (version: number) => putKv('version', version)

export interface LoadedState {
  snapshots: Record<string, Snapshot>
  queue: CommandEvent[]
  deadLetter: DeadLetter[]
  version: number
}

/** Hydrate persisted state for the given aggregate names. Missing pieces default empty. */
export async function loadState(names: string[]): Promise<LoadedState> {
  const db = await open()
  const store = db.transaction(SNAPSHOTS, 'readonly').objectStore(SNAPSHOTS)
  const snapshots: Record<string, Snapshot> = {}
  await Promise.all(
    names.map(async (name) => {
      const row = await promisify<{ name: string; version: number; rows: unknown[] } | undefined>(
        store.get(name) as IDBRequest<
          { name: string; version: number; rows: unknown[] } | undefined
        >,
      )
      if (row) snapshots[name] = { version: row.version, rows: row.rows }
    }),
  )
  return {
    snapshots,
    queue: (await getKv<CommandEvent[]>('queue')) ?? [],
    deadLetter: (await getKv<DeadLetter[]>('deadLetter')) ?? [],
    version: (await getKv<number>('version')) ?? 0,
  }
}
