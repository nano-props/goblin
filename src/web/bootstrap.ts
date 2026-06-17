import type { RendererBootstrapSnapshot } from '#/shared/bootstrap.ts'
import { emptyRendererBridgeBootstrap, getRendererBridge } from '#/web/renderer-bridge.ts'
function readInitialBootstrap(): RendererBootstrapSnapshot {
  try {
    return getRendererBridge().getBootstrap()
  } catch {
    return emptyRendererBridgeBootstrap()
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

let initialBootstrap = readInitialBootstrap()

function isPartial(b: RendererBootstrapSnapshot): boolean {
  return (
    b.homeDir.length === 0 ||
    b.initialI18n === null ||
    b.initialSettings === null ||
    b.initialServer === null
  )
}

export function getInitialBootstrap(): RendererBootstrapSnapshot {
  if (!isPartial(initialBootstrap)) return initialBootstrap
  initialBootstrap = readInitialBootstrap()
  return initialBootstrap
}
