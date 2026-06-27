import { produce, type Draft } from 'immer'
import {
  isRemoteRepoId,
  remoteRepoConnectionTarget,
  type RemoteRepoConnectionLifecycle,
  type RemoteRepoTarget,
} from '#/shared/remote-repo.ts'
import { deriveConnectivityLog } from '#/web/logger.ts'
import type { RepoState, ReposSet } from '#/web/stores/repos/types.ts'

/**
 * Live SSH liveness state for remote repos. Derived — never stored —
 * from `isRemoteRepoId(id)` + `remote.lifecycle.kind`. Per
 * docs/goblin-remote-repo-refactor-plan.md §4: the lifecycle union
 * is the single source of truth; the legacy `availability.phase` /
 * `target presence` inference is gone after Phase 4.
 *   - `connecting`:  remote repo whose lifecycle run has not
 *     converged (placeholder / in-flight probe)
 *   - `connected`:   remote repo with a converged `ready` lifecycle;
 *     also the default for local repos
 *   - `unreachable`: remote repo whose last probe converged to
 *     `failed`
 */
type RepoConnectivity = 'connecting' | 'connected' | 'unreachable'

export function deriveConnectivity(repo: RepoState): RepoConnectivity {
  if (!isRemoteRepoId(repo.id)) return 'connected'
  const lifecycle = repo.remote.lifecycle
  if (lifecycle) {
    if (lifecycle.kind === 'failed') return 'unreachable'
    if (lifecycle.kind === 'connecting') return 'connecting'
    return 'connected'
  }
  // A remote repo without a lifecycle is a pre-Phase-1 fixture
  // (test mocks, persistence restores) and SHOULD be treated
  // as a programming error in production. Until Phase 4 finishes
  // migrating every writer to the lifecycle helpers, treat it
  // as `connecting` so the UI shows a spinner — never as a
  // silently-broken `connected` tab.
  if (import.meta.env.DEV) {
    deriveConnectivityLog.warn(`remote repo ${repo.id} has no lifecycle; treating as connecting`)
  }
  return 'connecting'
}

/**
 * The concrete remote target for a remote repo id + lifecycle, or
 * `null` for local repos and remote repos whose lifecycle hasn't
 * reached a terminal state with a retained target. Replaces the
 * legacy `repo.remote.target` field — Phase 4 deletes the field,
 * this helper is the only sanctioned access path.
 *
 * Takes the id and the lifecycle separately so it works on
 * any subset that carries the lifecycle (e.g. `BranchActionRepo`,
 * `RepoWorkspaceRepo`).
 */
export function remoteRepoTarget(id: string, lifecycle: RemoteRepoConnectionLifecycle | null): RemoteRepoTarget | null {
  if (!isRemoteRepoId(id)) return null
  return remoteRepoConnectionTarget(lifecycle)
}

/**
 * Whether a repo is in a terminal "cannot be operated on" state:
 *   - Local repo: `availability.phase === 'unavailable'`
 *   - Remote repo: `remote.lifecycle.kind === 'failed'`
 *
 * Replaces the per-call-site `repo.availability.phase === 'unavailable'`
 * check. Callers that previously had to know whether they were
 * looking at a local or remote repo now just call this helper.
 */
export function isRepoUnavailable(repo: RepoState): boolean {
  if (isRemoteRepoId(repo.id)) {
    return repo.remote.lifecycle?.kind === 'failed'
  }
  return repo.availability.phase === 'unavailable'
}

type RepoMutator = (repo: Draft<RepoState>) => void

/** Apply `mutator` to the repo at `id` only if its instanceToken still
 *  matches the captured one. The check runs inside the functional
 *  setter so it reads the freshest store state, not the caller's
 *  pre-await snapshot. */
export function updateIfFresh(set: ReposSet, id: string, token: number, mutator: RepoMutator): void {
  set((s) => {
    const repo = s.repos[id]
    if (!repo || repo.instanceToken !== token) return s
    const nextRepo = produce(repo, mutator)
    return nextRepo === repo ? s : { ...s, repos: { ...s.repos, [id]: nextRepo } }
  })
}
