import { defineComponent, inject, provide } from 'vue'
import type { InjectionKey } from 'vue'
import { useAccessTokenStatus } from '#/web/hooks/useAccessTokenStatus.ts'
import type { AccessTokenStatusState } from '#/web/hooks/useAccessTokenStatus.ts'

const authKey: InjectionKey<AccessTokenStatusState> = Symbol('auth')

export const AuthProvider = defineComponent({
  name: 'AuthProvider',
  setup(_props, { slots }) {
    provide(authKey, useAccessTokenStatus())
    return () => slots.default?.()
  },
})

export function useAuth(): AccessTokenStatusState {
  const auth = inject(authKey, null)
  if (!auth) throw new Error('useAuth must be used within <AuthProvider>')
  return auth
}
