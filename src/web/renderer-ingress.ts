import type { IpcEvent } from '#/shared/api-types.ts'
import { isRendererEffectIntent } from '#/shared/renderer-effect-intents.ts'
import type { RendererEffectIntent, RendererEffectIntentType } from '#/shared/renderer-effect-intents.ts'
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

export function subscribeRendererEffectIntent(cb: (event: RendererEffectIntent) => void): () => void {
  return getRendererBridge().onEffectIntent(cb)
}

export function subscribeRendererEffectIntentType<TType extends RendererEffectIntentType>(
  type: TType,
  cb: (event: Extract<RendererEffectIntent, { type: TType }>) => void,
): () => void {
  return subscribeRendererEffectIntent((event) => {
    if (!isRendererEffectIntent(event) || event.type !== type) return
    cb(event as Extract<RendererEffectIntent, { type: TType }>)
  })
}
