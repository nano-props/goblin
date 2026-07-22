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
// `homeDirectory()` and `getPlatform()` remain synchronous because the
// entrypoint establishes the snapshot before mounting the application.
// A missing snapshot is therefore a violated bootstrap invariant, not an
// alternate web platform or empty home directory.

import { create } from 'zustand'
import { fetchServerJson } from '#/web/lib/server-fetch.ts'
import { decodeWith } from '#/shared/http-response-schema.ts'
import { HostInfoSnapshotSchema } from '#/shared/web-bootstrap-response-schema.ts'

/**
 * Platform identifier the client can branch on. The server
 * returns `process.platform` directly. `'web'` describes a client-only
 * environment; it is not a substitute for a failed server host read.
 */
export type ClientPlatform = NodeJS.Platform | 'web'

interface HostInfoSnapshot {
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
  status: 'pending' | 'ready' | 'error'
  error: unknown | null
  hydrate: (options?: { signal?: AbortSignal }) => Promise<void>
}

let hydrateVersion = 0

export const useHostInfoStore = create<HostInfoState>((set) => ({
  snapshot: null,
  status: 'pending',
  error: null,

  async hydrate(options) {
    // Bump the version so a fast second call (StrictMode dev
    // double-invoke, the user reloading the client with a stale
    // `hydrate()` still in flight) cannot overwrite a fresher
    // snapshot. Same pattern as `#/web/stores/i18n.ts`.
    const version = ++hydrateVersion
    set({ status: 'pending', error: null })
    try {
      const snapshot = await fetchServerJson('/api/host', decodeWith(HostInfoSnapshotSchema), {
        signal: options?.signal,
      })
      if (version !== hydrateVersion) return
      set({ snapshot, status: 'ready', error: null })
    } catch (error) {
      if (version === hydrateVersion) set({ snapshot: null, status: 'error', error })
      throw error
    }
  },
}))

function requireHostInfoSnapshot(state: Pick<HostInfoState, 'snapshot' | 'status' | 'error'>): HostInfoSnapshot {
  if (state.status !== 'ready' || !state.snapshot) {
    throw new Error('Host info is unavailable before successful bootstrap', { cause: state.error ?? undefined })
  }
  return state.snapshot
}

/** Absolute home-directory path from the bootstrapped server authority. */
export function homeDirectory(): string {
  return requireHostInfoSnapshot(useHostInfoStore.getState()).homeDir
}

/** Platform identifier from the bootstrapped server authority. */
export function getPlatform(): ClientPlatform {
  return requireHostInfoSnapshot(useHostInfoStore.getState()).platform
}

/** Strict Zustand selector for components that react to the server platform. */
export function selectHostPlatform(state: HostInfoState): NodeJS.Platform {
  return requireHostInfoSnapshot(state).platform
}
