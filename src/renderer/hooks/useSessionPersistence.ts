import { useEffect } from 'react'
import { useReposStore } from '#/renderer/stores/repos.ts'

export function useSessionPersistence() {
  const activeId = useReposStore((s) => s.activeId)
  const order = useReposStore((s) => s.order)
  const sessionReady = useReposStore((s) => s.sessionReady)

  useEffect(() => {
    if (!sessionReady) return
    void window.gbl.settings.saveSession({ openRepos: order, activeRepo: activeId })
  }, [sessionReady, order, activeId])
}
