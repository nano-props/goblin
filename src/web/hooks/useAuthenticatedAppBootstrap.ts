// Authenticated bootstrap primes query state from the server transport before
// feature stores start reading it.
import { onScopeDispose, readonly, ref, toValue } from 'vue'
import type { MaybeRefOrGetter, Ref } from 'vue'
import type { ClientWorkspaceState, SettingsSnapshot } from '#/shared/api-types.ts'
import { normalizeWorkspaceSessionLayoutState } from '#/shared/workspace-layout.ts'
import { bootstrapLog } from '#/web/logger.ts'
import { appQueryClient } from '#/web/app-query-client.ts'
import { restoreFiletreeViewStateFromSession } from '#/web/filetree-session-state.ts'
import { restoreRestorableWorkspaceStateFromClientWorkspace } from '#/web/restorable-workspace-state.ts'
import { restoreWorkspaceAtBoot } from '#/web/settings-actions.ts'
import { externalAppsQueryOptions, settingsSnapshotQueryOptions } from '#/web/settings-queries.ts'
import { externalAppsQueryKey, settingsSnapshotQueryKey } from '#/web/settings-query-cache.ts'
import { i18nStore } from '#/web/stores/i18n.ts'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'
import { themeStore } from '#/web/stores/theme.ts'
import { createTimeoutAbortController, waitForPromiseWithSignal } from '#/web/lib/abort.ts'
import { readClientPageId } from '#/web/client-page-id.ts'
import { readClientWorkspaceState } from '#/web/client-workspace-state.ts'
import { workspaceSessionEntryId, type WorkspaceSessionEntry } from '#/shared/remote-workspace.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'

export type AuthenticatedAppBootstrapState =
  { status: 'restoring-workspace' } | { status: 'ready' } | { status: 'failed'; message: string }

export interface AuthenticatedAppBootstrapResult {
  state: Readonly<Ref<AuthenticatedAppBootstrapState>>
  retry: () => void
}

const RESTORING_WORKSPACE_BOOTSTRAP_STATE: AuthenticatedAppBootstrapState = { status: 'restoring-workspace' }
const READY_BOOTSTRAP_STATE: AuthenticatedAppBootstrapState = { status: 'ready' }

const AUTHENTICATED_WORKSPACE_RESTORE_TIMEOUT_MS = 30_000
const AUTHENTICATED_WORKSPACE_RESTORE_CANCELLED = new Error('authenticated workspace restore cancelled')

interface AuthenticatedWorkspaceRestoreRun {
  cancel: () => void
}

type WorkspaceRestoreOutcome = { status: 'completed' } | { status: 'cancelled' } | { status: 'failed'; message: string }

export function useAuthenticatedAppBootstrap(options?: {
  activeWorkspaceId?: MaybeRefOrGetter<WorkspaceId | null | undefined>
}): AuthenticatedAppBootstrapResult {
  const state = ref<AuthenticatedAppBootstrapState>(RESTORING_WORKSPACE_BOOTSTRAP_STATE)
  let restoreRun: AuthenticatedWorkspaceRestoreRun | null = null
  let disposed = false

  function start(): void {
    restoreRun?.cancel()
    state.value = RESTORING_WORKSPACE_BOOTSTRAP_STATE
    const run = startAuthenticatedWorkspaceRestoreRun(
      (outcome) => {
        if (disposed || restoreRun !== run) return
        if (outcome.status === 'completed') {
          state.value = READY_BOOTSTRAP_STATE
        } else if (outcome.status === 'failed') {
          state.value = { status: 'failed', message: outcome.message }
        }
      },
      toValue(options?.activeWorkspaceId) ?? null,
    )
    restoreRun = run
  }

  start()
  onScopeDispose(() => {
    disposed = true
    restoreRun?.cancel()
    restoreRun = null
  })

  return { state: readonly(state), retry: start }
}

function startAuthenticatedWorkspaceRestoreRun(
  onSettled: (outcome: WorkspaceRestoreOutcome) => void,
  activeWorkspaceId: WorkspaceId | null,
): AuthenticatedWorkspaceRestoreRun {
  let cancelled = false
  const timeout = createTimeoutAbortController(
    AUTHENTICATED_WORKSPACE_RESTORE_TIMEOUT_MS,
    `authenticated workspace restore timed out after ${AUTHENTICATED_WORKSPACE_RESTORE_TIMEOUT_MS}ms`,
  )
  // QueryClient owns the settings and external-app reads. Mounted consumers
  // join these in-flight queries and observe the same cached snapshot.
  const settingsSnapshot = appQueryClient.fetchQuery(settingsSnapshotQueryOptions())
  void waitForPromiseWithSignal(appQueryClient.fetchQuery(externalAppsQueryOptions()), timeout.signal).catch((err) => {
    if (!timeout.signal.aborted) bootstrapLog.warn('external apps priming failed', { err })
  })
  void hydrateNonCriticalAuthenticatedState(timeout.signal)
  void restoreBootSession(settingsSnapshot, timeout.signal, activeWorkspaceId).then(async (outcome) => {
    if (!cancelled && outcome.status === 'failed' && timeout.signal.aborted) {
      await Promise.all([
        appQueryClient.cancelQueries({ queryKey: settingsSnapshotQueryKey(), exact: true }),
        appQueryClient.cancelQueries({ queryKey: externalAppsQueryKey(), exact: true }),
      ])
    }
    timeout.dispose()
    if (!cancelled && outcome.status !== 'cancelled') onSettled(outcome)
  })
  return {
    cancel: () => {
      cancelled = true
      timeout.abort(AUTHENTICATED_WORKSPACE_RESTORE_CANCELLED)
      timeout.dispose()
    },
  }
}

async function hydrateNonCriticalAuthenticatedState(signal: AbortSignal): Promise<void> {
  await Promise.all([
    runOptionalBootstrapTask('theme hydrate', async () => await themeStore.getState().hydrate(), signal),
    Promise.resolve().then(() => i18nStore.getState().subscribeInvalidation()),
  ])
}

async function restoreBootSession(
  settingsSnapshot: Promise<SettingsSnapshot>,
  signal: AbortSignal,
  activeWorkspaceId: WorkspaceId | null,
): Promise<WorkspaceRestoreOutcome> {
  try {
    workspacesStore.setState({ sessionPersistenceReady: false, sessionRestoreError: null })
    const presentation = await readClientWorkspaceState()
    const snapshot = await waitForPromiseWithSignal(settingsSnapshot, signal)
    if (signal.aborted) throw abortReason(signal)
    const restored = await waitForPromiseWithSignal(
      restoreWorkspaceAtBoot(readClientPageId(), {
        activeWorkspaceId: activeWorkspaceId ?? presentation.restoredWorkspaceId,
        signal,
      }),
      signal,
    )
    if (restored.status === 'repaired') {
      bootstrapLog.warn('workspace restore dropped invalid or unavailable state')
    }
    const clientWorkspace = composeRestoredClientWorkspace(
      restored.openWorkspaceEntries,
      presentation,
      restored.runtime.restoredWorkspaceId,
    )
    applyRestoredClientWorkspace(clientWorkspace)
    await waitForPromiseWithSignal(
      workspacesStore.getState().hydrateRestoredWorkspaceRuntime(restored.runtime, {
        signal,
        restoredClientWorkspace: clientWorkspace,
      }),
      signal,
    )
    if (signal.aborted) throw abortReason(signal)
    workspacesStore.setState({
      sessionPersistenceReady: true,
      sessionRestoreError: null,
    })
    return { status: 'completed' }
  } catch (err) {
    if (signal.reason === AUTHENTICATED_WORKSPACE_RESTORE_CANCELLED && isAbortReason(err, signal)) {
      return { status: 'cancelled' }
    }
    bootstrapLog.warn('workspace restore failed', { err })
    const message = restoreFailureMessage(err)
    blockSessionPersistenceAfterRestoreFailure(message)
    return { status: 'failed', message }
  }
}

function applyRestoredClientWorkspace(clientWorkspace: ClientWorkspaceState): void {
  // Apply layout prefs before workspace restoration finishes so the first
  // restored paint uses the saved geometry. Client workspace persistence
  // still waits for workspaceMembershipReady, so this cannot overwrite the
  // persisted client workspace with a partially hydrated one.
  const normalizedLayout = normalizeWorkspaceSessionLayoutState(clientWorkspace)
  const restoredWorkspaceState = restoreRestorableWorkspaceStateFromClientWorkspace(clientWorkspace)
  const { applySessionLayoutState, applySessionSelectedTerminalState, applySessionBranchViewModes } =
    workspacesStore.getState()
  restoreFiletreeViewStateFromSession(clientWorkspace.filetreeViewStateByFilesystemTargetByWorkspace)
  applySessionLayoutState(normalizedLayout)
  applySessionSelectedTerminalState(restoredWorkspaceState.selectedTerminalSessionIdByTerminalFilesystemTarget)
  applySessionBranchViewModes(restoredWorkspaceState.branchViewModeByWorkspace)
}

function blockSessionPersistenceAfterRestoreFailure(message: string): void {
  workspacesStore.setState({
    workspaceMembershipReady: false,
    sessionPersistenceReady: false,
    sessionRestoreError: message,
  })
}

function composeRestoredClientWorkspace(
  openWorkspaceEntries: WorkspaceSessionEntry[],
  presentation: ClientWorkspaceState,
  serverRestoredWorkspaceId: WorkspaceId | null,
): ClientWorkspaceState {
  const openWorkspaceIds = new Set(openWorkspaceEntries.map(workspaceSessionEntryId))
  const presentationWorkspaceId = presentation.restoredWorkspaceId
  return {
    ...presentation,
    restoredWorkspaceId:
      presentationWorkspaceId && openWorkspaceIds.has(presentationWorkspaceId)
        ? presentationWorkspaceId
        : serverRestoredWorkspaceId,
  }
}

function restoreFailureMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'workspace restore failed'
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason instanceof Error ? signal.reason : new Error('authenticated workspace restore aborted')
}

function isAbortReason(err: unknown, signal: AbortSignal): boolean {
  if (err === signal.reason) return true
  return err instanceof Error && err.name === 'AbortError'
}

async function runOptionalBootstrapTask(label: string, task: () => Promise<void>, signal: AbortSignal): Promise<void> {
  try {
    await task()
  } catch (err) {
    if (signal.aborted && isAbortReason(err, signal)) return
    bootstrapLog.warn(`${label} failed`, { err })
  }
}
