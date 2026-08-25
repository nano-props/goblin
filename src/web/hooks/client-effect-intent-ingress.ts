import { inject, onScopeDispose, provide } from 'vue'
import type { InjectionKey } from 'vue'
import type { ClientEffectIntent } from '#/shared/client-effect-intents.ts'
import { subscribeClientEffectIntent } from '#/web/bridge/ingress.ts'
import { advanceServerCommandGeneration } from '#/web/lib/server-command-generation.ts'

export type AuthenticatedClientEffectIntent = Exclude<ClientEffectIntent, { type: 'server-command-reset-requested' }>

interface AuthenticatedClientEffectIntentIngress {
  subscribe: (listener: (intent: AuthenticatedClientEffectIntent) => void) => () => void
}

const authenticatedClientEffectIntentIngressKey: InjectionKey<AuthenticatedClientEffectIntentIngress> = Symbol(
  'authenticated-client-effect-intent-ingress',
)

export function provideDocumentClientEffectIntentIngress(): void {
  let authenticatedListener: ((intent: AuthenticatedClientEffectIntent) => void) | null = null
  let pendingIntents: AuthenticatedClientEffectIntent[] = []

  // Command reset owns the document lifetime, including pre-auth commands.
  // Business intents wait for the single authenticated consumer.
  const offNativeIntent = subscribeClientEffectIntent((intent) => {
    if (intent.type === 'server-command-reset-requested') {
      advanceServerCommandGeneration()
      return
    }
    if (authenticatedListener) {
      authenticatedListener(intent)
      return
    }
    if (intent.type === 'external-open-enqueued' && pendingIntents.some((pending) => pending.type === intent.type))
      return
    pendingIntents.push(intent)
  })

  provide(authenticatedClientEffectIntentIngressKey, {
    subscribe(listener) {
      if (authenticatedListener) throw new Error('Authenticated client effect intent consumer is already registered')
      authenticatedListener = listener
      const pending = pendingIntents
      pendingIntents = []
      for (const intent of pending) listener(intent)
      return () => {
        if (authenticatedListener === listener) authenticatedListener = null
      }
    },
  })

  onScopeDispose(() => {
    authenticatedListener = null
    pendingIntents = []
    offNativeIntent()
  })
}

export function useAuthenticatedClientEffectIntentIngress(): AuthenticatedClientEffectIntentIngress {
  const ingress = inject(authenticatedClientEffectIntentIngressKey, null)
  if (!ingress) throw new Error('Authenticated client effect intent ingress is unavailable')
  return ingress
}
