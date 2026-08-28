/**
 * The `baseline` aggregate: the player's make-% by distance over their complete
 * past tests, excluding today, as the Daily Putts chart's grey comparison line and
 * the summary's lifetime average.
 *
 * It owns no events — today's putts are excluded from it by definition, so pending
 * writes never change it — hence `reduce` is the identity and `eventTypes` is
 * empty. Caching it (a handful of by-distance points) lets Daily Putts render its
 * baseline offline without ever shipping the underlying batch log.
 */
import type { AggregateDescriptor, Snapshot } from '../types'
import { useAggregateRows } from '../SyncContext'
import { fetchDaily } from './daily'
import type { DistanceStat } from '../../lib/putting'

const NAME = 'baseline'

async function fetchBaseline(): Promise<Snapshot<DistanceStat>> {
  const body = await fetchDaily()
  return { version: body.version, rows: body.baseline }
}

export const baselineDescriptor: AggregateDescriptor<DistanceStat> = {
  name: NAME,
  eventTypes: [],
  fetch: fetchBaseline,
  reduce: (rows) => rows,
  describe: (ev) => ev.type,
}

/** This admin's all-time make-% by distance, excluding today (server-aggregated). */
export function useBaseline(): DistanceStat[] {
  return useAggregateRows<DistanceStat>(NAME)
}
