import { useEffect, useRef } from 'react'
import { useReposStore } from '#/renderer/stores/repos/store.ts'
import { isShortcutBlockingLayerOpen } from '#/renderer/lib/layers.ts'
import { onRpcEventType, rpc } from '#/renderer/rpc.ts'
import { isTerminalFocused } from '#/renderer/terminal-focus.ts'
import type { SettingsPage } from '#/renderer/components/SettingsPanel.tsx'

interface MenuActionHandlers {
  openSettings: (page?: SettingsPage) => void
  openCloneRepo: () => void
  showHelp: () => void
  isOverlayOpen: () => boolean
}

export function useMenuActions({ openSettings, openCloneRepo, showHelp, isOverlayOpen }: MenuActionHandlers) {
  const syncAndRefresh = useReposStore((s) => s.syncAndRefresh)
  const closeRepo = useReposStore((s) => s.closeRepo)
  const cycleActive = useReposStore((s) => s.cycleActive)
  const setDetailTab = useReposStore((s) => s.setDetailTab)
  const setDetailCollapsed = useReposStore((s) => s.setDetailCollapsed)
  const setWorkspaceLayout = useReposStore((s) => s.setWorkspaceLayout)
  const toggleDetailCollapsed = useReposStore((s) => s.toggleDetailCollapsed)
  const resetLayout = useReposStore((s) => s.resetLayout)
  const isOverlayOpenRef = useRef(isOverlayOpen)
  isOverlayOpenRef.current = isOverlayOpen

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
        // Settings / about navigate inside the settings overlay, so they
        // must work even when the overlay is already open (e.g. the user
        // clicks "About Goblin" while on the General tab).
        if (action === 'open-settings') {
          openSettings()
          return
        }
        if (action === 'open-about') {
          openSettings('about')
          return
        }
        if (isOverlayOpenRef.current() || isShortcutBlockingLayerOpen()) return
        const state = useReposStore.getState()
        switch (action) {
          case 'open-repo': {
            const path = await rpc.repo.openDialog.mutate()
            if (path) await state.openRepo(path)
            break
          }
          case 'clone-repo':
            openCloneRepo()
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
          case 'show-help':
            showHelp()
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
    openCloneRepo,
    openSettings,
    resetLayout,
    setDetailCollapsed,
    setDetailTab,
    setWorkspaceLayout,
    showHelp,
    syncAndRefresh,
    toggleDetailCollapsed,
  ])
}
