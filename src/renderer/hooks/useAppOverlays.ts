import { useCallback, useMemo } from 'react'
import { useOverlayRegistry } from '#/renderer/hooks/useOverlayRegistry.ts'

const APP_OVERLAY_KEYS = ['clone', 'openRepo', 'openRemoteRepo'] as const
type AppOverlayKey = (typeof APP_OVERLAY_KEYS)[number]

export function useAppOverlays() {
  // App-level orchestration layer: compose the generic open/close registry with
  // any overlay-specific payload (such as settingsPage). New app overlays
  // should usually be wired here rather than expanding useOverlayRegistry.
  const registry = useOverlayRegistry<AppOverlayKey>(APP_OVERLAY_KEYS)
  const { anyOpen, closeAll, open, setOpen, state: openByKey } = registry

  const openCloneRepo = useCallback(() => {
    open('clone')
  }, [open])

  const setCloneOpen = useCallback((open: boolean) => {
    setOpen('clone', open)
  }, [setOpen])

  const openRepoPathDialog = useCallback(() => {
    open('openRepo')
  }, [open])

  const setOpenRepoOpen = useCallback((open: boolean) => {
    setOpen('openRepo', open)
  }, [setOpen])

  const openRemoteRepo = useCallback(() => {
    open('openRemoteRepo')
  }, [open])

  const setOpenRemoteRepoOpen = useCallback((open: boolean) => {
    setOpen('openRemoteRepo', open)
  }, [setOpen])

  const closeAllOverlays = useCallback(() => {
    closeAll()
  }, [closeAll])

  const state = useMemo(() => ({
    clone: { open: openByKey.clone },
    openRepo: { open: openByKey.openRepo },
    openRemoteRepo: { open: openByKey.openRemoteRepo },
  }), [openByKey.clone, openByKey.openRepo, openByKey.openRemoteRepo])

  return {
    state,
    anyOpen,
    openCloneRepo,
    setCloneOpen,
    openRepoPathDialog,
    setOpenRepoOpen,
    openRemoteRepo,
    setOpenRemoteRepoOpen,
    closeAllOverlays,
  }
}
