import { useEffect, useRef } from 'react'
import { saveSession } from '#/web/app-data-client.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { sessionStateFromPersistableWorkspaceUi } from '#/web/workspace-ui-persistence-state.ts'
const SESSION_SAVE_DEBOUNCE_MS = 200

interface UseSessionPersistenceOptions {
  routeRepoId?: string | null
}

export function useSessionPersistence({ routeRepoId = null }: UseSessionPersistenceOptions = {}) {
  const activeId = useReposStore((s) => s.activeId)
  const order = useReposStore((s) => s.order)
  const detailCollapsed = useReposStore((s) => s.detailCollapsed)
  const detailFocusMode = useReposStore((s) => s.detailFocusMode)
  const workspaceLayout = useReposStore((s) => s.workspaceLayout)
  const detailPaneSizes = useReposStore((s) => s.detailPaneSizes)
  const selectedTerminalByWorktree = useReposStore((s) => s.selectedTerminalByWorktree)
  const sessionReady = useReposStore((s) => s.sessionReady)
  const repos = useReposStore((s) => s.repos)
  const lastSavedRef = useRef<string | null>(null)
  const lastImmediateKeyRef = useRef<string | null>(null)

  useEffect(() => {
    // Renderer -> persistence only. Boot restore runs elsewhere first, and
    // sessionReady gates this effect so we never overwrite persisted session
    // state with an empty pre-bootstrap workspace.
    if (!sessionReady) return
    const session = sessionStateFromPersistableWorkspaceUi({
      routeRepoId,
      repos,
      persistableWorkspaceUiState: {
        order,
        activeId,
        detailCollapsed,
        detailFocusMode,
        workspaceLayout,
        detailPaneSizes,
        selectedTerminalByWorktree,
      },
    })
    const serialized = JSON.stringify(session)
    const immediateKey = JSON.stringify({
      openRepos: session.openRepos,
      activeRepo: session.activeRepo,
      detailCollapsed,
      detailFocusMode,
      workspaceLayout,
      selectedTerminalByWorktree: session.selectedTerminalByWorktree,
    })
    const immediate = lastImmediateKeyRef.current !== immediateKey
    lastImmediateKeyRef.current = immediateKey
    if (lastSavedRef.current === serialized) return
    const save = () => {
      lastSavedRef.current = serialized
      void saveSession(session).catch((err) => {
        lastSavedRef.current = null
        console.warn('[session] save failed', err)
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
    routeRepoId,
    order,
    activeId,
    detailCollapsed,
    detailFocusMode,
    workspaceLayout,
    detailPaneSizes,
    selectedTerminalByWorktree,
    repos,
  ])
}
