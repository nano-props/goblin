import { computed, toValue } from 'vue'
import type { ComputedRef, MaybeRefOrGetter } from 'vue'
import { useOverlayRegistry } from '#/web/hooks/useOverlayRegistry.ts'

export const APP_OVERLAY_KEYS = ['clone', 'openWorkspace', 'openRemoteWorkspace'] as const
export type AppOverlayKey = (typeof APP_OVERLAY_KEYS)[number]

interface AppOverlayRouteOptions {
  routeOverlay?: MaybeRefOrGetter<AppOverlayKey | null | undefined>
  onRouteOverlayChange?: (overlay: AppOverlayKey | null) => void
}

interface AppOverlayState {
  clone: { open: boolean }
  openWorkspace: { open: boolean }
  openRemoteWorkspace: { open: boolean }
}

export function useAppOverlays(options: AppOverlayRouteOptions = {}): {
  state: ComputedRef<AppOverlayState>
  anyOpen: ComputedRef<boolean>
  openCloneRepo: () => void
  setCloneOpen: (open: boolean) => void
  openWorkspacePathDialog: () => void
  setOpenWorkspaceOpen: (open: boolean) => void
  openRemoteWorkspace: () => void
  setOpenRemoteWorkspaceOpen: (open: boolean) => void
  closeAllOverlays: () => void
} {
  const registry = useOverlayRegistry<AppOverlayKey>(APP_OVERLAY_KEYS)
  const routeDriven = typeof options.onRouteOverlayChange === 'function'
  const routeOverlay = () => toValue(options.routeOverlay) ?? null

  function openOverlay(key: AppOverlayKey): void {
    if (routeDriven) options.onRouteOverlayChange?.(key)
    else registry.open(key)
  }

  function setOverlayOpen(key: AppOverlayKey, open: boolean): void {
    if (routeDriven) {
      options.onRouteOverlayChange?.(open ? key : routeOverlay() === key ? null : routeOverlay())
    } else {
      registry.setOpen(key, open)
    }
  }

  const state = computed<AppOverlayState>(() => ({
    clone: { open: routeDriven ? routeOverlay() === 'clone' : registry.state.clone },
    openWorkspace: { open: routeDriven ? routeOverlay() === 'openWorkspace' : registry.state.openWorkspace },
    openRemoteWorkspace: {
      open: routeDriven ? routeOverlay() === 'openRemoteWorkspace' : registry.state.openRemoteWorkspace,
    },
  }))
  const anyOpen = computed(
    () => state.value.clone.open || state.value.openWorkspace.open || state.value.openRemoteWorkspace.open,
  )

  return {
    state,
    anyOpen,
    openCloneRepo: () => openOverlay('clone'),
    setCloneOpen: (open) => setOverlayOpen('clone', open),
    openWorkspacePathDialog: () => openOverlay('openWorkspace'),
    setOpenWorkspaceOpen: (open) => setOverlayOpen('openWorkspace', open),
    openRemoteWorkspace: () => openOverlay('openRemoteWorkspace'),
    setOpenRemoteWorkspaceOpen: (open) => setOverlayOpen('openRemoteWorkspace', open),
    closeAllOverlays() {
      if (routeDriven) options.onRouteOverlayChange?.(null)
      else registry.closeAll()
    },
  }
}
