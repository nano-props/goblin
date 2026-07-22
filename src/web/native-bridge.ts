import type { ClientEffectIntent } from '#/shared/client-effect-intents.ts'
import type { AppQuitDrainResult } from '#/shared/app-quit-drain.ts'

export function readNativeBridge(): Window['goblinNative'] | null {
  if (typeof window === 'undefined') return null
  const bridge = window.goblinNative
  if (!bridge) return null
  if (
    typeof bridge.invokeIpc !== 'function' ||
    typeof bridge.abortIpc !== 'function' ||
    typeof bridge.notifyAppQuitDrained !== 'function' ||
    typeof bridge.onEvent !== 'function' ||
    typeof bridge.onIntent !== 'function' ||
    typeof bridge.pathForFile !== 'function' ||
    typeof bridge.rotateAccessToken !== 'function' ||
    !bridge.host ||
    typeof bridge.host.openSettingsWindow !== 'function' ||
    typeof bridge.host.openExternalUrl !== 'function' ||
    typeof bridge.host.openDirectoryDialog !== 'function' ||
    typeof bridge.host.consumeExternalOpenPaths !== 'function' ||
    !bridge.terminal ||
    typeof bridge.terminal.notifyBell !== 'function' ||
    typeof bridge.terminal.sendTestNotification !== 'function' ||
    typeof bridge.terminal.setBadge !== 'function'
  ) {
    throw new Error('Incomplete Goblin native preload contract')
  }
  return bridge
}

export function subscribeNativeEffectIntent(cb: (event: ClientEffectIntent) => void): () => void {
  // Pure web / serve.sh clients are not Electron renderer processes, so they
  // do not have a native bridge.
  // Callers should
  // treat the returned noop disposer as "native lifecycle unavailable" rather
  // than as an error condition.
  const bridge = readNativeBridge()
  return bridge ? bridge.onIntent(cb) : () => {}
}

export async function notifyNativeAppQuitDrained(result: AppQuitDrainResult): Promise<void> {
  const bridge = readNativeBridge()
  if (bridge) await bridge.notifyAppQuitDrained(result)
}
