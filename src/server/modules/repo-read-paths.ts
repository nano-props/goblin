import { runWithRepoBackend } from '#/server/modules/repo-backend.ts'
import { type ExecResult, type PullRequestFetchMode, type WorktreeStatus } from '#/shared/git-types.ts'
import type { ProbeResult, PullRequestEntry, RepoSnapshot } from '#/shared/rpc.ts'

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
  const prs = await runWithRepoBackend(cwd, async (backend) => await backend.getPullRequests(branchNames, { mode, signal: options?.signal }))
  if (!prs) return null
  return prs
}

export async function getRepositoryPatch(cwd: string, worktreePath: string, signal?: AbortSignal): Promise<ExecResult> {
  return await runWithRepoBackend(cwd, async (backend) => await backend.getPatch(worktreePath, signal))
}
