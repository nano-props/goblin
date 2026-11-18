import { defineComponent, inject, onMounted, onScopeDispose, provide, toValue, watch } from 'vue'
import type { InjectionKey, MaybeRefOrGetter, PropType } from 'vue'

interface FloatingSurfaceBoundaryContextValue {
  isActive: () => boolean
  registerOpenSurface: (close: () => void) => (() => void) | undefined
}

interface FloatingSurfaceBoundaryProps {
  active?: boolean
  onPinnedChange?: (pinned: boolean) => void
}

const floatingSurfaceBoundaryKey: InjectionKey<FloatingSurfaceBoundaryContextValue> =
  Symbol('floating-surface-boundary')

const FloatingSurfaceBoundary = defineComponent<FloatingSurfaceBoundaryProps>({
  name: 'FloatingSurfaceBoundary',
  props: {
    active: { type: Boolean, default: true },
    onPinnedChange: Function as PropType<FloatingSurfaceBoundaryProps['onPinnedChange']>,
  },

  setup(props, { slots }) {
    const openSurfaces = new Set<() => void>()
    let mounted = false
    let lastPinned: boolean | undefined

    function notifyPinnedChange(): void {
      if (!mounted) return
      const pinned = openSurfaces.size > 0
      if (pinned === lastPinned) return
      lastPinned = pinned
      props.onPinnedChange?.(pinned)
    }

    function registerOpenSurface(close: () => void): (() => void) | undefined {
      if (props.active === false) {
        close()
        return
      }
      openSurfaces.add(close)
      notifyPinnedChange()

      return () => {
        if (openSurfaces.delete(close)) notifyPinnedChange()
      }
    }

    provide(floatingSurfaceBoundaryKey, { isActive: () => props.active !== false, registerOpenSurface })
    watch(
      () => props.active,
      (active) => {
        if (active === false) {
          for (const close of openSurfaces) close()
        }
      },
      { flush: 'sync' },
    )
    onMounted(() => {
      mounted = true
      notifyPinnedChange()
    })

    return () => slots.default?.()
  },
})

export function floatingSurfaceBoundaryIsActive(): boolean {
  return inject(floatingSurfaceBoundaryKey, null)?.isActive() ?? true
}

export function useFloatingSurfaceBoundaryPin(open: MaybeRefOrGetter<boolean>, close: () => void): void {
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
      if (nextOpen && boundary) unregister = boundary.registerOpenSurface(close)
    },
    { immediate: true, flush: 'sync' },
  )
  onScopeDispose(release)
}

export { FloatingSurfaceBoundary }
export type { FloatingSurfaceBoundaryProps }
