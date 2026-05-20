// Global keyboard shortcuts. Mounted once in App.tsx — all bindings
// live here so adding/removing one is a single-file change.
//
// Shortcuts that are also wired through the application menu (⌘O,
// ⌘W, ⌘2/⌘3, ⌘[ , ⌘]) are handled by Electron's accelerator system
// and forwarded via `app:menu-invoke`. We only handle the "no
// modifier" keys here (j/k/?/Enter/Esc) so we don't fight the menu.
//
// Modal awareness: when an overlay is open (Settings / Help / commit
// detail) every shortcut is suppressed — including `?`, otherwise
// pressing it with Settings open would stack the Help modal on top.

import { useEffect, useRef } from 'react'
import { useReposStore } from '#/renderer/stores/repos.ts'

interface Options {
  onShowHelp: () => void
  /** Returns true when a Settings or Help modal is currently mounted.
   *  Commit-detail overlay is checked from the active repo state. */
  isOverlayOpen: () => boolean
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
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
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (isTypingTarget(e.target)) return

      const state = useReposStore.getState()
      const repoId = state.activeId
      const repo = repoId ? state.repos[repoId] : null
      const overlayOpen = isOverlayOpenRef.current() || !!repo?.openCommit

      // `?` honours the overlay gate so it doesn't stack a second modal
      // on top of Settings/Help/commit-detail. Modal owns Esc.
      if (e.key === '?') {
        if (overlayOpen) return
        e.preventDefault()
        onShowHelpRef.current()
        return
      }

      switch (e.key) {
        case 'j':
        case 'ArrowDown': {
          if (overlayOpen || !repo || repo.branches.length === 0) break
          if (repo.detailTab === 'commits') {
            const branch = repo.selectedBranch ?? repo.currentBranch
            const branchLog = branch ? repo.logsByBranch[branch] : undefined
            if (branch && branchLog?.entries.length) {
              e.preventDefault()
              const idx = branchLog.entries.findIndex((c) => c.hash === branchLog.selectedHash)
              const nextIdx = Math.min(branchLog.entries.length - 1, idx < 0 ? 0 : idx + 1)
              const next = branchLog.entries[nextIdx]
              if (next) state.selectLog(repo.id, branch, next.hash)
            }
          } else {
            e.preventDefault()
            const idx = repo.branches.findIndex((b) => b.name === repo.selectedBranch)
            const nextIdx = Math.min(repo.branches.length - 1, idx < 0 ? 0 : idx + 1)
            const next = repo.branches[nextIdx]
            if (next) state.selectBranch(repo.id, next.name)
          }
          break
        }
        case 'k':
        case 'ArrowUp': {
          if (overlayOpen || !repo || repo.branches.length === 0) break
          if (repo.detailTab === 'commits') {
            const branch = repo.selectedBranch ?? repo.currentBranch
            const branchLog = branch ? repo.logsByBranch[branch] : undefined
            if (branch && branchLog?.entries.length) {
              e.preventDefault()
              const idx = branchLog.entries.findIndex((c) => c.hash === branchLog.selectedHash)
              const nextIdx = Math.max(0, idx < 0 ? 0 : idx - 1)
              const next = branchLog.entries[nextIdx]
              if (next) state.selectLog(repo.id, branch, next.hash)
            }
          } else {
            e.preventDefault()
            const idx = repo.branches.findIndex((b) => b.name === repo.selectedBranch)
            const nextIdx = Math.max(0, idx < 0 ? 0 : idx - 1)
            const next = repo.branches[nextIdx]
            if (next) state.selectBranch(repo.id, next.name)
          }
          break
        }
        case 'Enter': {
          if (overlayOpen || !repo) break
          if (repo.detailTab === 'commits') {
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
