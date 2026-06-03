import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { onNativeEventType } from '#/web/native-bridge.ts'
import { openRepoPaths } from '#/web/lib/open-repo-paths.ts'
import { useMainWindowNavigation } from '#/web/main-window-navigation.tsx'
import { consumeExternalOpenPaths } from '#/web/app-shell-client.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { useT } from '#/web/stores/i18n.ts'
export function useExternalOpenPaths() {
  const ensureWorkspaceOpen = useReposStore((s) => s.ensureWorkspaceOpen)
  const navigation = useMainWindowNavigation()
  const t = useT()
  const tRef = useRef(t)
  const ensureWorkspaceOpenRef = useRef(ensureWorkspaceOpen)
  const activateRepoRef = useRef(navigation.activateRepo)
  const drainingRef = useRef(false)
  const rerunRef = useRef(false)
  const disposedRef = useRef(false)
  tRef.current = t
  ensureWorkspaceOpenRef.current = ensureWorkspaceOpen
  activateRepoRef.current = navigation.activateRepo

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
            const paths = await consumeExternalOpenPaths()
            if (paths.length === 0) break
            await openRepoPaths(paths, {
              ensureWorkspaceOpen: ensureWorkspaceOpenRef.current,
              activateRepo: activateRepoRef.current,
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

    const off = onNativeEventType('external-open-enqueued', () => {
      drain()
    })

    drain()

    return () => {
      disposedRef.current = true
      off()
    }
  }, [])
}
