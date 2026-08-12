import { isClientEffectIntent } from '#/shared/client-effect-intents.ts'
import type { ClientEffectIntent, ClientEffectIntentType } from '#/shared/client-effect-intents.ts'
import { getClientBridge } from '#/web/client-bridge.ts'

export function subscribeClientEffectIntent(cb: (event: ClientEffectIntent) => void): () => void {
  return getClientBridge().onEffectIntent(cb)
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
