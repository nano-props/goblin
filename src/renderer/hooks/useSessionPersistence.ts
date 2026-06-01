import { useEffect, useRef } from 'react'
import { useReposStore } from '#/renderer/stores/repos/store.ts'
import { rpc } from '#/renderer/rpc.ts'
import type { SessionState } from '#/shared/rpc.ts'
import { remoteRepoRefFromTarget, remoteRepoSessionEntry, type RepoSessionEntry } from '#/shared/remote-repo.ts'

const SESSION_SAVE_DEBOUNCE_MS = 200

export function useSessionPersistence() {
  const activeId = useReposStore((s) => s.activeId)
  const order = useReposStore((s) => s.order)
  const detailCollapsed = useReposStore((s) => s.detailCollapsed)
  const detailFocusMode = useReposStore((s) => s.detailFocusMode)
  const workspaceLayout = useReposStore((s) => s.workspaceLayout)
  const detailPaneSizes = useReposStore((s) => s.detailPaneSizes)
  const sessionReady = useReposStore((s) => s.sessionReady)
  const repos = useReposStore((s) => s.repos)
  const lastSavedRef = useRef<string | null>(null)
  const lastImmediateKeyRef = useRef<string | null>(null)

  useEffect(() => {
    if (!sessionReady) return
    const openRepos: RepoSessionEntry[] = order.map((id) => {
      const target = repos[id]?.remote.target
      return target ? remoteRepoSessionEntry(remoteRepoRefFromTarget(target)) : { kind: 'local', id }
    })
    const session: SessionState = {
      openRepos,
      activeRepo: activeId,
      detailCollapsed,
      detailFocusMode,
      workspaceLayout,
      detailPaneSizes,
    }
    const serialized = JSON.stringify(session)
    const immediateKey = JSON.stringify({
      openRepos,
      activeRepo: activeId,
      detailCollapsed,
      detailFocusMode,
      workspaceLayout,
    })
    const immediate = lastImmediateKeyRef.current !== immediateKey
    lastImmediateKeyRef.current = immediateKey
    if (lastSavedRef.current === serialized) return
    const save = () => {
      lastSavedRef.current = serialized
      void rpc.settings.saveSession.mutate({ session }).catch((err) => {
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
  }, [sessionReady, order, activeId, detailCollapsed, detailFocusMode, workspaceLayout, detailPaneSizes, repos])
}
