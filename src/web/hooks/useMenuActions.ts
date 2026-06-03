import { useEffect, useRef } from 'react'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { isShortcutBlockingLayerOpen } from '#/web/lib/layers.ts'
import { onRendererLocalEventType } from '#/web/local-events.ts'
import { onNativeEventType } from '#/web/native-bridge.ts'
import { isTerminalFocused } from '#/web/terminal-focus.ts'
import { runRepoRefreshIntent } from '#/web/stores/repos/refresh-coordinator.ts'
import { useT } from '#/web/stores/i18n.ts'
import { openRepoFromDialog } from '#/web/lib/open-repo-dialog.ts'
import { hasNativeDirectoryPicker } from '#/web/app-shell-client.ts'
import { parseTerminalSessionKey, worktreeTerminalKey } from '#/web/components/terminal/terminal-session-utils.ts'
import {
  runShowDetailTabCommand,
  runTerminalPrimaryActionCommand,
  runToggleDetailCommand,
} from '#/web/commands/workspace-commands.ts'
import type { MainWindowNavigationActions } from '#/web/main-window-navigation.tsx'
interface MenuActionHandlers {
  navigation: MainWindowNavigationActions
  currentRepoId: string | null
  closeAllOverlays: () => void
  openRepoPathDialog: () => void
  openCloneRepo: () => void
  openRemoteRepo: () => void
  isOverlayOpen: () => boolean
  isWorkspaceShortcutSuppressed: () => boolean
}

export function useMenuActions({
  navigation,
  currentRepoId,
  closeAllOverlays,
  openRepoPathDialog,
  openCloneRepo,
  openRemoteRepo,
  isOverlayOpen,
  isWorkspaceShortcutSuppressed,
}: MenuActionHandlers) {
  const setDetailCollapsed = useReposStore((s) => s.setDetailCollapsed)
  const setSelectedTerminal = useReposStore((s) => s.setSelectedTerminal)
  const setWorkspaceLayout = useReposStore((s) => s.setWorkspaceLayout)
  const toggleDetailCollapsed = useReposStore((s) => s.toggleDetailCollapsed)
  const resetLayout = useReposStore((s) => s.resetLayout)
  const t = useT()
  const isOverlayOpenRef = useRef(isOverlayOpen)
  const isWorkspaceShortcutSuppressedRef = useRef(isWorkspaceShortcutSuppressed)
  const currentRepoIdRef = useRef(currentRepoId)
  isOverlayOpenRef.current = isOverlayOpen
  isWorkspaceShortcutSuppressedRef.current = isWorkspaceShortcutSuppressed
  currentRepoIdRef.current = currentRepoId

  useEffect(() => {
    const handleBellClick = (event: { repoRoot: string; key?: string }) => {
      const state = useReposStore.getState()
      // repo.id is the absolute repoRoot path
      const repo = state.repos[event.repoRoot]
      if (!repo) return
      const parsedKey = event.key ? parseTerminalSessionKey(event.key) : null
      // Notification clicks are high-priority navigation: close any open
      // overlay and switch straight to the terminal tab.
      closeAllOverlays()
      if (parsedKey && parsedKey.repoRoot === repo.id && event.key) {
        setSelectedTerminal(worktreeTerminalKey(parsedKey.repoRoot, parsedKey.worktreePath), event.key)
        const branch = repo.data.branches.find((candidate) => candidate.worktree?.path === parsedKey.worktreePath)
        if (branch) {
          navigation.showRepoBranchDetailTab(repo.id, branch.name, 'terminal')
          setDetailCollapsed(false)
          return
        }
      }
      navigation.showRepoDetailTab(repo.id, 'terminal')
      setDetailCollapsed(false)
    }
    const offRpcBellClick = onNativeEventType('terminal-bell-click', handleBellClick)
    const offLocalBellClick = onRendererLocalEventType('terminal-bell-click', handleBellClick)
    return () => {
      offRpcBellClick()
      offLocalBellClick()
    }
  }, [closeAllOverlays, navigation, setDetailCollapsed, setSelectedTerminal])

  useEffect(() => {
    const off = onNativeEventType('menu-action', async (event) => {
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
          switch (action.type) {
            case 'open-settings':
              navigation.openSettings(action.page)
              return
            case 'open-recent-repo': {
              if (isOverlayOpenRef.current() || isShortcutBlockingLayerOpen()) return
              const state = useReposStore.getState()
              const result = await state.ensureWorkspaceOpen(action.entry)
              if (result.ok) navigation.activateRepo(result.id)
              break
            }
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
        const repoId = currentRepoIdRef.current
        switch (action) {
          case 'open-repo':
            if (!hasNativeDirectoryPicker()) {
              openRepoPathDialog()
              break
            }
            await openRepoFromDialog({
              ensureWorkspaceOpen: state.ensureWorkspaceOpen,
              activateRepo: navigation.activateRepo,
              openRepoPathDialog,
              t,
            })
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
            if (isWorkspaceShortcutSuppressedRef.current()) break
            if (repoId) navigation.closeRepo(repoId)
            else window.close()
            break
          }
          case 'next-repo':
            if (isWorkspaceShortcutSuppressedRef.current()) break
            navigation.cycleRepo(1)
            break
          case 'prev-repo':
            if (isWorkspaceShortcutSuppressedRef.current()) break
            navigation.cycleRepo(-1)
            break
          case 'refresh':
            if (isWorkspaceShortcutSuppressedRef.current()) break
            if (isTerminalFocused()) break
            if (repoId) {
              const repo = state.repos[repoId]
              if (repo) {
                await runRepoRefreshIntent(useReposStore.getState, {
                  kind: 'manual-refresh-requested',
                  id: repo.id,
                  token: repo.instanceToken,
                })
              }
            }
            break
          case 'tab-status':
            if (isWorkspaceShortcutSuppressedRef.current()) break
            runShowDetailTabCommand({ repoId, tab: 'status', navigation, setDetailCollapsed })
            break
          case 'tab-terminal':
            if (isWorkspaceShortcutSuppressedRef.current()) break
            runShowDetailTabCommand({ repoId, tab: 'terminal', navigation, setDetailCollapsed })
            break
          case 'terminal-primary-action':
            if (isWorkspaceShortcutSuppressedRef.current()) break
            await runTerminalPrimaryActionCommand({ repoId, navigation, setDetailCollapsed })
            break
          case 'toggle-detail':
            // Match VS Code: Cmd+J toggles the panel even while the integrated terminal owns focus.
            if (isWorkspaceShortcutSuppressedRef.current()) break
            runToggleDetailCommand({ repoId, toggleDetailCollapsed })
            break
        }
      } catch (err) {
        console.warn('[menu] action failed', err)
      }
    })
    return off
  }, [
    navigation,
    openRepoPathDialog,
    openCloneRepo,
    openRemoteRepo,
    resetLayout,
    isWorkspaceShortcutSuppressed,
    setDetailCollapsed,
    setWorkspaceLayout,
    t,
    toggleDetailCollapsed,
  ])
}
