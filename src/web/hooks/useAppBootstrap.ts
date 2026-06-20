import { useEffect, useRef } from 'react'
import { normalizeWorkspaceSessionLayoutState } from '#/shared/workspace-layout.ts'
import { mainWindowQueryClient } from '#/web/main-window-queries.ts'
import { restoreRestorableWorkspaceStateFromSession } from '#/web/restorable-workspace-state.ts'
import { useHostInfoStore } from '#/web/stores/host-info.ts'
import { useI18nStore } from '#/web/stores/i18n.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { useSessionRestoreStore } from '#/web/stores/session-restore.ts'
import { useThemeStore } from '#/web/stores/theme.ts'
import { bootstrapLog } from '#/web/logger.ts'
import { getExternalAppsSnapshot, getSettingsSnapshot } from '#/web/settings-client.ts'
import { externalAppsQueryKey, settingsSnapshotQueryKey } from '#/web/settings-queries.ts'

export function useAppBootstrap() {
  const hydratedRef = useRef(false)

  useEffect(() => {
    // Boot-only restore path. This consumes the one-shot session snapshot and
    // applies it into the repos store before runtime persistence starts; it
    // does not establish a live session <-> renderer sync loop.
    // StrictMode double-invoke guard: React 19 dev runs every effect
    // mount → cleanup → mount on the same component instance to surface
    // non-idempotent side effects. useRef survives that cycle, so by
    // the second mount this flag is already true and we skip kicking
    // off a duplicate hydrateSession against in-flight probes.
    if (hydratedRef.current) return
    hydratedRef.current = true
    void (async () => {
      try {
        // Prime the settings query cache concurrently with the
        // boot stores. Fire-and-forget: the page will retry the
        // auto-fetch on first use if priming fails or hasn't
        // completed yet, and TanStack Query dedupes concurrent
        // fetches on the same key. We don't `await` here because
        // the settings fetch rides on a public endpoint that
        // may legitimately be slow under load — the rest of
        // the boot (theme, i18n, session restore, host info)
        // must not be gated on it.
        void primeSettingsQueryCache().catch((err) => {
          bootstrapLog.warn('settings priming failed', { err })
        })
        await Promise.all([
          useThemeStore.getState().hydrate(),
          useSessionRestoreStore.getState().hydrate(),
          useI18nStore.getState().hydrate(),
          // Host info (home dir, platform) is fetched in parallel
          // with i18n. Both are public endpoints and both have
          // safe defaults for the brief pre-hydrate window, so
          // running them together is strictly better than
          // serialising the work. `useHostInfoStore` is built
          // with a `getPlatform` fallback to `'web'` and a
          // `homeDirectory` fallback to `''` so the settings
          // page can render during the fetch.
          useHostInfoStore.getState().hydrate(),
        ])
        const session = useSessionRestoreStore.getState().consumeBootSessionSnapshot()
        const normalizedLayout = normalizeWorkspaceSessionLayoutState(session)
        const {
          hydrateSession,
          applySessionLayoutState,
          applySessionSelectedTerminalState,
          applySessionWorkspacePaneViewByRepo,
        } = useReposStore.getState()
        // Apply layout prefs before repo probing finishes so the first
        // restored paint uses the saved geometry. useSessionPersistence
        // still waits for sessionReady, so this cannot overwrite the
        // persisted session with a partially hydrated one.
        const restoredWorkspaceState = restoreRestorableWorkspaceStateFromSession(session)
        applySessionLayoutState(normalizedLayout)
        applySessionSelectedTerminalState(restoredWorkspaceState.selectedTerminalByWorktree)
        await hydrateSession(session.openRepos, session.activeRepo)
        applySessionWorkspacePaneViewByRepo(restoredWorkspaceState.workspacePaneViewByRepo)
      } catch (err) {
        bootstrapLog.warn('failed', { err })
        useReposStore.setState({ sessionReady: true })
      }
    })()
  }, [])
}

/**
 * Prime the settings and external-apps query cache from the public
 * `/api/settings` + `/api/settings/external-apps` endpoints so the
 * settings pages render with their persisted values on first paint
 * instead of flashing the defaults. Each call sites its own error
 * log on failure — the renderer's boot must not be blocked by a
 * settings fetch outage.
 */
async function primeSettingsQueryCache(): Promise<void> {
  // `getSettingsSnapshot()` / `getExternalAppsSnapshot()` can throw
  // synchronously when the bootstrap is missing (the request never
  // reaches `fetch`). Wrap each one individually so the other can
  // still succeed and so a synchronous throw doesn't propagate up
  // and abort the rest of the boot.
  const fetchAndPrime = async (
    fetcher: () => Promise<unknown>,
    queryKey: readonly unknown[],
  ): Promise<void> => {
    try {
      const snapshot = await fetcher()
      mainWindowQueryClient.setQueryData(queryKey, snapshot)
    } catch {
      // Settings fetch failure must not block boot — the page will
      // retry the auto-fetch on first use. The empty cache is the
      // same state the renderer had before this priming pass.
    }
  }
  await Promise.all([
    fetchAndPrime(getSettingsSnapshot, settingsSnapshotQueryKey()),
    fetchAndPrime(getExternalAppsSnapshot, externalAppsQueryKey()),
  ])
}
