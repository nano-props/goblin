import type { RendererBootstrapSnapshot } from '#/shared/bootstrap.ts'
import { emptyRendererBridgeBootstrap, getRendererBridge } from '#/web/renderer-bridge.ts'
function readInitialBootstrap(): RendererBootstrapSnapshot {
  try {
    return getRendererBridge().getBootstrap()
  } catch {
    return emptyRendererBridgeBootstrap()
  }
}

let initialBootstrap = readInitialBootstrap()

export function getInitialBootstrap(): RendererBootstrapSnapshot {
  if (
    initialBootstrap.runtime.kind === 'web' &&
    initialBootstrap.homeDir.length === 0 &&
    initialBootstrap.initialI18n === null &&
    initialBootstrap.initialSettings === null &&
    initialBootstrap.initialServer === null
  ) {
    const next = readInitialBootstrap()
    if (
      next.runtime.kind !== initialBootstrap.runtime.kind ||
      next.homeDir.length > 0 ||
      next.initialI18n !== null ||
      next.initialSettings !== null ||
      next.initialServer !== null
    ) {
      initialBootstrap = next
    }
  }
  return initialBootstrap
}
