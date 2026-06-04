import type { RendererEffectIntent } from '#/shared/renderer-effect-intents.ts'

export function readNativeBridge(): Window['goblinNative'] | null {
  try {
    return window.goblinNative ?? null
  } catch {
    return null
  }
}

export function subscribeNativeEffectIntent(cb: (event: RendererEffectIntent) => void): () => void {
  // Pure web / serve.sh renderers do not have a native bridge. Callers should
  // treat the returned noop disposer as "native lifecycle unavailable" rather
  // than as an error condition.
  const bridge = readNativeBridge()
  return bridge?.onIntent?.(cb) ?? (() => {})
}
