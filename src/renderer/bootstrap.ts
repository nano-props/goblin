import type { RendererBootstrapSnapshot } from '#/shared/bootstrap.ts'

const EMPTY_BOOTSTRAP: RendererBootstrapSnapshot = {
  homeDir: '',
  initialI18n: null,
  initialSettings: null,
}

function readInitialBootstrap(): RendererBootstrapSnapshot {
  try {
    const bridge = window.goblin
    return {
      homeDir: typeof bridge?.homeDir === 'string' ? bridge.homeDir : '',
      initialI18n: bridge?.initialI18n ?? null,
      initialSettings: bridge?.initialSettings ?? null,
    }
  } catch {
    return EMPTY_BOOTSTRAP
  }
}

let initialBootstrap = readInitialBootstrap()

export function getInitialBootstrap(): RendererBootstrapSnapshot {
  if (
    initialBootstrap.homeDir.length === 0 &&
    initialBootstrap.initialI18n === null &&
    initialBootstrap.initialSettings === null
  ) {
    const next = readInitialBootstrap()
    if (next.homeDir.length > 0 || next.initialI18n !== null || next.initialSettings !== null) initialBootstrap = next
  }
  return initialBootstrap
}
