import { computed, defineComponent, inject, provide } from 'vue'
import type { ComputedRef, InjectionKey } from 'vue'
import { useIsSmallScreen } from '#/web/hooks/useIsSmallScreen.ts'

export type ResponsiveUiMode = 'default' | 'compact'

interface ResponsiveUiContextValue {
  mode: ComputedRef<ResponsiveUiMode>
  compact: ComputedRef<boolean>
}

const responsiveUiKey: InjectionKey<ResponsiveUiContextValue> = Symbol('responsive-ui')

const ResponsiveUiProvider = defineComponent({
  name: 'ResponsiveUiProvider',
  setup(_props, { slots }) {
    const compact = useIsSmallScreen()
    const mode = computed<ResponsiveUiMode>(() => (compact.value ? 'compact' : 'default'))
    provide(responsiveUiKey, { mode, compact })

    return () => slots.default?.()
  },
})

export function useResponsiveUi(): ResponsiveUiContextValue {
  const context = inject(responsiveUiKey, null)
  if (context) return context

  const compact = useIsSmallScreen()
  return {
    compact,
    mode: computed<ResponsiveUiMode>(() => (compact.value ? 'compact' : 'default')),
  }
}

export function useResponsiveUiMode(): ComputedRef<ResponsiveUiMode> {
  return useResponsiveUi().mode
}

export function useIsCompactUi(): ComputedRef<boolean> {
  return useResponsiveUi().compact
}

export { ResponsiveUiProvider }
