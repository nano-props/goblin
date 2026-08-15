import { inject, provide, readonly, ref } from 'vue'
import type { InjectionKey, Ref } from 'vue'

export interface FullscreenLoadingPresentation {
  readonly active: Readonly<Ref<boolean>>
  begin(): void
  finish(): void
}

const fullscreenLoadingPresentationKey: InjectionKey<FullscreenLoadingPresentation> = Symbol(
  'fullscreen-loading-presentation',
)

/**
 * Keeps one full-screen loading surface mounted while the sequential public,
 * authentication, and workspace bootstrap owners hand control to one another.
 * Those owners retain their authoritative state; this controller owns only the
 * visible presentation and must not be used as a counter for parallel work.
 */
export function provideFullscreenLoadingPresentation(): FullscreenLoadingPresentation {
  const active = ref(true)
  const presentation: FullscreenLoadingPresentation = {
    active: readonly(active),
    begin() {
      active.value = true
    },
    finish() {
      active.value = false
    },
  }
  provide(fullscreenLoadingPresentationKey, presentation)
  return presentation
}

export function useFullscreenLoadingPresentation(): FullscreenLoadingPresentation {
  const presentation = inject(fullscreenLoadingPresentationKey, null)
  if (!presentation) throw new Error('Full-screen loading presentation is unavailable outside the app root')
  return presentation
}
