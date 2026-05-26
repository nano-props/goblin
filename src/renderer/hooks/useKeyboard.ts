// Global keyboard shortcuts. Mounted once in App.tsx — all bindings
// live here so adding/removing one is a single-file change.
//
// Shortcuts that are also wired through the application menu (⌘O,
// ⌘W, ⌘1/⌘2/⌘3, ⌘[ , ⌘]) are handled by Electron's accelerator system
// and forwarded as typed RPC events. We only handle the "no
// modifier" keys here (j/k/arrows/p/P/g/v/G/?/Enter/Esc) so we don't fight the menu.
//
// Modal awareness: when an overlay/dialog/menu is open every shortcut
// is suppressed — including `?`, otherwise pressing it with Settings
// open would stack the Help modal on top.

import { useEffect, useRef } from 'react'
import { useReposStore } from '#/renderer/stores/repos/store.ts'
import { branchForVisibleLog, visibleBranches } from '#/renderer/stores/repos/branch-view-mode.ts'
import { useSettingsStore } from '#/renderer/stores/settings.ts'
import { isShortcutBlockingLayerOpen } from '#/renderer/lib/layers.ts'
import { adjacentDetailTab } from '#/renderer/lib/detail-tabs.ts'
import { runBranchActionShortcut } from '#/renderer/keyboard/branch-action-shortcuts.ts'
import { isTerminalFocused } from '#/renderer/terminal-focus.ts'
import type { RepoState, ReposStore } from '#/renderer/stores/repos/types.ts'

type BranchShortcutAction = 'pull' | 'push' | 'terminal' | 'editor' | 'github'
type MoveDirection = 1 | -1
const INTERACTIVE_SHORTCUT_TARGET_SELECTOR =
  'button,a,input,textarea,select,[role="button"],[role="tab"],[role="menuitem"],[data-interactive]'

interface Options {
  onShowHelp: () => void
  /** Returns true when a Settings or Help modal is currently mounted. Commit detail is tab content. */
  isOverlayOpen: () => boolean
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

function branchShortcutAction(e: KeyboardEvent): BranchShortcutAction | null {
  if (e.code === 'KeyP') return e.shiftKey ? 'push' : 'pull'
  if (e.code === 'KeyG') return e.shiftKey ? 'github' : 'terminal'
  if (e.code === 'KeyV' && !e.shiftKey) return 'editor'
  return null
}

function nextIndex(current: number, length: number, direction: MoveDirection): number {
  if (direction === 1) return Math.min(length - 1, current < 0 ? 0 : current + 1)
  return Math.max(0, current < 0 ? 0 : current - 1)
}

function moveCommitSelection(state: ReposStore, repo: RepoState, direction: MoveDirection): boolean {
  const branch = branchForVisibleLog(repo)
  const branchLog = branch ? repo.data.logsByBranch[branch] : undefined
  if (!branch || !branchLog?.entries.length) return false
  const index = branchLog.entries.findIndex((commit) => commit.hash === branchLog.selectedHash)
  const next = branchLog.entries[nextIndex(index, branchLog.entries.length, direction)]
  if (!next) return false
  state.selectLog(repo.id, branch, next.hash)
  return true
}

function moveBranchSelection(state: ReposStore, repo: RepoState, direction: MoveDirection): boolean {
  const branches = visibleBranches({
    branches: repo.data.branches,
    viewMode: repo.ui.branchViewMode,
    searchQuery: state.branchSearchQueries[repo.id] ?? '',
  })
  if (branches.length === 0) return false
  const index = branches.findIndex((branch) => branch.name === repo.ui.selectedBranch)
  const next = branches[nextIndex(index, branches.length, direction)]
  if (!next) return false
  state.selectBranch(repo.id, next.name)
  return true
}

function moveSelection(
  state: ReposStore,
  repo: RepoState,
  commitListActive: boolean,
  direction: MoveDirection,
): boolean {
  return commitListActive ? moveCommitSelection(state, repo, direction) : moveBranchSelection(state, repo, direction)
}

export function useKeyboard({ onShowHelp, isOverlayOpen }: Options) {
  // Stash the latest closures in refs so the effect deps can be `[]` —
  // otherwise React adds + removes the window listener on every App
  // render (both options are recreated each render).
  const onShowHelpRef = useRef(onShowHelp)
  const isOverlayOpenRef = useRef(isOverlayOpen)
  onShowHelpRef.current = onShowHelp
  isOverlayOpenRef.current = isOverlayOpen

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return
      if (useSettingsStore.getState().shortcutsDisabled) return
      if (isTerminalFocused()) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (isTypingTarget(e.target)) return

      const state = useReposStore.getState()
      const repoId = state.activeId
      const repo = repoId ? state.repos[repoId] : null
      const overlayOpen = isOverlayOpenRef.current() || isShortcutBlockingLayerOpen()
      // Commit detail is commits-tab content, not a global overlay.
      const commitPaneActive = !!repo && repo.ui.detailTab === 'commits' && !state.detailCollapsed
      const commitDetailActive = commitPaneActive && repo.ui.commitDetail.phase !== 'idle'
      const commitListActive = commitPaneActive && !commitDetailActive
      const interactiveTarget = isInteractiveTarget(e.target)

      if (e.key === 'Escape') {
        if (overlayOpen) return
        const active = activeElement()
        if (!active || active === document.body || active === document.documentElement) return
        e.preventDefault()
        active.blur()
        return
      }

      if (interactiveTarget) return

      // `?` honours the overlay gate so it doesn't stack a second modal on top of Settings/Help. Modal owns Esc.
      if (e.key === '?') {
        if (overlayOpen) return
        e.preventDefault()
        onShowHelpRef.current()
        return
      }

      const action = branchShortcutAction(e)
      if (action) {
        if (overlayOpen || !repo || !repo.ui.selectedBranch) return
        e.preventDefault()
        runBranchActionShortcut(action)
        return
      }

      switch (e.key) {
        case 'j':
        case 'ArrowDown': {
          if (overlayOpen || !repo || commitDetailActive) break
          if (moveSelection(state, repo, commitListActive, 1)) e.preventDefault()
          break
        }
        case 'k':
        case 'ArrowUp': {
          if (overlayOpen || !repo || commitDetailActive) break
          if (moveSelection(state, repo, commitListActive, -1)) e.preventDefault()
          break
        }
        case 'ArrowRight':
        case 'ArrowLeft': {
          if (overlayOpen || !repo || !repo.ui.selectedBranch || state.detailCollapsed) break
          e.preventDefault()
          const selected = repo.data.branches.find((branch) => branch.name === repo.ui.selectedBranch)
          // Global shortcuts do not own tab focus; a missing branch is treated as "no worktree".
          state.setDetailTab(
            repo.id,
            adjacentDetailTab(repo.ui.detailTab, e.key === 'ArrowRight' ? 1 : -1, !!selected?.worktreePath),
          )
          break
        }
        case 'Enter': {
          if (overlayOpen || !repo || commitDetailActive) break
          if (commitListActive) {
            e.preventDefault()
            void state.openSelectedCommit()
          } else {
            e.preventDefault()
            void state.checkoutSelected()
          }
          break
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
