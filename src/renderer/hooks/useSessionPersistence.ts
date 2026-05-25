import { useEffect } from 'react'
import { useReposStore } from '#/renderer/stores/repos/store.ts'
import { rpc } from '#/renderer/rpc.ts'

export function useSessionPersistence() {
  const activeId = useReposStore((s) => s.activeId)
  const order = useReposStore((s) => s.order)
  const detailCollapsed = useReposStore((s) => s.detailCollapsed)
  const detailFocusMode = useReposStore((s) => s.detailFocusMode)
  const workspaceLayout = useReposStore((s) => s.workspaceLayout)
  const detailPaneSizes = useReposStore((s) => s.detailPaneSizes)
  const sessionReady = useReposStore((s) => s.sessionReady)

  useEffect(() => {
    if (!sessionReady) return
    void rpc.settings.saveSession
      .mutate({
        session: {
          openRepos: order,
          activeRepo: activeId,
          detailCollapsed,
          detailFocusMode,
          workspaceLayout,
          detailPaneSizes,
        },
      })
      .catch((err) => {
        console.warn('[session] save failed', err)
      })
  }, [sessionReady, order, activeId, detailCollapsed, detailFocusMode, workspaceLayout, detailPaneSizes])
}
