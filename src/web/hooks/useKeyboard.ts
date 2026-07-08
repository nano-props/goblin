// Global keyboard shortcuts. Mounted once in App.tsx — all bindings
// live here so adding/removing one is a single-file change.
//
// Shortcuts wired through the Electron application menu are forwarded
// as typed IPC events. Numbered workspace tab shortcuts are handled
// here in the capture phase so terminal focus cannot swallow them;
// Cmd/Ctrl+T (new terminal tab), Cmd/Ctrl+N (create worktree) and
// Cmd/Ctrl+W (close workspace tab or window) use this DOM path only in
// the web runtime.
//
// Modal awareness: when an overlay/dialog/menu is open every shortcut
// is suppressed — including `?`, otherwise pressing it with Settings
// open would stack the Help modal on top.

import { useEffect, useRef } from 'react'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { useUiTransitionStore } from '#/web/stores/ui-transition.ts'
import { visibleBranches } from '#/web/stores/repos/branch-view-mode.ts'
import { isShortcutBlockingLayerOpen } from '#/web/lib/layers.ts'
import { runBranchActionShortcut } from '#/web/keyboard/branch-action-shortcuts.ts'
import { matchClientKeyboardShortcut } from '#/shared/shortcut-definitions.ts'
import { isTerminalFocused } from '#/web/terminal-focus.ts'
import type { PrimaryWindowNavigationActions } from '#/web/primary-window-navigation.tsx'
import type { RepoState } from '#/web/stores/repos/types.ts'
import { getRuntimeShortcutSettings } from '#/web/runtime-settings-shortcuts.ts'
import { keyboardRuntimeStateFromStore } from '#/web/stores/repos/selector-state.ts'
import {
  runCloseWorkspacePaneTabOrWindowCommand,
  runMoveWorkspacePaneTabCommand,
  runNewTerminalTabCommand,
  runSelectWorkspacePaneTabByIndexCommand,
} from '#/web/commands/workspace-commands.ts'
import { getClientBridge } from '#/web/client-bridge.ts'
import { translate } from '#/web/stores/i18n.ts'
import { toast } from 'sonner'
import { readRepoBranchQueryProjection } from '#/web/repo-branch-read-model.ts'
import type { RepoBranchWorkspacePaneRoute } from '#/web/App.tsx'
import { getRepoOperationsQueryData } from '#/web/repo-data-query.ts'
import { projectBranchActionOperation } from '#/web/hooks/branch-action-state.ts'

type MoveDirection = 1 | -1
const INTERACTIVE_SHORTCUT_TARGET_SELECTOR =
  'button,a,input,textarea,select,[role="button"],[role="tab"],[role="menuitem"],[data-interactive]'

interface Options {
  navigation: PrimaryWindowNavigationActions
  currentRepoId: string | null
  currentBranchName?: string | null
  currentWorkspacePaneRoute?: RepoBranchWorkspacePaneRoute | null
  onShowHelp: () => void
  /** Returns true when workspace shortcuts should not affect the repo view. */
  isWorkspaceShortcutSuppressed: () => boolean
  isSettingsOpen: () => boolean
  onExitSettings: () => void
  openCreateWorktree: () => void
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(INTERACTIVE_SHORTCUT_TARGET_SELECTOR) !== null
}

function activeElement(): HTMLElement | null {
  return document.activeElement instanceof HTMLElement ? document.activeElement : null
}

function primaryModifierPressed(event: KeyboardEvent): boolean {
  const isMac = /\bMac|iPhone|iPad|iPod/.test(globalThis.navigator?.platform ?? '')
  return isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey
}

function macPrimaryModifierPressed(event: KeyboardEvent): boolean {
  return /\bMac|iPhone|iPad|iPod/.test(globalThis.navigator?.platform ?? '') && event.metaKey && !event.ctrlKey
}

function digitShortcutIndex(event: KeyboardEvent): number | null {
  if (!/^Digit[1-9]$/.test(event.code)) return null
  return Number(event.code.slice('Digit'.length))
}

function hasNativeMenuAccelerators(): boolean {
  try {
    return getClientBridge().kind() === 'electron'
  } catch {
    return false
  }
}

function nextIndex(current: number, length: number, direction: MoveDirection): number {
  if (direction === 1) return Math.min(length - 1, current < 0 ? 0 : current + 1)
  return Math.max(0, current < 0 ? 0 : current - 1)
}

function moveBranchSelection(
  input: {
    repo: RepoState
    currentBranchName: string | null
  },
  direction: MoveDirection,
  navigation: PrimaryWindowNavigationActions,
): boolean {
  const branchModel = readRepoBranchQueryProjection(input.repo)
  if (!branchModel) return false
  const branches = visibleBranches({
    branches: branchModel.branches,
    viewMode: input.repo.ui.branchViewMode,
  })
  if (branches.length === 0) return false
  const index = branches.findIndex((branch) => branch.name === input.currentBranchName)
  const next = branches[nextIndex(index, branches.length, direction)]
  if (!next) return false
  navigation.selectRepoBranch(input.repo.id, next.name)
  return true
}

export function useKeyboard({
  navigation,
  currentRepoId,
  currentBranchName = null,
  currentWorkspacePaneRoute,
  onShowHelp,
  isWorkspaceShortcutSuppressed,
  isSettingsOpen,
  onExitSettings,
  openCreateWorktree,
}: Options) {
  // Stash the latest closures in refs so the effect deps can be `[]` —
  // otherwise React adds + removes the window listener on every App
  // render (both options are recreated each render).
  const onShowHelpRef = useRef(onShowHelp)
  const isWorkspaceShortcutSuppressedRef = useRef(isWorkspaceShortcutSuppressed)
  const isSettingsOpenRef = useRef(isSettingsOpen)
  const onExitSettingsRef = useRef(onExitSettings)
  const currentRepoIdRef = useRef(currentRepoId)
  const currentBranchNameRef = useRef(currentBranchName)
  const currentWorkspacePaneRouteRef = useRef(currentWorkspacePaneRoute)
  const openCreateWorktreeRef = useRef(openCreateWorktree)
  onShowHelpRef.current = onShowHelp
  isWorkspaceShortcutSuppressedRef.current = isWorkspaceShortcutSuppressed
  isSettingsOpenRef.current = isSettingsOpen
  onExitSettingsRef.current = onExitSettings
  currentRepoIdRef.current = currentRepoId
  currentBranchNameRef.current = currentBranchName
  currentWorkspacePaneRouteRef.current = currentWorkspacePaneRoute
  openCreateWorktreeRef.current = openCreateWorktree

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return
      if (getRuntimeShortcutSettings().shortcutsDisabled) return
      const settingsOpen = isSettingsOpenRef.current()
      const compactWorkspaceTransitioning = useUiTransitionStore.getState().isCompactWorkspaceTransitioning
      const workspaceShortcutsSuppressed =
        isWorkspaceShortcutSuppressedRef.current() || isShortcutBlockingLayerOpen() || compactWorkspaceTransitioning
      const action = matchClientKeyboardShortcut(e)

      if (settingsOpen && action === 'dismiss') {
        e.preventDefault()
        onExitSettingsRef.current()
        return
      }

      if (!workspaceShortcutsSuppressed && !isTypingTarget(e.target)) {
        const repoId = currentRepoIdRef.current
        const navigationDirection =
          e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey && e.code === 'ArrowLeft'
            ? -1
            : e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey && e.code === 'ArrowRight'
              ? 1
              : macPrimaryModifierPressed(e) && !e.altKey && !e.shiftKey && e.code === 'BracketLeft'
                ? -1
                : macPrimaryModifierPressed(e) && !e.altKey && !e.shiftKey && e.code === 'BracketRight'
                  ? 1
                  : 0
        if (repoId && navigationDirection !== 0) {
          e.preventDefault()
          if (navigationDirection === -1) navigation.goBack(repoId)
          else navigation.goForward(repoId)
          return
        }
      }

      if (primaryModifierPressed(e) && !e.altKey && !workspaceShortcutsSuppressed) {
        const repoId = currentRepoIdRef.current
        const menuBackedShortcut = hasNativeMenuAccelerators()
        if (!menuBackedShortcut && !e.shiftKey && e.code === 'KeyT') {
          e.preventDefault()
          // Cmd+T is a generic entry → new terminal appends to the end.
          void runNewTerminalTabCommand({
            repoId,
            branchName: currentBranchNameRef.current,
            workspacePaneRoute: currentWorkspacePaneRouteRef.current,
            navigation,
            t: translate,
          })
          return
        }
        if (!menuBackedShortcut && !e.shiftKey && e.code === 'KeyN') {
          e.preventDefault()
          const repo = repoId ? useReposStore.getState().repos[repoId] : null
          if (!repo) return
          const branchAction = projectBranchActionOperation(
            repo.operations.branchAction,
            getRepoOperationsQueryData(repo.id, repo.repoRuntimeId)?.operations,
          )
          if (branchAction.phase === 'idle') {
            openCreateWorktreeRef.current()
          } else {
            toast.error(translate('action.create-worktree-busy'))
          }
          return
        }
        if (!menuBackedShortcut && !e.shiftKey && e.code === 'KeyW') {
          e.preventDefault()
          void runCloseWorkspacePaneTabOrWindowCommand({
            repoId,
            branchName: currentBranchNameRef.current,
            workspacePaneRoute: currentWorkspacePaneRouteRef.current,
            navigation,
          })
          return
        }
        const tabIndex = !e.shiftKey ? digitShortcutIndex(e) : null
        if (tabIndex !== null) {
          if (
            runSelectWorkspacePaneTabByIndexCommand({
              repoId,
              branchName: currentBranchNameRef.current,
              workspacePaneRoute: currentWorkspacePaneRouteRef.current,
              tabIndex,
              navigation,
            })
          )
            e.preventDefault()
          return
        }
      }

      if (isTerminalFocused()) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (isTypingTarget(e.target)) return

      const state = useReposStore.getState()
      const keyboardState = keyboardRuntimeStateFromStore(state, currentRepoIdRef.current)
      const repo = keyboardState.repo
      const overlayOpen = workspaceShortcutsSuppressed
      const interactiveTarget = isInteractiveTarget(e.target)

      if (action === 'dismiss') {
        if (overlayOpen) return
        const active = activeElement()
        if (!active || active === document.body || active === document.documentElement) return
        e.preventDefault()
        active.blur()
        return
      }

      if (interactiveTarget) return

      switch (action) {
        case 'show-help': {
          if (overlayOpen) break
          e.preventDefault()
          onShowHelpRef.current()
          break
        }
        case 'pull':
        case 'push': {
          if (overlayOpen || !repo || !currentBranchNameRef.current) break
          e.preventDefault()
          runBranchActionShortcut(action)
          break
        }
        case 'next-branch': {
          if (overlayOpen || !repo) break
          if (moveBranchSelection({ repo, currentBranchName: currentBranchNameRef.current }, 1, navigation))
            e.preventDefault()
          break
        }
        case 'prev-branch': {
          if (overlayOpen || !repo) break
          if (moveBranchSelection({ repo, currentBranchName: currentBranchNameRef.current }, -1, navigation))
            e.preventDefault()
          break
        }
        case 'next-workspace-pane-tab':
        case 'prev-workspace-pane-tab': {
          if (overlayOpen || !repo || !currentBranchNameRef.current) break
          if (
            runMoveWorkspacePaneTabCommand({
              repoId: repo.id,
              branchName: currentBranchNameRef.current,
              workspacePaneRoute: currentWorkspacePaneRouteRef.current,
              direction: action === 'next-workspace-pane-tab' ? 1 : -1,
              navigation,
            })
          ) {
            e.preventDefault()
          }
          break
        }
      }
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
  }, [navigation])
}
