import { useCallback, useMemo } from 'react'
import { useOverlayRegistry } from '#/web/hooks/useOverlayRegistry.ts'
export const APP_OVERLAY_KEYS = ['clone', 'openWorkspace', 'openRemoteWorkspace'] as const
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

  const openWorkspacePathDialog = useCallback(() => {
    if (routeDriven) {
      onRouteOverlayChange?.('openWorkspace')
      return
    }
    open('openWorkspace')
  }, [onRouteOverlayChange, open, routeDriven])

  const setOpenWorkspaceOpen = useCallback(
    (open: boolean) => {
      if (routeDriven) {
        onRouteOverlayChange?.(open ? 'openWorkspace' : routeOverlay === 'openWorkspace' ? null : routeOverlay)
        return
      }
      setOpen('openWorkspace', open)
    },
    [onRouteOverlayChange, routeDriven, routeOverlay, setOpen],
  )

  const openRemoteWorkspace = useCallback(() => {
    if (routeDriven) {
      onRouteOverlayChange?.('openRemoteWorkspace')
      return
    }
    open('openRemoteWorkspace')
  }, [onRouteOverlayChange, open, routeDriven])

  const setOpenRemoteWorkspaceOpen = useCallback(
    (open: boolean) => {
      if (routeDriven) {
        onRouteOverlayChange?.(open ? 'openRemoteWorkspace' : routeOverlay === 'openRemoteWorkspace' ? null : routeOverlay)
        return
      }
      setOpen('openRemoteWorkspace', open)
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
      openWorkspace: { open: routeDriven ? routeOverlay === 'openWorkspace' : openByKey.openWorkspace },
      openRemoteWorkspace: {
        open: routeDriven ? routeOverlay === 'openRemoteWorkspace' : openByKey.openRemoteWorkspace,
      },
    }),
    [openByKey.clone, openByKey.openWorkspace, openByKey.openRemoteWorkspace, routeDriven, routeOverlay],
  )
  const anyOverlayOpen = state.clone.open || state.openWorkspace.open || state.openRemoteWorkspace.open

  return {
    state,
    anyOpen: anyOverlayOpen,
    openCloneRepo,
    setCloneOpen,
    openWorkspacePathDialog,
    setOpenWorkspaceOpen,
    openRemoteWorkspace,
    setOpenRemoteWorkspaceOpen,
    closeAllOverlays,
  }
}
