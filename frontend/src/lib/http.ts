/**
 * fetchWithTimeout — fetch that gives up after a bounded wait.
 *
 * `fetch` has no default timeout, so a server that is reachable but not answering
 * (an overloaded or hung backend that accepts the connection and then stalls)
 * leaves a request pending forever — an endless spinner rather than a clean
 * failure. Routing every app request through this bounds that wait, so a stalled
 * server degrades to the cached/offline path (or a surfaced error) quickly, the
 * same way an outright-unreachable server already does.
 *
 * A caller that supplies its own `signal` keeps it — we never override an explicit
 * abort. On timeout the returned promise rejects with a `TimeoutError`
 * DOMException, which the existing try/catch paths already treat as a failure.
 */
export const REQUEST_TIMEOUT_MS = 10000

export function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  ms = REQUEST_TIMEOUT_MS,
): Promise<Response> {
  return fetch(input, { ...init, signal: init.signal ?? AbortSignal.timeout(ms) })
}
