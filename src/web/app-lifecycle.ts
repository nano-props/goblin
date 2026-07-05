import { notifyNativeAppQuitDrained, subscribeNativeEffectIntent } from '#/web/native-bridge.ts'

type Listener = () => void | Promise<void>

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

export async function markAppQuitting(): Promise<void> {
  if (quitting) return
  quitting = true
  const pending = Array.from(listeners).map(async (listener) => await listener())
  listeners.clear()
  await Promise.all(pending)
  await notifyNativeAppQuitDrained()
}

// Keep native quit lifecycle wiring at this low level so every Electron
// client that imports app-lifecycle-aware realtime code inherits it, even if
// a future surface does not mount the main React intent router.
//
// Pure web / serve.sh clients do not receive `app-quitting`; they rely on
// browser teardown plus server-side graceful shutdown instead. Missing native
// lifecycle wiring is therefore expected in web-only mode, not an error.
subscribeNativeEffectIntent((event) => {
  if (event.type === 'app-quitting') void markAppQuitting()
})
