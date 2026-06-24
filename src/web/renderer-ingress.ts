import type { IpcEvent } from '#/shared/api-types.ts'
import { isClientEffectIntent } from '#/shared/client-effect-intents.ts'
import type { ClientEffectIntent, ClientEffectIntentType } from '#/shared/client-effect-intents.ts'
import { getRendererBridge } from '#/web/renderer-bridge.ts'

// Native-host ingress for Electron renderers. Keep this separate from server
// ingress modules so browser- and Electron-owned downlinks stay explicit.
type NativeHostEventType = IpcEvent['type']

export function subscribeNativeHostEventType<TType extends NativeHostEventType>(
  type: TType,
  cb: (event: Extract<IpcEvent, { type: TType }>) => void,
): () => void {
  return getRendererBridge().onIpcEvent((event) => {
    if (event.type === type) cb(event as Extract<IpcEvent, { type: TType }>)
  })
}

export function subscribeClientEffectIntent(cb: (event: ClientEffectIntent) => void): () => void {
  return getRendererBridge().onEffectIntent(cb)
}

export function subscribeClientEffectIntentType<TType extends ClientEffectIntentType>(
  type: TType,
  cb: (event: Extract<ClientEffectIntent, { type: TType }>) => void,
): () => void {
  return subscribeClientEffectIntent((event) => {
    if (!isClientEffectIntent(event) || event.type !== type) return
    cb(event as Extract<ClientEffectIntent, { type: TType }>)
  })
}
