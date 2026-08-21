// The entrypoint hydrates server-owned host information before mounting the
// application, so synchronous readers treat a missing snapshot as a violated
// bootstrap invariant rather than an alternate platform or empty home path.

import { createStore } from 'zustand/vanilla'
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

export const hostInfoStore = createStore<HostInfoState>((set) => ({
  snapshot: null,
  status: 'pending',
  error: null,

  async hydrate(options) {
    // A newer hydration owns the projection and rejects stale completion.
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
  return requireHostInfoSnapshot(hostInfoStore.getState()).homeDir
}

/** Platform identifier from the bootstrapped server authority. */
export function getPlatform(): ClientPlatform {
  return requireHostInfoSnapshot(hostInfoStore.getState()).platform
}

/** Strict Zustand selector for components that react to the server platform. */
export function selectHostPlatform(state: HostInfoState): NodeJS.Platform {
  return requireHostInfoSnapshot(state).platform
}
