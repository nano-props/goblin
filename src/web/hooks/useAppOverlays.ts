import { useCallback, useMemo } from 'react'
import { useOverlayRegistry } from '#/web/hooks/useOverlayRegistry.ts'
export const APP_OVERLAY_KEYS = ['clone', 'openRepo', 'openRemoteRepo'] as const
export type AppOverlayKey = (typeof APP_OVERLAY_KEYS)[number]

interface AppOverlayRouteOptions {
  routeOverlay?: AppOverlayKey | null
  onRouteOverlayChange?: (overlay: AppOverlayKey | null) => void
}

export function useAppOverlays(options: AppOverlayRouteOptions = {}) {
  // App-level orchestration layer: compose the generic open/close registry with
  // any overlay-specific payload (such as settingsPage). New app overlays
  // should usually be wired here rather than expanding useOverlayRegistry.
  const registry = useOverlayRegistry<AppOverlayKey>(APP_OVERLAY_KEYS)
  const { closeAll, open, setOpen, state: openByKey } = registry
  const routeOverlay = options.routeOverlay ?? null
  const onRouteOverlayChange = options.onRouteOverlayChange
  const routeDriven = typeof onRouteOverlayChange === 'function'

  const openCloneRepo = useCallback(() => {
    if (routeDriven) {
      onRouteOverlayChange?.('clone')
      return
    }
    open('clone')
  }, [onRouteOverlayChange, open, routeDriven])

  const setCloneOpen = useCallback(
    (open: boolean) => {
      if (routeDriven) {
        onRouteOverlayChange?.(open ? 'clone' : routeOverlay === 'clone' ? null : routeOverlay)
        return
      }
      setOpen('clone', open)
    },
    [onRouteOverlayChange, routeDriven, routeOverlay, setOpen],
  )

  const openRepoPathDialog = useCallback(() => {
    if (routeDriven) {
      onRouteOverlayChange?.('openRepo')
      return
    }
    open('openRepo')
  }, [onRouteOverlayChange, open, routeDriven])

  const setOpenRepoOpen = useCallback(
    (open: boolean) => {
      if (routeDriven) {
        onRouteOverlayChange?.(open ? 'openRepo' : routeOverlay === 'openRepo' ? null : routeOverlay)
        return
      }
      setOpen('openRepo', open)
    },
    [onRouteOverlayChange, routeDriven, routeOverlay, setOpen],
  )

  const openRemoteRepo = useCallback(() => {
    if (routeDriven) {
      onRouteOverlayChange?.('openRemoteRepo')
      return
    }
    open('openRemoteRepo')
  }, [onRouteOverlayChange, open, routeDriven])

  const setOpenRemoteRepoOpen = useCallback(
    (open: boolean) => {
      if (routeDriven) {
        onRouteOverlayChange?.(open ? 'openRemoteRepo' : routeOverlay === 'openRemoteRepo' ? null : routeOverlay)
        return
      }
      setOpen('openRemoteRepo', open)
    },
    [onRouteOverlayChange, routeDriven, routeOverlay, setOpen],
  )

  const closeAllOverlays = useCallback(() => {
    if (routeDriven) {
      onRouteOverlayChange?.(null)
      return
    }
    closeAll()
  }, [closeAll, onRouteOverlayChange, routeDriven])

  const state = useMemo(
    () => ({
      clone: { open: routeDriven ? routeOverlay === 'clone' : openByKey.clone },
      openRepo: { open: routeDriven ? routeOverlay === 'openRepo' : openByKey.openRepo },
      openRemoteRepo: {
        open: routeDriven ? routeOverlay === 'openRemoteRepo' : openByKey.openRemoteRepo,
      },
    }),
    [openByKey.clone, openByKey.openRepo, openByKey.openRemoteRepo, routeDriven, routeOverlay],
  )
  const anyOverlayOpen = state.clone.open || state.openRepo.open || state.openRemoteRepo.open

  return {
    state,
    anyOpen: anyOverlayOpen,
    openCloneRepo,
    setCloneOpen,
    openRepoPathDialog,
    setOpenRepoOpen,
    openRemoteRepo,
    setOpenRemoteRepoOpen,
    closeAllOverlays,
  }
}
