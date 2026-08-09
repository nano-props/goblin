import { computed, defineComponent, inject, provide } from 'vue'
import type { ComputedRef, InjectionKey, PropType } from 'vue'
import type { BranchActionSurface } from '#/web/hooks/useBranchActionItems.tsx'

const branchActionSurfaceKey: InjectionKey<ComputedRef<BranchActionSurface>> = Symbol('branch-action-surface')

export const BranchActionSurfaceProvider = defineComponent(
  (props: { value: BranchActionSurface }, { slots }) => {
    provide(
      branchActionSurfaceKey,
      computed(() => props.value),
    )
    return () => slots.default?.()
  },
  {
    name: 'BranchActionSurfaceProvider',
    props: {
      value: { type: Object as PropType<BranchActionSurface>, required: true },
    },
  },
)

export function useBranchActionSurface(): ComputedRef<BranchActionSurface> {
  const value = inject(branchActionSurfaceKey, null)
  if (!value) throw new Error('Branch action surface context is unavailable')
  return value
}
