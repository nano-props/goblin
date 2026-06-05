import { subscribeNativeEffectIntent } from '#/web/native-bridge.ts'

type Listener = () => void

const listeners = new Set<Listener>()
let quitting = false

export function isAppQuitting(): boolean {
  return quitting
}

export function subscribeAppQuitting(listener: Listener): () => void {
  if (quitting) {
    listener()
    return () => {}
  }
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function markAppQuitting(): void {
  if (quitting) return
  quitting = true
  for (const listener of Array.from(listeners)) listener()
  listeners.clear()
}

// Keep native quit lifecycle wiring at this low level so every Electron
// renderer that imports app-lifecycle-aware realtime code inherits it, even if
// a future surface does not mount the main React intent router.
//
// Pure web / serve.sh renderers do not receive `app-quitting`; they rely on
// browser teardown plus server-side graceful shutdown instead. Missing native
// lifecycle wiring is therefore expected in web-only mode, not an error.
subscribeNativeEffectIntent((event) => {
  if (event.type === 'app-quitting') markAppQuitting()
})
