import { inject, provide, readonly, ref } from 'vue'
import type { InjectionKey, Ref } from 'vue'

export interface BootstrapLoadingPresentation {
  readonly visible: Readonly<Ref<boolean>>
  show(): void
  hide(): void
}

const bootstrapLoadingPresentationKey: InjectionKey<BootstrapLoadingPresentation> = Symbol(
  'bootstrap-loading-presentation',
)

/**
 * Keeps one root loading node stable while public bootstrap and the sequential
 * authentication and workspace projections transition. This owns only UI
 * visibility; parallel work must be aggregated by its authoritative owner.
 */
export function provideBootstrapLoadingPresentation(): BootstrapLoadingPresentation {
  const visible = ref(true)
  const presentation: BootstrapLoadingPresentation = {
    visible: readonly(visible),
    show() {
      visible.value = true
    },
    hide() {
      visible.value = false
    },
  }
  provide(bootstrapLoadingPresentationKey, presentation)
  return presentation
}

export function useBootstrapLoadingPresentation(): BootstrapLoadingPresentation {
  const presentation = inject(bootstrapLoadingPresentationKey, null)
  if (!presentation) throw new Error('Bootstrap loading presentation is unavailable outside the app root')
  return presentation
}
