import { useCallback, useMemo } from 'react'
import { useOverlayRegistry } from '#/web/hooks/useOverlayRegistry.ts'
export const APP_OVERLAY_KEYS = ['clone', 'openRepo', 'openRemoteRepo', 'createWorktree'] as const
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
  const { anyOpen, closeAll, open, setOpen, state: openByKey } = registry
  const routeOverlay = options.routeOverlay ?? null
  const routeDriven = typeof options.onRouteOverlayChange === 'function'

  const openCloneRepo = useCallback(() => {
    if (routeDriven) {
      options.onRouteOverlayChange?.('clone')
      return
    }
    open('clone')
  }, [open, options, routeDriven])

  const setCloneOpen = useCallback(
    (open: boolean) => {
      if (routeDriven) {
        options.onRouteOverlayChange?.(open ? 'clone' : routeOverlay === 'clone' ? null : routeOverlay)
        return
      }
      setOpen('clone', open)
    },
    [options, routeDriven, routeOverlay, setOpen],
  )

  const openRepoPathDialog = useCallback(() => {
    if (routeDriven) {
      options.onRouteOverlayChange?.('openRepo')
      return
    }
    open('openRepo')
  }, [open, options, routeDriven])

  const setOpenRepoOpen = useCallback(
    (open: boolean) => {
      if (routeDriven) {
        options.onRouteOverlayChange?.(open ? 'openRepo' : routeOverlay === 'openRepo' ? null : routeOverlay)
        return
      }
      setOpen('openRepo', open)
    },
    [options, routeDriven, routeOverlay, setOpen],
  )

  const openRemoteRepo = useCallback(() => {
    if (routeDriven) {
      options.onRouteOverlayChange?.('openRemoteRepo')
      return
    }
    open('openRemoteRepo')
  }, [open, options, routeDriven])

  const setOpenRemoteRepoOpen = useCallback(
    (open: boolean) => {
      if (routeDriven) {
        options.onRouteOverlayChange?.(
          open ? 'openRemoteRepo' : routeOverlay === 'openRemoteRepo' ? null : routeOverlay,
        )
        return
      }
      setOpen('openRemoteRepo', open)
    },
    [options, routeDriven, routeOverlay, setOpen],
  )

  const openCreateWorktree = useCallback(() => {
    if (routeDriven) {
      options.onRouteOverlayChange?.('createWorktree')
      return
    }
    open('createWorktree')
  }, [open, options, routeDriven])

  const setCreateWorktreeOpen = useCallback(
    (open: boolean) => {
      if (routeDriven) {
        options.onRouteOverlayChange?.(
          open ? 'createWorktree' : routeOverlay === 'createWorktree' ? null : routeOverlay,
        )
        return
      }
      setOpen('createWorktree', open)
    },
    [options, routeDriven, routeOverlay, setOpen],
  )

  const closeAllOverlays = useCallback(() => {
    if (routeDriven) {
      options.onRouteOverlayChange?.(null)
      return
    }
    closeAll()
  }, [closeAll, options, routeDriven])

  const state = useMemo(
    () => ({
      clone: { open: routeDriven ? routeOverlay === 'clone' : openByKey.clone },
      openRepo: { open: routeDriven ? routeOverlay === 'openRepo' : openByKey.openRepo },
      openRemoteRepo: {
        open: routeDriven ? routeOverlay === 'openRemoteRepo' : openByKey.openRemoteRepo,
      },
      createWorktree: { open: routeDriven ? routeOverlay === 'createWorktree' : openByKey.createWorktree },
    }),
    [
      openByKey.clone,
      openByKey.openRepo,
      openByKey.openRemoteRepo,
      openByKey.createWorktree,
      routeDriven,
      routeOverlay,
    ],
  )

  return {
    state,
    anyOpen: routeDriven ? routeOverlay !== null : anyOpen,
    openCloneRepo,
    setCloneOpen,
    openRepoPathDialog,
    setOpenRepoOpen,
    openRemoteRepo,
    setOpenRemoteRepoOpen,
    openCreateWorktree,
    setCreateWorktreeOpen,
    closeAllOverlays,
  }
}