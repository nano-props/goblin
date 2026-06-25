import { useCallback, useMemo } from 'react'
import { useOverlayRegistry } from '#/web/hooks/useOverlayRegistry.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
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

  const openCreateWorktree = useCallback(() => {
    // The create-worktree dialog is repo-scoped — it has nothing to
    // render without an active repo. Guard against a future caller
    // (e.g. a command-palette entry) that invokes this without
    // `activeId` set, so we don't leave `state.createWorktree.open`
    // stuck `true` until a later `useEffect([activeId])` clears it.
    // Currently only active-repo chrome calls this, and that chrome
    // is itself hidden when no repo is active — this is a defensive
    // guard for future surface expansion.
    if (!useReposStore.getState().activeId) return
    if (routeDriven) {
      onRouteOverlayChange?.('createWorktree')
      return
    }
    open('createWorktree')
  }, [onRouteOverlayChange, open, routeDriven])

  const setCreateWorktreeOpen = useCallback(
    (open: boolean) => {
      if (routeDriven) {
        onRouteOverlayChange?.(open ? 'createWorktree' : routeOverlay === 'createWorktree' ? null : routeOverlay)
        return
      }
      setOpen('createWorktree', open)
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
