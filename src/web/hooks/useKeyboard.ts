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

import { onScopeDispose, toValue } from 'vue'
import type { MaybeRefOrGetter } from 'vue'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'
import { uiTransitionStore } from '#/web/stores/ui-transition.ts'
import { branchViewModeForWorkspace } from '#/web/stores/workspaces/branch-view-mode.ts'
import { isShortcutBlockingLayerOpen } from '#/web/lib/layers.ts'
import { runBranchActionShortcut } from '#/web/keyboard/branch-action-shortcuts.ts'
import { matchClientKeyboardShortcut } from '#/shared/shortcut-definitions.ts'
import { terminalHasKeyboardFocus } from '#/web/terminal-focus.ts'
import type { AppNavigationActions } from '#/web/app-navigation-actions.ts'
import type { WorkspaceState } from '#/web/stores/workspaces/types.ts'
import type { BranchViewMode } from '#/shared/api-types.ts'
import { gitBranchPaneTargetLease, gitWorktreePaneTargetLease } from '#/web/workspace-pane/workspace-pane-tab-target.ts'
import { getRuntimeShortcutSettings } from '#/web/runtime-settings-shortcuts.ts'
import { keyboardRuntimeStateFromStore } from '#/web/stores/workspaces/selector-state.ts'
import {
  runCloseCurrentWorkspacePaneTabCommand,
  runMoveWorkspacePaneTabCommand,
  runNewTerminalTabCommand,
  runSelectWorkspacePaneTabByIndexCommand,
} from '#/web/commands/workspace-commands.ts'
import { getClientBridge } from '#/web/client-bridge.ts'
import { translate } from '#/web/stores/i18n-vue.ts'
import { toast } from 'vue-sonner'
import { getRepoOperationsQueryData, getRepoSnapshotQueryData } from '#/web/repo-query-cache.ts'
import {
  workspacePaneCommandCoordinates,
  type WorkspacePaneCommandTarget,
} from '#/web/workspace-pane/workspace-pane-command-target.ts'
import { projectBranchActionOperation } from '#/web/hooks/branch-action-state.ts'
import { workspaceTerminalAvailable, workspaceWorktreesAvailable } from '#/shared/workspace-runtime.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { workspaceCanExecute } from '#/web/stores/workspaces/workspace-guards.ts'
import {
  gitWorkspaceNavigatorRowMatchesIdentity,
  gitWorkspaceNavigatorRows,
  type GitWorkspaceNavigatorRowIdentity,
} from '#/web/components/workspace-navigator/git-workspace-navigator-model.ts'
type MoveDirection = 1 | -1
const INTERACTIVE_SHORTCUT_TARGET_SELECTOR =
  'button,a,input,textarea,select,[role="button"],[role="tab"],[role="menuitem"],[data-interactive]'

interface Options {
  navigation: MaybeRefOrGetter<AppNavigationActions>
  currentWorkspaceId: MaybeRefOrGetter<WorkspaceId | null>
  currentBranchName?: MaybeRefOrGetter<string | null>
  currentGitWorkspaceNavigatorRowIdentity: MaybeRefOrGetter<GitWorkspaceNavigatorRowIdentity | null>
  currentWorkspacePaneCommandTarget: MaybeRefOrGetter<WorkspacePaneCommandTarget | null>
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

function workspaceHistoryNavigationDirection(event: KeyboardEvent): MoveDirection | 0 {
  if (event.altKey && !event.metaKey && !event.ctrlKey && !event.shiftKey) {
    if (event.code === 'ArrowLeft') return -1
    if (event.code === 'ArrowRight') return 1
    return 0
  }
  if (macPrimaryModifierPressed(event) && !event.altKey && !event.shiftKey) {
    if (event.code === 'BracketLeft') return -1
    if (event.code === 'BracketRight') return 1
  }
  return 0
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

function moveGitWorkspaceNavigatorSelection(
  input: {
    repo: Pick<WorkspaceState, 'id' | 'workspaceRuntimeId'>
    viewMode: BranchViewMode
    currentRow: GitWorkspaceNavigatorRowIdentity | null
  },
  direction: MoveDirection,
  navigation: AppNavigationActions,
): boolean {
  const branchModel = getRepoSnapshotQueryData(input.repo.id, input.repo.workspaceRuntimeId)
  if (!branchModel) return false
  const rows = gitWorkspaceNavigatorRows({
    branches: branchModel.branches,
    worktrees: branchModel.worktrees,
    viewMode: input.viewMode,
  })
  if (rows.length === 0) return false
  const currentRow = input.currentRow
  const index = currentRow ? rows.findIndex((row) => gitWorkspaceNavigatorRowMatchesIdentity(row, currentRow)) : -1
  if (currentRow && index < 0) return false
  const next = rows[nextIndex(index, rows.length, direction)]
  if (!next) return false
  if (next.kind === 'branch') {
    navigation.selectRepoBranch(
      gitBranchPaneTargetLease(input.repo.id, input.repo.workspaceRuntimeId, next.branch.name),
    )
  } else
    navigation.selectRepoWorktree(
      gitWorktreePaneTargetLease(input.repo.id, input.repo.workspaceRuntimeId, next.worktree.path),
    )
  return true
}

export function useKeyboard(options: Options) {
  const onKey = (e: KeyboardEvent) => {
    if (e.defaultPrevented) return
    if (getRuntimeShortcutSettings().shortcutsDisabled) return
    const navigation = toValue(options.navigation)
    const settingsOpen = options.isSettingsOpen()
    const compactWorkspaceTransitioning = uiTransitionStore.getState().isCompactWorkspaceTransitioning
    const workspaceShortcutsSuppressed =
      options.isWorkspaceShortcutSuppressed() || isShortcutBlockingLayerOpen() || compactWorkspaceTransitioning
    const action = matchClientKeyboardShortcut(e)

    if (settingsOpen && action === 'dismiss') {
      e.preventDefault()
      options.onExitSettings()
      return
    }

    if (!workspaceShortcutsSuppressed && !isTypingTarget(e.target)) {
      const workspaceId = toValue(options.currentWorkspaceId)
      const navigationDirection = workspaceHistoryNavigationDirection(e)
      if (workspaceId && navigationDirection !== 0) {
        e.preventDefault()
        if (navigationDirection === -1) navigation.goBack(workspaceId)
        else navigation.goForward(workspaceId)
        return
      }
    }

    if (primaryModifierPressed(e) && !e.altKey) {
      const workspaceId = toValue(options.currentWorkspaceId)
      const paneTarget = toValue(options.currentWorkspacePaneCommandTarget)
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
        const workspace = workspaceId ? workspacesStore.getState().workspaces[workspaceId] : null
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
        const repo = workspaceId ? workspacesStore.getState().workspaces[workspaceId] : null
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
          options.openCreateWorktree()
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

    const state = workspacesStore.getState()
    const keyboardState = keyboardRuntimeStateFromStore(state, toValue(options.currentWorkspaceId))
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
        options.onShowHelp()
        break
      }
      case 'pull':
      case 'push': {
        if (overlayOpen || !repo || !toValue(options.currentBranchName)) break
        e.preventDefault()
        runBranchActionShortcut(action)
        break
      }
      case 'next-branch': {
        if (overlayOpen || !repo || repo.capability.kind !== 'git') break
        if (
          moveGitWorkspaceNavigatorSelection(
            {
              repo,
              viewMode: branchViewModeForWorkspace(workspacesStore.getState().branchViewModeByWorkspace, repo.id),
              currentRow: toValue(options.currentGitWorkspaceNavigatorRowIdentity),
            },
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
          moveGitWorkspaceNavigatorSelection(
            {
              repo,
              viewMode: branchViewModeForWorkspace(workspacesStore.getState().branchViewModeByWorkspace, repo.id),
              currentRow: toValue(options.currentGitWorkspaceNavigatorRowIdentity),
            },
            -1,
            navigation,
          )
        )
          e.preventDefault()
        break
      }
      case 'next-workspace-pane-tab':
      case 'prev-workspace-pane-tab': {
        const paneTarget = toValue(options.currentWorkspacePaneCommandTarget)
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
  onScopeDispose(() => window.removeEventListener('keydown', onKey, { capture: true }))
}
