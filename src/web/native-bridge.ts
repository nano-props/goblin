import type { ClientEffectIntent } from '#/shared/client-effect-intents.ts'

export function readNativeBridge(): Window['goblinNative'] | null {
  try {
    return window.goblinNative ?? null
  } catch {
    return null
  }
}

export function subscribeNativeEffectIntent(cb: (event: ClientEffectIntent) => void): () => void {
  // Pure web / serve.sh clients (non-Electron surfaces, not renderer processes)
  // do not have a native bridge. Callers should
  // treat the returned noop disposer as "native lifecycle unavailable" rather
  // than as an error condition.
  const bridge = readNativeBridge()
  return bridge?.onIntent?.(cb) ?? (() => {})
}
