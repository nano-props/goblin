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
// The previous version re-read only when the snapshot was *fully*
// empty. A partial read (e.g. `homeDir` set but `initialI18n`
// still null) locked the cache to that partial, so the rest of the
// renderer never saw the populated version. We now re-read while
// the cached value is missing any optional field, and stop as
// soon as two consecutive reads agree.

let initialBootstrap = readInitialBootstrap()

function isPartial(b: RendererBootstrapSnapshot): boolean {
  return (
    b.homeDir.length === 0 ||
    b.initialI18n === null ||
    b.initialSettings === null ||
    b.initialServer === null
  )
}

function sameSnapshot(a: RendererBootstrapSnapshot, b: RendererBootstrapSnapshot): boolean {
  return (
    a.homeDir === b.homeDir &&
    a.platform === b.platform &&
    a.initialI18n === b.initialI18n &&
    a.initialSettings === b.initialSettings &&
    a.initialServer === b.initialServer &&
    a.runtime.kind === b.runtime.kind
  )
}

export function getInitialBootstrap(): RendererBootstrapSnapshot {
  if (!isPartial(initialBootstrap)) return initialBootstrap
  // Re-read up to a small bound. Stop as soon as two consecutive
  // reads agree, which catches both "static" environments (URL
  // query / test fixtures that always return the same partial)
  // and the "boot race" case (a later read yields the populated
  // version the first read missed).
  let last = initialBootstrap
  for (let i = 0; i < 5; i++) {
    const next = readInitialBootstrap()
    if (sameSnapshot(next, last)) {
      initialBootstrap = next
      return initialBootstrap
    }
    last = next
  }
  initialBootstrap = last
  return initialBootstrap
}
