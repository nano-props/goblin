import { useEffect, useRef } from 'react'
import { persistSessionState } from '#/web/settings-write-paths.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { restorableWorkspaceStateFromStore } from '#/web/stores/repos/selector-state.ts'
import { sessionStateFromRestorableWorkspaceState } from '#/web/restorable-workspace-state.ts'
import { sessionLog } from '#/web/logger.ts'
const SESSION_SAVE_DEBOUNCE_MS = 200

export function useSessionPersistence() {
  const activeId = useReposStore((s) => s.activeId)
  const order = useReposStore((s) => s.order)
  const workspaceFocused = useReposStore((s) => s.workspaceFocused)
  const workspacePaneSize = useReposStore((s) => s.workspacePaneSize)
  const selectedTerminalByWorktree = useReposStore((s) => s.selectedTerminalByWorktree)
  const sessionReady = useReposStore((s) => s.sessionReady)
  const repos = useReposStore((s) => s.repos)
  const lastSavedRef = useRef<string | null>(null)
  const lastImmediateKeyRef = useRef<string | null>(null)

  useEffect(() => {
    // Renderer -> persistence only. Boot restore runs elsewhere first, and
    // sessionReady gates this effect so we never overwrite restorable session
    // state with an empty pre-bootstrap workspace.
    if (!sessionReady) return
    const session = sessionStateFromRestorableWorkspaceState({
      repos,
      restorableWorkspaceState: restorableWorkspaceStateFromStore({
        order,
        activeId,
        workspaceFocused,
        workspacePaneSize,
        selectedTerminalByWorktree,
      }),
    })
    const serialized = JSON.stringify(session)
    const immediateKey = JSON.stringify({
      openRepos: session.openRepos,
      activeRepo: session.activeRepo,
      workspaceFocused: session.workspaceFocused,
      workspacePaneSize: session.workspacePaneSize,
      selectedTerminalByWorktree: session.selectedTerminalByWorktree,
      preferredWorkspacePaneViewByBranchByRepo: session.preferredWorkspacePaneViewByBranchByRepo,
      openBranchWorkspacePaneViewsByBranchByRepo: session.openBranchWorkspacePaneViewsByBranchByRepo,
    })
    const immediate = lastImmediateKeyRef.current !== immediateKey
    lastImmediateKeyRef.current = immediateKey
    if (lastSavedRef.current === serialized) return
    const save = () => {
      lastSavedRef.current = serialized
      void persistSessionState(session).catch((err) => {
        lastSavedRef.current = null
        sessionLog.warn('save failed', { err })
      })
    }
    if (immediate) {
      save()
      return
    }
    const timeout = window.setTimeout(save, SESSION_SAVE_DEBOUNCE_MS)
    return () => window.clearTimeout(timeout)
  }, [
    sessionReady,
    order,
    activeId,
    workspacePaneSize,
    workspaceFocused,
    selectedTerminalByWorktree,
    repos,
  ])
}
