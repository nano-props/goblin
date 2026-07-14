// Lazy restore hook: when the user navigates to a repo that was hydrated
// as a stub at cold start (no projection, no pane tabs), this hook fires
// the per-repo `POST /api/settings/session/restore-repo-tabs` request and
// hydrates the returned repo into the store.
//
// Why per-repo: cold start validates persisted repo identity, but only the
// active repo needs an immediate projection read. Non-active repos remain
// stub leases until the user opens them.

import { useEffect } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { toast } from 'sonner'
import { restoreRepoTabsOnView } from '#/web/settings-actions.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { bootstrapLog } from '#/web/logger.ts'
import { translate } from '#/web/stores/i18n.ts'
import { readOrCreateWebTerminalClientId } from '#/web/client-terminal-id.ts'

// Module-level dedupe so concurrent mounts (e.g. user clicks a stub while
// the route is still hydrating) share a single in-flight restore.
const inFlightRestores = new Map<string, Promise<void>>()

// Track per-repo failure counts so a persistently broken repo (e.g. disk
// error) doesn't get retried forever. After `MAX_LAZY_RESTORE_ATTEMPTS`
// failures we stop firing the endpoint until the next app launch.
const MAX_LAZY_RESTORE_ATTEMPTS = 3
const failedRestores = new Map<string, { attempts: number; lastError: string }>()

type RestoreResult =
  | {
      ok: true
      repo: import('#/shared/api-types.ts').RestoredWorkspaceRepoRuntime
      snapshot: import('#/shared/workspace-pane-tabs.ts').WorkspacePaneTabsSnapshot | null
    }
  | { ok: false; message: string }

interface LazyRestoreTarget {
  repoRoot: string
  repoRuntimeId: string
  projectionState: 'projected' | 'stub'
}

export function useRestoreRepoTabsOnView({ repoId }: { repoId: string | null }) {
  const target = useReposStore(
    useShallow((s): LazyRestoreTarget | null => {
      if (!repoId) return null
      const repo = s.repos[repoId]
      if (!repo) return null
      return {
        repoRoot: repo.id,
        repoRuntimeId: repo.repoRuntimeId,
        projectionState: repo.session.projectionState,
      }
    }),
  )

  useEffect(() => {
    if (!target) return
    // Already client-owned (active repo at cold start, normal user-opened
    // repo, or a stub that has already been projected).
    if (target.projectionState !== 'stub') return

    const failed = failedRestores.get(target.repoRoot)
    if (failed && failed.attempts >= MAX_LAZY_RESTORE_ATTEMPTS) return

    const key = `${target.repoRoot}\0${target.repoRuntimeId}`
    let promise = inFlightRestores.get(key)
    if (!promise) {
      promise = runLazyRestore(target.repoRoot, target.repoRuntimeId).finally(() => {
        inFlightRestores.delete(key)
      })
      inFlightRestores.set(key, promise)
    }
    void promise
  }, [target])
}

async function runLazyRestore(repoRoot: string, repoRuntimeId: string): Promise<void> {
  const result = await fetchLazyRestore(repoRoot, repoRuntimeId)
  if (result.ok) {
    if (!lazyRestoreTargetStillCurrent(repoRoot, repoRuntimeId)) return
    await applyLazyRestore(repoRoot, result)
    return
  }
  if (staleRuntimeRestoreFailure(result.message)) return
  recordLazyRestoreFailure(repoRoot, result.message)
}

function lazyRestoreTargetStillCurrent(repoRoot: string, repoRuntimeId: string): boolean {
  const repo = useReposStore.getState().repos[repoRoot]
  return !!repo && repo.repoRuntimeId === repoRuntimeId && repo.session.projectionState === 'stub'
}

async function fetchLazyRestore(repoRoot: string, repoRuntimeId: string): Promise<RestoreResult> {
  return restoreRepoTabsOnView(readOrCreateWebTerminalClientId(), repoRoot, repoRuntimeId).then(
    (response) => ({ ok: true as const, repo: response.repo, snapshot: response.snapshot }),
    (err: unknown) => ({ ok: false as const, message: err instanceof Error ? err.message : String(err) }),
  )
}

async function applyLazyRestore(repoRoot: string, result: Extract<RestoreResult, { ok: true }>): Promise<void> {
  // `hydrateRestoredWorkspaceRuntime` already wires `updateRepoRuntimeCache`,
  // `writeWorkspacePaneTabsSnapshotQueryData`, `seedRepoProjectionQueryData`,
  // the in-store repo entry, `acceptRepoProjectionReadModel`, and the
  // post-hydration projection refresh. One call, single source of truth.
  await useReposStore.getState().hydrateRestoredWorkspaceRuntime({
    repos: [result.repo],
    workspacePaneTabs: result.snapshot
      ? [{ repoRoot: result.repo.repoRoot, repoRuntimeId: result.repo.repoRuntimeId, snapshot: result.snapshot }]
      : [],
    restoredRepoId: result.repo.repoRoot,
  })
  failedRestores.delete(repoRoot)
}

function staleRuntimeRestoreFailure(message: string): boolean {
  return message.includes('error.repo-runtime-stale')
}

function recordLazyRestoreFailure(repoRoot: string, message: string): void {
  const prior = failedRestores.get(repoRoot)
  const attempts = (prior?.attempts ?? 0) + 1
  failedRestores.set(repoRoot, { attempts, lastError: message })
  // Reserve warn-level for the final exhaustion — transient retries are debug.
  if (attempts >= MAX_LAZY_RESTORE_ATTEMPTS) {
    bootstrapLog.warn('lazy restore-repo-tabs gave up', {
      err: new Error(message),
      repoRoot,
      attempts,
    })
  } else {
    bootstrapLog.debug('lazy restore-repo-tabs failed', {
      err: new Error(message),
      repoRoot,
      attempts,
    })
  }
  toast.error(translate('lazy-restore.failed'), {
    id: `lazy-restore:${repoRoot}`,
    description:
      attempts >= MAX_LAZY_RESTORE_ATTEMPTS
        ? `${message} — ${translate('lazy-restore.gave-up', { attempts })}`
        : message,
  })
}
