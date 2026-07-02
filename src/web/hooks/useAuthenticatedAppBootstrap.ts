import { useEffect, useRef } from 'react'
import type { SettingsSnapshot } from '#/shared/api-types.ts'
import { normalizeWorkspaceSessionLayoutState } from '#/shared/workspace-layout.ts'
import { bootstrapLog } from '#/web/logger.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { restoreFiletreeViewStateFromSession } from '#/web/filetree-session-state.ts'
import { restoreRestorableWorkspaceStateFromSession } from '#/web/restorable-workspace-state.ts'
import { getExternalAppsSnapshot, getSettingsSnapshot } from '#/web/settings-client.ts'
import { externalAppsQueryKey, settingsSnapshotQueryKey } from '#/web/settings-queries.ts'
import { useHostInfoStore } from '#/web/stores/host-info.ts'
import { useI18nStore } from '#/web/stores/i18n.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { useSessionRestoreStore } from '#/web/stores/session-restore.ts'
import { useThemeStore } from '#/web/stores/theme.ts'
import {
  restoreServerWorkspacePaneTabsFromSession,
  type RestoreWorkspacePaneTabsFromSessionResult,
} from '#/web/workspace-pane/workspace-pane-session-tabs-restore.ts'

export function useAuthenticatedAppBootstrap() {
  const hydratedRef = useRef(false)

  useEffect(() => {
    // StrictMode double-invoke guard: React 19 dev runs every effect
    // mount -> cleanup -> mount on the same component instance to surface
    // non-idempotent side effects. useRef survives that cycle, so by
    // the second mount this flag is already true and we skip duplicate
    // boot work against in-flight probes.
    if (hydratedRef.current) return
    hydratedRef.current = true
    // One settings read fans out to cache priming, theme, and session restore.
    const settingsSnapshot = getSettingsSnapshot()
    void primeSettingsQueryCache(settingsSnapshot).catch((err) => {
      bootstrapLog.warn('settings priming failed', { err })
    })
    void hydrateNonCriticalAuthenticatedState(settingsSnapshot)
    void restoreBootSession(settingsSnapshot)
  }, [])
}

async function hydrateNonCriticalAuthenticatedState(settingsSnapshot: Promise<SettingsSnapshot>): Promise<void> {
  await Promise.all([
    runOptionalBootstrapTask('theme hydrate', async () => {
      await useThemeStore.getState().hydrateFromSettingsSnapshot(await settingsSnapshot)
    }),
    runOptionalBootstrapTask('i18n hydrate', () => useI18nStore.getState().hydrate()),
    runOptionalBootstrapTask('host-info hydrate', () => useHostInfoStore.getState().hydrate()),
  ])
}

async function restoreBootSession(settingsSnapshot: Promise<SettingsSnapshot>): Promise<void> {
  try {
    useReposStore.setState({ sessionPersistenceReady: false })
    useSessionRestoreStore.getState().hydrateFromSettingsSnapshot(await settingsSnapshot)
    const session = useSessionRestoreStore.getState().consumeBootSessionSnapshot()
    const normalizedLayout = normalizeWorkspaceSessionLayoutState(session)
    const { hydrateRepoSession, applySessionLayoutState, applySessionSelectedTerminalState } = useReposStore.getState()
    // Apply layout prefs before repo probing finishes so the first
    // restored paint uses the saved geometry. useSessionPersistence
    // still waits for sessionReady, so this cannot overwrite the
    // persisted session with a partially hydrated one.
    const restoredWorkspaceState = restoreRestorableWorkspaceStateFromSession(session)
    restoreFiletreeViewStateFromSession(session.filetreeViewStateByWorktreeByRepo)
    applySessionLayoutState(normalizedLayout)
    applySessionSelectedTerminalState(restoredWorkspaceState.selectedTerminalSessionIdByTerminalWorktree)
    await hydrateRepoSession(session.openRepoEntries, session.activeRepoId, {
      workspacePaneRestoreState: {
        workspacePaneTabsByTargetByRepo: restoredWorkspaceState.workspacePaneTabsByTargetByRepo,
        preferredWorkspacePaneTabByTargetByRepo: restoredWorkspaceState.preferredWorkspacePaneTabByTargetByRepo,
      },
    })
    const workspaceTabsRestoreResult = await restoreServerWorkspacePaneTabsFromSession(
      restoredWorkspaceState.workspacePaneTabsByTargetByRepo,
    )
    finishWorkspacePaneTabsBootRestore(workspaceTabsRestoreResult)
  } catch (err) {
    bootstrapLog.warn('session restore failed', { err })
    useReposStore.setState({ sessionReady: true, sessionPersistenceReady: true })
  }
}

function finishWorkspacePaneTabsBootRestore(result: RestoreWorkspacePaneTabsFromSessionResult): void {
  switch (result.status) {
    case 'restored':
      useReposStore.setState({ sessionPersistenceReady: true })
      return
    case 'stale-pruned':
      // Stale session entries can happen after moving between machines,
      // deleting a worktree, or renaming a branch. Let normal session
      // persistence prune those unreachable tabs on the next save.
      bootstrapLog.info('workspace pane tabs restore pruned stale entries', workspacePaneTabsRestoreSummary(result))
      useReposStore.setState({ sessionPersistenceReady: true })
      return
    case 'failed':
      bootstrapLog.warn('workspace pane tabs restore incomplete', workspacePaneTabsRestoreSummary(result))
      return
  }
}

function workspacePaneTabsRestoreSummary(result: RestoreWorkspacePaneTabsFromSessionResult) {
  return {
    unresolvedRepos: result.unresolvedRepos,
    unresolvedTargets: result.unresolvedTargets,
    failedCommitCount: result.failedCommits.length,
  }
}

async function runOptionalBootstrapTask(label: string, task: () => Promise<void>): Promise<void> {
  try {
    await task()
  } catch (err) {
    bootstrapLog.warn(`${label} failed`, { err })
  }
}

/**
 * Prime the settings and external-apps query cache from the authenticated
 * `/api/settings` + `/api/settings/external-apps` endpoints so the
 * settings pages render with their persisted values on first paint
 * instead of flashing the defaults. Each call sites its own error
 * log on failure - the client's boot must not be blocked by a
 * settings fetch outage.
 */
async function primeSettingsQueryCache(settingsSnapshot: Promise<SettingsSnapshot>): Promise<void> {
  // `getSettingsSnapshot()` / `getExternalAppsSnapshot()` can throw
  // synchronously when the bootstrap is missing (the request never
  // reaches `fetch`). Wrap each one individually so the other can
  // still succeed and so a synchronous throw doesn't propagate up
  // and abort the rest of the boot.
  const fetchAndPrime = async (fetcher: () => Promise<unknown>, queryKey: readonly unknown[]): Promise<void> => {
    try {
      const snapshot = await fetcher()
      primaryWindowQueryClient.setQueryData(queryKey, snapshot)
    } catch {
      // Settings fetch failure must not block boot - the page will
      // retry the auto-fetch on first use. The empty cache is the
      // same state the client had before this priming pass.
    }
  }
  await Promise.all([
    fetchAndPrime(() => settingsSnapshot, settingsSnapshotQueryKey()),
    fetchAndPrime(getExternalAppsSnapshot, externalAppsQueryKey()),
  ])
}
