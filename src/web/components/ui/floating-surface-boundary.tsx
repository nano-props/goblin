import { defineComponent, inject, onMounted, onScopeDispose, provide, ref, toValue, watch } from 'vue'
import type { InjectionKey, MaybeRefOrGetter } from 'vue'

interface FloatingSurfaceBoundaryContextValue {
  registerOpenSurface: () => () => void
}

interface FloatingSurfaceBoundaryProps {
  onPinnedChange?: (pinned: boolean) => void
}

const floatingSurfaceBoundaryKey: InjectionKey<FloatingSurfaceBoundaryContextValue> =
  Symbol('floating-surface-boundary')

const FloatingSurfaceBoundary = defineComponent<FloatingSurfaceBoundaryProps>({
  name: 'FloatingSurfaceBoundary',
  props: ['onPinnedChange'],

  setup(props, { slots }) {
    const openDescendantCount = ref(0)
    let mounted = false
    let lastPinned: boolean | undefined

    function notifyPinnedChange(): void {
      if (!mounted) return
      const pinned = openDescendantCount.value > 0
      if (pinned === lastPinned) return
      lastPinned = pinned
      props.onPinnedChange?.(pinned)
    }

    function registerOpenSurface(): () => void {
      let registered = true
      openDescendantCount.value += 1
      notifyPinnedChange()

      return () => {
        if (!registered) return
        registered = false
        openDescendantCount.value = Math.max(0, openDescendantCount.value - 1)
        notifyPinnedChange()
      }
    }

    provide(floatingSurfaceBoundaryKey, { registerOpenSurface })
    onMounted(() => {
      mounted = true
      notifyPinnedChange()
    })

    return () => slots.default?.()
  },
})

export function useFloatingSurfaceBoundaryPin(open: MaybeRefOrGetter<boolean>): void {
  const boundary = inject(floatingSurfaceBoundaryKey, null)
  let unregister: (() => void) | undefined

  function release(): void {
    unregister?.()
    unregister = undefined
  }

  // A controlled Popover can change `open` without emitting an update event,
  // so this is the one state edge that must be observed rather than handled
  // only by the Popover's own events.
  watch(
    () => toValue(open),
    (nextOpen) => {
      release()
      if (nextOpen && boundary) unregister = boundary.registerOpenSurface()
    },
    { immediate: true, flush: 'sync' },
  )
  onScopeDispose(release)
}

export { FloatingSurfaceBoundary }
export type { FloatingSurfaceBoundaryProps }
