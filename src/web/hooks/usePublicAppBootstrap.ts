import { useEffect, useRef } from 'react'
import { bootstrapLog } from '#/web/logger.ts'
import { useHostInfoStore } from '#/web/stores/host-info.ts'
import { useI18nStore } from '#/web/stores/i18n.ts'

export function usePublicAppBootstrap() {
  const hydratedRef = useRef(false)

  useEffect(() => {
    if (hydratedRef.current) return
    hydratedRef.current = true
    void Promise.all([
      useI18nStore.getState().hydrate({ subscribe: false }),
      useHostInfoStore.getState().hydrate(),
    ]).catch((err) => {
      bootstrapLog.warn('public bootstrap failed', { err })
    })
  }, [])
}
