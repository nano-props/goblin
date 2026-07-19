// `fetch` mocking helper.
//
// Many web tests want to stub `globalThis.fetch` so that the client code
// under test (e.g. `repo-client.ts`, `settings-client.ts`) doesn't actually
// hit the embedded server. Each test wants a slightly different response —
// some want to assert call shape, some want to return canned data per
// `mockResolvedValueOnce`, others want a single canned response for the
// whole test.
//
// Two flavors are exposed:
//
//   - `mockFetch()` — installs a `vi.fn()` for `fetch` and returns it.
//     Tests configure responses via the standard vi.fn API
//     (`fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({...}) })`).
//     This is the most flexible and replaces the bulk of the
//     `vi.stubGlobal('fetch', fetchMock)` boilerplate.
//
//   - `installGoblinTestBridge(handlers)` — pathname-keyed router that
//     dispatches `fetch('/api/...')` calls to pathname-keyed handlers
//     style keys. Lives in `#/web/test-utils/bridge.ts`. Prefer this when
//     the test under test exercises many routes at once and the response
//     shape is determined by the route.
//
// Most web tests that previously hand-rolled
// `const fetchMock = vi.fn(...); vi.stubGlobal('fetch', fetchMock)`
// can be simplified to `const fetchMock = mockFetch()`.

import { vi } from 'vitest'

export type FetchMock = ReturnType<typeof vi.fn>

/**
 * Install a `vi.fn()` as the global `fetch` and return it. Tests configure
 * responses via the standard vi.fn API (`fetchMock.mockResolvedValueOnce(...)`).
 *
 * The `impl` return type accepts `Response` for real fetch-shaped returns and
 * `unknown` for the common test shorthand of returning a plain `{ ok, json }`
 * object.
 */
export function mockFetch(impl?: (...args: Parameters<typeof fetch>) => Response | unknown): FetchMock {
  const fetchMock = vi.fn(impl as (...args: unknown[]) => unknown)
  vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)
  return fetchMock
}
