import type { ClientBootstrapSnapshot } from '#/shared/bootstrap.ts'
import { getRendererBridge } from '#/web/client-bridge.ts'
import { emptyBootstrapSnapshot } from '#/web/client-bootstrap-bridge.ts'

function readInitialBootstrap(): ClientBootstrapSnapshot {
  try {
    return getRendererBridge().getBootstrap()
  } catch {
    return emptyBootstrapSnapshot()
  }
}

// The renderer bridge populates asynchronously: the Electron preload
// may register `window.goblinNative` after this module is first
// imported, and the server-rendered `<script id="goblin-bootstrap">`
// may not have run yet. The first read at module-load time can
// therefore return defaults, or a partially populated snapshot,
// even when a fully populated one is now reachable.
//
// When the cached value is partial, take a single re-read. Two
// consecutive reads on the synchronous bridge see the same DOM
// state, so one re-read is enough to detect "the bootstrap just
// populated" without going through the sameSnapshot dance.
//
// A bare cache (no re-read at all) would lock the renderer into
// the first read forever, which is the bug this function exists
// to prevent.
//
// The "partial" check looks at `initialServer` only — homeDir and
// platform moved to the public `/api/host` endpoint and are no
// longer carried in the bootstrap (see `#/web/stores/host-info.ts`).
// The bootstrap is now a tiny 3-field payload (`runtime`,
// `initialServer`, nothing else), so the partiality check is
// effectively "do we have a real initial server yet?" — relevant
// for QR-code logins that drop the bootstrap late.

let initialBootstrap = readInitialBootstrap()

function isPartial(b: ClientBootstrapSnapshot): boolean {
  return b.initialServer === null
}

export function getInitialBootstrap(): ClientBootstrapSnapshot {
  if (!isPartial(initialBootstrap)) return initialBootstrap
  initialBootstrap = readInitialBootstrap()
  return initialBootstrap
}
