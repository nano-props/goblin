import { useEffect, useRef } from 'react'
import { useReposStore } from '#/renderer/stores/repos/store.ts'
import { isShortcutBlockingLayerOpen } from '#/renderer/lib/layers.ts'
import { onRpcEventType } from '#/renderer/rpc.ts'
import { isTerminalFocused } from '#/renderer/terminal-focus.ts'
import { useT } from '#/renderer/stores/i18n.ts'
import { openRepoFromDialog } from '#/renderer/lib/open-repo-dialog.ts'

interface MenuActionHandlers {
  closeAllOverlays: () => void
  openRepoPathDialog: () => void
  openCloneRepo: () => void
  openRemoteRepo: () => void
  isOverlayOpen: () => boolean
}

export function useMenuActions({ closeAllOverlays, openRepoPathDialog, openCloneRepo, openRemoteRepo, isOverlayOpen }: MenuActionHandlers) {
  const syncAndRefresh = useReposStore((s) => s.syncAndRefresh)
  const closeRepo = useReposStore((s) => s.closeRepo)
  const cycleActive = useReposStore((s) => s.cycleActive)
  const setDetailTab = useReposStore((s) => s.setDetailTab)
  const setDetailCollapsed = useReposStore((s) => s.setDetailCollapsed)
  const setWorkspaceLayout = useReposStore((s) => s.setWorkspaceLayout)
  const toggleDetailCollapsed = useReposStore((s) => s.toggleDetailCollapsed)
  const resetLayout = useReposStore((s) => s.resetLayout)
  const t = useT()
  const isOverlayOpenRef = useRef(isOverlayOpen)
  isOverlayOpenRef.current = isOverlayOpen

  useEffect(() => {
    const offBellClick = onRpcEventType('terminal-bell-click', (event) => {
      const state = useReposStore.getState()
      // repo.id is the absolute repoRoot path
      const repo = state.repos[event.repoRoot]
      if (!repo) return
      // Notification clicks are high-priority navigation: close any open
      // overlay and switch straight to the terminal tab.
      closeAllOverlays()
      state.setActive(repo.id)
      setDetailTab(repo.id, 'terminal')
      setDetailCollapsed(false)
    })
    return offBellClick
  }, [closeAllOverlays, setDetailCollapsed, setDetailTab])

  useEffect(() => {
    const off = onRpcEventType('menu-action', async (event) => {
      try {
        const { action } = event
        if (typeof action === 'object') {
          if (action.type === 'set-workspace-layout') {
            // Workspace layout is an app-level view preference, not an
            // in-modal action. Keep native menu layout changes available
            // even when a settings/help/dialog layer is open.
            setWorkspaceLayout(action.layout)
            return
          }
          if (isOverlayOpenRef.current() || isShortcutBlockingLayerOpen()) return
          const state = useReposStore.getState()
          switch (action.type) {
            case 'open-recent-repo':
              await state.openRepo(action.path)
              break
          }
          return
        }
        if (action === 'reset-layout') {
          // Same app-level view preference as set-workspace-layout above.
          resetLayout()
          return
        }
        if (isOverlayOpenRef.current() || isShortcutBlockingLayerOpen()) return
        const state = useReposStore.getState()
        switch (action) {
          case 'open-repo':
            await openRepoFromDialog({ openRepo: state.openRepo, t })
            break
          case 'open-repo-path':
            openRepoPathDialog()
            break
          case 'clone-repo':
            openCloneRepo()
            break
          case 'open-remote-repo':
            openRemoteRepo()
            break
          case 'close-repo': {
            if (state.activeId) closeRepo(state.activeId)
            else window.close()
            break
          }
          case 'next-repo':
            cycleActive(1)
            break
          case 'prev-repo':
            cycleActive(-1)
            break
          case 'refresh':
            if (isTerminalFocused()) break
            if (state.activeId) {
              const repo = state.repos[state.activeId]
              if (repo) await syncAndRefresh(repo.id, { token: repo.instanceToken })
            }
            break
          case 'tab-status':
            if (state.activeId) {
              setDetailTab(state.activeId, 'status')
              setDetailCollapsed(false)
            }
            break
          case 'tab-changes':
            if (state.activeId) {
              setDetailTab(state.activeId, 'changes')
              setDetailCollapsed(false)
            }
            break
          case 'tab-log':
            if (state.activeId) {
              setDetailTab(state.activeId, 'commits')
              setDetailCollapsed(false)
            }
            break
          case 'tab-terminal':
            if (state.activeId) {
              setDetailTab(state.activeId, 'terminal')
              setDetailCollapsed(false)
            }
            break
          case 'toggle-detail':
            // Match VS Code: Cmd+J toggles the panel even while the integrated terminal owns focus.
            if (state.activeId) toggleDetailCollapsed()
            break
        }
      } catch (err) {
        console.warn('[menu] action failed', err)
      }
    })
    return off
  }, [
    closeRepo,
    cycleActive,
    openRepoPathDialog,
    openCloneRepo,
    openRemoteRepo,
    resetLayout,
    setDetailCollapsed,
    setDetailTab,
    setWorkspaceLayout,
    syncAndRefresh,
    t,
    toggleDetailCollapsed,
  ])
}
