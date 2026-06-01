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

const initialBootstrap = readInitialBootstrap()

export function getInitialBootstrap(): RendererBootstrapSnapshot {
  return initialBootstrap
}
