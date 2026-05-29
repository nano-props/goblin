import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { onRpcEventType, rpc } from '#/renderer/rpc.ts'
import { openRepoPaths } from '#/renderer/lib/open-repo-paths.ts'
import { useReposStore } from '#/renderer/stores/repos/store.ts'
import { useT } from '#/renderer/stores/i18n.ts'

export function useExternalOpenPaths() {
  const openRepo = useReposStore((s) => s.openRepo)
  const setActive = useReposStore((s) => s.setActive)
  const t = useT()
  const tRef = useRef(t)
  const openRepoRef = useRef(openRepo)
  const setActiveRef = useRef(setActive)
  const drainingRef = useRef(false)
  const rerunRef = useRef(false)
  const disposedRef = useRef(false)
  tRef.current = t
  openRepoRef.current = openRepo
  setActiveRef.current = setActive

  useEffect(() => {
    disposedRef.current = false

    const drain = () => {
      if (disposedRef.current) return
      if (drainingRef.current) {
        rerunRef.current = true
        return
      }
      drainingRef.current = true
      void (async () => {
        try {
          while (!disposedRef.current) {
            rerunRef.current = false
            const paths = await rpc.repo.consumeExternalOpenPaths.mutate()
            if (paths.length === 0) break
            await openRepoPaths(paths, {
              openRepo: openRepoRef.current,
              setActive: setActiveRef.current,
              onOpenFailed: (path, message) => {
                toast.error(tRef.current('drop.open-failed'), {
                  description: `${path}\n${tRef.current(message)}`,
                })
              },
            })
            if (!rerunRef.current) break
          }
        } catch (err) {
          console.warn('[external-open] failed to drain queued paths', err)
        } finally {
          drainingRef.current = false
          if (rerunRef.current && !disposedRef.current) drain()
        }
      })()
    }

    const off = onRpcEventType('external-open-enqueued', () => {
      drain()
    })

    drain()

    return () => {
      disposedRef.current = true
      off()
    }
  }, [])
}
