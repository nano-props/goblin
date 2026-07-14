// Lazy restore hook: when the user navigates to a repo that was hydrated
// as a stub at cold start (no projection, no pane tabs), this hook fires
// the per-repo `POST /api/settings/workspace/restore-repo-tabs` request and
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
import { translate } from '#/web/stores/i18n.ts'
import { readOrCreateWebTerminalClientId } from '#/web/client-terminal-id.ts'
import type { RepoWorkspaceTabsRestoreIntent } from '#/shared/api-types.ts'

// Module-level dedupe so concurrent mounts (e.g. user clicks a stub while
// the route is still hydrating) share a single in-flight restore.
const inFlightRestores = new Map<string, Promise<void>>()

type RestoreResult =
  | {
      ok: true
      repo: import('#/shared/api-types.ts').ProjectedRestoredWorkspaceRepoRuntime
      snapshot: import('#/shared/workspace-pane-tabs.ts').WorkspacePaneTabsSnapshot | null
    }
  | { ok: false; message: string }

interface LazyRestoreTarget {
  repoRoot: string
  repoRuntimeId: string
  projectionState: 'projected' | 'stub'
  intent: RepoWorkspaceTabsRestoreIntent | null
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
        intent: repo.session.entry
          ? {
              entry: repo.session.entry,
              workspacePaneTabsByTarget: s.restoredSessionBaseline?.workspacePaneTabsByTargetByRepo[repo.id] ?? {},
            }
          : null,
      }
    }),
  )

  useEffect(() => {
    if (!target) return
    // Already client-owned (active repo at cold start, normal user-opened
    // repo, or a stub that has already been projected).
    if (target.projectionState !== 'stub' || !target.intent) return

    const key = `${target.repoRoot}\0${target.repoRuntimeId}`
    let promise = inFlightRestores.get(key)
    if (!promise) {
      promise = runLazyRestore(target.repoRoot, target.repoRuntimeId, target.intent).finally(() => {
        inFlightRestores.delete(key)
      })
      inFlightRestores.set(key, promise)
    }
    void promise
  }, [target])
}

async function runLazyRestore(
  repoRoot: string,
  repoRuntimeId: string,
  intent: RepoWorkspaceTabsRestoreIntent,
): Promise<void> {
  const result = await fetchLazyRestore(repoRoot, repoRuntimeId, intent)
  if (!lazyRestoreTargetStillCurrent(repoRoot, repoRuntimeId)) return
  if (result.ok) {
    useReposStore.getState().promoteRestoredWorkspaceRepo({
      repo: result.repo,
      snapshot: result.snapshot,
    })
    return
  }
  toast.error(translate('lazy-restore.failed'), {
    id: `lazy-restore:${repoRoot}`,
    description: result.message,
  })
}

function lazyRestoreTargetStillCurrent(repoRoot: string, repoRuntimeId: string): boolean {
  const repo = useReposStore.getState().repos[repoRoot]
  return !!repo && repo.repoRuntimeId === repoRuntimeId && repo.session.projectionState === 'stub'
}

async function fetchLazyRestore(
  repoRoot: string,
  repoRuntimeId: string,
  intent: RepoWorkspaceTabsRestoreIntent,
): Promise<RestoreResult> {
  return restoreRepoTabsOnView(readOrCreateWebTerminalClientId(), repoRoot, repoRuntimeId, intent).then(
    (response) => ({ ok: true as const, repo: response.repo, snapshot: response.snapshot }),
    (err: unknown) => ({ ok: false as const, message: err instanceof Error ? err.message : String(err) }),
  )
}
