import { notifyNativeAppQuitDrained, readNativeBridge } from '#/web/native-bridge.ts'
import { errorToAppQuitDrainResult } from '#/shared/app-quit-drain.ts'

type Listener = () => void | Promise<void>

const listeners = new Set<Listener>()
let quitting = false

export function startNativeAppQuitIngress(): () => void {
  const bridge = readNativeBridge()
  if (!bridge) return () => {}
  return bridge.onAppQuitting(() => {
    void markAppQuitting()
  })
}

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
  const results = await Promise.allSettled(pending)
  const failure = results.find((result) => result.status === 'rejected')
  if (!failure) {
    await notifyNativeAppQuitDrained({ ok: true })
    return
  }
  await notifyNativeAppQuitDrained(errorToAppQuitDrainResult(failure.reason))
}
