import type { ClientEffectIntent } from '#/shared/client-effect-intents.ts'
import { broadcastToSurfaceCapability } from '#/main/client-surface-registry.ts'
import { CLIENT_EFFECT_INTENT_CHANNEL } from '#/shared/ipc-channels.ts'

// Native-host downstream messages into trusted client surfaces. Server-owned
// realtime (terminal + invalidation) continues to flow over /ws instead.
export function broadcastClientEffectIntent(intent: ClientEffectIntent): void {
  broadcastToSurfaceCapability('ipcBroadcast', CLIENT_EFFECT_INTENT_CHANNEL, [intent])
}
