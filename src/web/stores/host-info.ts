// Client-side host info. Hydrated at boot from the public
// `/api/host` endpoint (see `#/server/routes/host.ts` and
// `#/server/modules/host-info.ts`). The server already knows its
// own `process.platform` and `os.homedir()` — the Electron preload
// used to ferry those over `goblin:get-home-dir` /
// `goblin:get-platform` IPC. Moving to a public endpoint:
//
//   - drops two IPC channels that were only used to populate the
//     bootstrap script before the first paint
//   - collapses the "Electron vs web" runtime detection: the
//     embedded and standalone web paths now share the same fetch,
//     the same module, and the same code path
//   - lets the Vite-served dev path exercise the exact same wire
//     format the production client does
//
// `homeDirectory()` and `getPlatform()` are kept synchronous so the
// existing call sites (`paths.ts`, `CloneRepositoryDialog`,
// `ExternalAppSettings`) don't have to thread an `await` through.
// Before the hydrate completes they return safe defaults (`''` /
// `'web'`) — the settings page and clone dialog both mount after
// the first paint, by which point `usePublicAppBootstrap` has resolved
// the host-info promise. The original preload used `sendSync` to
// populate these synchronously, but the only consumer that
// actually needed the value during the very first paint was the
// bootstrap script itself, and the bootstrap no longer carries
// these fields.

import { create } from 'zustand'
import { fetchServerJson } from '#/web/lib/server-fetch.ts'

/**
 * Platform identifier the client can branch on. The server
 * returns `process.platform` directly; `'web'` is the fallback the
 * client uses when the hydrate hasn't completed (or the host
 * somehow doesn't expose `process.platform`).
 */
export type ClientPlatform = NodeJS.Platform | 'web'

export interface HostInfoSnapshot {
  /** Absolute path of the user's home directory. `''` if the server couldn't determine it. */
  homeDir: string
  /** Node.js platform identifier returned by the server. */
  platform: NodeJS.Platform
  /** Server's hostname (informational; surfaced in error messages). */
  hostname: string
  /** Process id of the server (informational; surfaced in logs). */
  pid: number
}

interface HostInfoState {
  snapshot: HostInfoSnapshot | null
  hydrated: boolean
  hydrate: () => Promise<void>
}

let hydrateVersion = 0

export const useHostInfoStore = create<HostInfoState>((set) => ({
  snapshot: null,
  hydrated: false,

  async hydrate() {
    // Bump the version so a fast second call (StrictMode dev
    // double-invoke, the user reloading the client with a stale
    // `hydrate()` still in flight) cannot overwrite a fresher
    // snapshot. Same pattern as `#/web/stores/i18n.ts`.
    const version = ++hydrateVersion
    let snapshot: HostInfoSnapshot
    try {
      snapshot = await fetchServerJson<HostInfoSnapshot>('/api/host')
    } catch {
      // Network failure / server down. The sync getters fall
      // back to safe defaults (`''` / `'web'`), which is what
      // they returned before hydration existed; the settings
      // page can still render, it just hides OS-specific
      // options. We do not throw — a host-info outage must not
      // block the client from booting.
      if (version === hydrateVersion) set({ hydrated: true })
      return
    }
    if (version !== hydrateVersion) return
    set({ snapshot, hydrated: true })
  },
}))

/**
 * Read the cached host info synchronously. Returns `null` before
 * the hydrate completes; call sites that can't tolerate a
 * `null` snapshot should use `homeDirectory()` / `getPlatform()`
 * (which fall back to safe defaults) instead.
 */
export function getHostInfo(): HostInfoSnapshot | null {
  return useHostInfoStore.getState().snapshot
}

/**
 * Absolute home-directory path, or `''` if the host info hasn't
 * been hydrated yet. The `''` fallback matches the pre-refactor
 * behaviour (the web runtime's bootstrap carried `homeDir: ''`).
 */
export function homeDirectory(): string {
  return useHostInfoStore.getState().snapshot?.homeDir ?? ''
}

/**
 * Platform identifier the client should branch on for
 * OS-specific UI. Falls back to `'web'` (the same sentinel the
 * old bootstrap used) when the hydrate hasn't completed.
 */
export function getPlatform(): ClientPlatform {
  return useHostInfoStore.getState().snapshot?.platform ?? 'web'
}
