import { useEffect, useRef } from 'react'
import { useI18nStore } from '#/renderer/stores/i18n.ts'
import { useReposStore } from '#/renderer/stores/repos.ts'
import { useSettingsStore } from '#/renderer/stores/settings.ts'
import { useThemeStore } from '#/renderer/stores/theme.ts'

export function useAppBootstrap() {
  const hydrateSession = useReposStore((s) => s.hydrateSession)
  const setDetailCollapsed = useReposStore((s) => s.setDetailCollapsed)
  const hydrateSettings = useSettingsStore((s) => s.hydrate)
  const hydrateTheme = useThemeStore((s) => s.hydrate)
  const hydrateI18n = useI18nStore((s) => s.hydrate)
  const hydratedRef = useRef(false)

  useEffect(() => {
    // StrictMode double-invoke guard: React 19 dev runs every effect
    // mount → cleanup → mount on the same component instance to surface
    // non-idempotent side effects. useRef survives that cycle, so by
    // the second mount this flag is already true and we skip kicking
    // off a duplicate hydrateSession against in-flight probes.
    if (hydratedRef.current) return
    hydratedRef.current = true
    void (async () => {
      try {
        await Promise.all([hydrateTheme(), hydrateSettings(), hydrateI18n()])
        const session = useSettingsStore.getState().savedSession
        setDetailCollapsed(session.detailCollapsed)
        await hydrateSession(session.openRepos, session.activeRepo)
      } catch (err) {
        console.warn('[bootstrap] failed', err)
        useReposStore.setState({ sessionReady: true })
      }
    })()
  }, [hydrateTheme, hydrateSettings, hydrateI18n, hydrateSession, setDetailCollapsed])
}
