import { runWithRepoBackend } from '#/server/modules/repo-backend.ts'
import { type ExecResult, type PullRequestFetchMode, type WorktreeStatus } from '#/shared/git-types.ts'
import type { ProbeResult, PullRequestEntry, RepoSnapshot } from '#/shared/api-types.ts'

export async function probeRepository(cwd: string): Promise<ProbeResult> {
  return await runWithRepoBackend(cwd, async (backend) => await backend.probe())
}

export async function getRepositorySnapshot(cwd: string, signal?: AbortSignal): Promise<RepoSnapshot | null> {
  return signal?.aborted ? null : await runWithRepoBackend(cwd, async (backend) => await backend.getSnapshot(signal))
}

export async function getRepositoryStatus(cwd: string, signal?: AbortSignal): Promise<WorktreeStatus[]> {
  return signal?.aborted ? [] : await runWithRepoBackend(cwd, async (backend) => await backend.getStatus(signal))
}

export async function getRepositoryPullRequests(
  cwd: string,
  branches?: string[],
  options?: { mode?: PullRequestFetchMode; signal?: AbortSignal },
): Promise<PullRequestEntry[] | null> {
  if (branches !== undefined && !Array.isArray(branches)) return null
  const mode: PullRequestFetchMode = options?.mode === 'summary' ? 'summary' : 'full'
  const branchSet =
    branches === undefined
      ? undefined
      : new Set(
          branches.filter((branch): branch is string => {
            return typeof branch === 'string' && branch.length > 0
          }),
        )
  if (branchSet?.size === 0) return []
  const branchNames = branchSet ? Array.from(branchSet) : undefined
  const prs = await runWithRepoBackend(
    cwd,
    async (backend) => await backend.getPullRequests(branchNames, { mode, signal: options?.signal }),
  )
  if (!prs) return null
  return prs
}

export async function getRepositoryPatch(cwd: string, worktreePath: string, signal?: AbortSignal): Promise<ExecResult> {
  return await runWithRepoBackend(cwd, async (backend) => await backend.getPatch(worktreePath, signal))
}

export type CompositeInclude = 'snapshot' | 'status' | 'pullRequests'

export interface RepositoryComposite {
  snapshot: RepoSnapshot | null
  status: WorktreeStatus[]
  pullRequests: PullRequestEntry[] | null
}

/**
 * Fetch several repo read results in parallel. Each field is independent:
 * failures are caught per-field and the entry is left in its default
 * (`null` / `[]`) state. The composite request is aborted when the
 * caller's signal fires.
 */
export async function getRepositoryComposite(
  cwd: string,
  includes: ReadonlyArray<CompositeInclude>,
  options: { branches?: string[]; mode?: PullRequestFetchMode; signal?: AbortSignal } = {},
): Promise<RepositoryComposite> {
  const { branches, mode, signal } = options
  const want = (name: CompositeInclude) => includes.includes(name)
  const settled = await Promise.allSettled([
    want('snapshot') ? getRepositorySnapshot(cwd, signal) : Promise.resolve(null as RepoSnapshot | null),
    want('status') ? getRepositoryStatus(cwd, signal) : Promise.resolve([] as WorktreeStatus[]),
    want('pullRequests')
      ? getRepositoryPullRequests(cwd, branches, { mode, signal })
      : Promise.resolve(null as PullRequestEntry[] | null),
  ])
  return {
    snapshot: settled[0]!.status === 'fulfilled' ? settled[0]!.value : null,
    status: settled[1]!.status === 'fulfilled' ? settled[1]!.value : [],
    pullRequests: settled[2]!.status === 'fulfilled' ? settled[2]!.value : null,
  }
}
