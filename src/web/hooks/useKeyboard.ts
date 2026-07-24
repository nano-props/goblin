// Global keyboard shortcuts. Mounted once in App.tsx — all bindings
// live here so adding/removing one is a single-file change.
//
// Shortcuts wired through the Electron application menu are forwarded
// as typed IPC events. Numbered workspace tab shortcuts are handled
// here in the capture phase so terminal focus cannot swallow them;
// Cmd/Ctrl+T (new terminal tab), Cmd/Ctrl+N (create worktree) and
// Cmd/Ctrl+W (close workspace tab) use this DOM path only in
// the web runtime.
//
// Modal awareness: when an overlay/dialog/menu is open every shortcut
// is suppressed — including `?`, otherwise pressing it with Settings
// open would stack the Help modal on top.

import { useEffect, useRef } from 'react'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import { useUiTransitionStore } from '#/web/stores/ui-transition.ts'
import { visibleBranches } from '#/web/stores/workspaces/branch-view-mode.ts'
import { isShortcutBlockingLayerOpen } from '#/web/lib/layers.ts'
import { runBranchActionShortcut } from '#/web/keyboard/branch-action-shortcuts.ts'
import { matchClientKeyboardShortcut } from '#/shared/shortcut-definitions.ts'
import { terminalHasKeyboardFocus } from '#/web/terminal-focus.ts'
import type { PrimaryWindowNavigationActions } from '#/web/primary-window-navigation.tsx'
import type { WorkspaceState } from '#/web/stores/workspaces/types.ts'
import { getRuntimeShortcutSettings } from '#/web/runtime-settings-shortcuts.ts'
import { keyboardRuntimeStateFromStore } from '#/web/stores/workspaces/selector-state.ts'
import {
  runCloseCurrentWorkspacePaneTabCommand,
  runMoveWorkspacePaneTabCommand,
  runNewTerminalTabCommand,
  runSelectWorkspacePaneTabByIndexCommand,
} from '#/web/commands/workspace-commands.ts'
import { getClientBridge } from '#/web/client-bridge.ts'
import { translate } from '#/web/stores/i18n.ts'
import { toast } from 'sonner'
import { readSuccessfulRepoBranchSnapshotQueryProjection } from '#/web/repo-branch-read-model.ts'
import {
  workspacePaneCommandCoordinates,
  type WorkspacePaneCommandTarget,
} from '#/web/workspace-pane/workspace-pane-command-target.ts'
import { getRepoOperationsQueryData } from '#/web/repo-query-cache.ts'
import { projectBranchActionOperation } from '#/web/hooks/branch-action-state.ts'
import { workspaceTerminalAvailable, workspaceWorktreesAvailable } from '#/shared/workspace-runtime.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { workspaceCanExecute } from '#/web/stores/workspaces/workspace-guards.ts'

type MoveDirection = 1 | -1
const INTERACTIVE_SHORTCUT_TARGET_SELECTOR =
  'button,a,input,textarea,select,[role="button"],[role="tab"],[role="menuitem"],[data-interactive]'

interface Options {
  navigation: PrimaryWindowNavigationActions
  currentWorkspaceId: WorkspaceId | null
  currentBranchName?: string | null
  currentWorkspacePaneCommandTarget: WorkspacePaneCommandTarget | null
  onShowHelp: () => void
  /** Returns true when workspace shortcuts should not affect the workspace view. */
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
    repo: Pick<WorkspaceState, 'id' | 'workspaceRuntimeId'>
    git: Extract<WorkspaceState['capability'], { kind: 'git' }>['git']
    currentBranchName: string | null
  },
  direction: MoveDirection,
  navigation: PrimaryWindowNavigationActions,
): boolean {
  const branchModel = readSuccessfulRepoBranchSnapshotQueryProjection(input.repo)
  if (!branchModel) return false
  const branches = visibleBranches({
    branches: branchModel.branches,
    viewMode: input.git.ui.branchViewMode,
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
  currentWorkspaceId,
  currentBranchName = null,
  currentWorkspacePaneCommandTarget,
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
  const currentWorkspaceIdRef = useRef(currentWorkspaceId)
  const currentBranchNameRef = useRef(currentBranchName)
  const currentWorkspacePaneCommandTargetRef = useRef(currentWorkspacePaneCommandTarget)
  const openCreateWorktreeRef = useRef(openCreateWorktree)
  onShowHelpRef.current = onShowHelp
  isWorkspaceShortcutSuppressedRef.current = isWorkspaceShortcutSuppressed
  isSettingsOpenRef.current = isSettingsOpen
  onExitSettingsRef.current = onExitSettings
  currentWorkspaceIdRef.current = currentWorkspaceId
  currentBranchNameRef.current = currentBranchName
  currentWorkspacePaneCommandTargetRef.current = currentWorkspacePaneCommandTarget
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
        const workspaceId = currentWorkspaceIdRef.current
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
        if (workspaceId && navigationDirection !== 0) {
          e.preventDefault()
          if (navigationDirection === -1) navigation.goBack(workspaceId)
          else navigation.goForward(workspaceId)
          return
        }
      }

      if (primaryModifierPressed(e) && !e.altKey) {
        const workspaceId = currentWorkspaceIdRef.current
        const paneTarget = currentWorkspacePaneCommandTargetRef.current
        const menuBackedShortcut = hasNativeMenuAccelerators()
        const tabIndex = !e.shiftKey ? digitShortcutIndex(e) : null
        const rendererOwnedShortcut =
          tabIndex !== null ||
          (!menuBackedShortcut && !e.shiftKey && (e.code === 'KeyT' || e.code === 'KeyN' || e.code === 'KeyW'))
        if (rendererOwnedShortcut) {
          e.preventDefault()
          e.stopPropagation()
          if (workspaceShortcutsSuppressed) return
        }
        if (!menuBackedShortcut && !e.shiftKey && e.code === 'KeyT') {
          if (!paneTarget) return
          const workspace = workspaceId ? useWorkspacesStore.getState().workspaces[workspaceId] : null
          if (!workspace || !workspaceCanExecute(workspace) || !workspaceTerminalAvailable(workspace.capability.probe))
            return
          // Cmd+T is a generic entry → new terminal appends to the end.
          void runNewTerminalTabCommand({
            workspaceId,
            target: paneTarget,
            navigation,
            t: translate,
          })
          return
        }
        if (!menuBackedShortcut && !e.shiftKey && e.code === 'KeyN') {
          const repo = workspaceId ? useWorkspacesStore.getState().workspaces[workspaceId] : null
          if (
            !repo ||
            !workspaceCanExecute(repo) ||
            repo.capability.kind !== 'git' ||
            !workspaceWorktreesAvailable(repo.capability.probe)
          )
            return
          const branchAction = projectBranchActionOperation(
            repo.capability.git.operations.branchAction,
            getRepoOperationsQueryData(repo.id, repo.workspaceRuntimeId)?.operations,
          )
          if (branchAction.phase === 'idle') {
            openCreateWorktreeRef.current()
          } else {
            toast.error(translate('action.create-worktree-busy'))
          }
          return
        }
        if (!menuBackedShortcut && !e.shiftKey && e.code === 'KeyW') {
          if (!paneTarget) return
          void runCloseCurrentWorkspacePaneTabCommand({
            workspaceId,
            target: paneTarget,
            navigation,
          })
          return
        }
        if (tabIndex !== null) {
          if (!paneTarget) return
          void runSelectWorkspacePaneTabByIndexCommand({
            workspaceId,
            target: paneTarget,
            tabIndex,
            navigation,
          })
          return
        }
      }

      if (terminalHasKeyboardFocus()) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (isTypingTarget(e.target)) return

      const state = useWorkspacesStore.getState()
      const keyboardState = keyboardRuntimeStateFromStore(state, currentWorkspaceIdRef.current)
      const repo = keyboardState.workspace
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
          if (overlayOpen || !repo || repo.capability.kind !== 'git') break
          if (
            moveBranchSelection(
              { repo, git: repo.capability.git, currentBranchName: currentBranchNameRef.current },
              1,
              navigation,
            )
          )
            e.preventDefault()
          break
        }
        case 'prev-branch': {
          if (overlayOpen || !repo || repo.capability.kind !== 'git') break
          if (
            moveBranchSelection(
              { repo, git: repo.capability.git, currentBranchName: currentBranchNameRef.current },
              -1,
              navigation,
            )
          )
            e.preventDefault()
          break
        }
        case 'next-workspace-pane-tab':
        case 'prev-workspace-pane-tab': {
          const paneTarget = currentWorkspacePaneCommandTargetRef.current
          if (overlayOpen || !repo || !paneTarget) break
          e.preventDefault()
          void runMoveWorkspacePaneTabCommand({
            workspaceId: repo.id,
            target: paneTarget,
            direction: action === 'next-workspace-pane-tab' ? 1 : -1,
            navigation,
          })
          break
        }
      }
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
  }, [navigation])
}
