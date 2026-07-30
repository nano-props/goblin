import { promises as fs } from 'node:fs'
import { RepositoryBoundaryUnavailableError } from '#/server/modules/repository-boundary-error.ts'
import {
  remoteRuntimeAwareGitRunner,
  resolveRemoteWorkspaceTarget,
  type RepoSourceRuntimeContext,
} from '#/server/modules/remote-repo-execution.ts'
import { isRemoteWorkspaceId, type RemoteWorkspaceTarget } from '#/shared/remote-workspace.ts'
import { parseWorkspaceLocator, type WorkspaceId, type WorkspaceLocatorPlatform } from '#/shared/workspace-locator.ts'
import { resolveRepoCommonDir } from '#/system/git/branches.ts'
import { resolveRemoteRepoCommonDir, type RemoteGitRunner } from '#/system/ssh/git.ts'

type RepoWriteBoundary = { kind: 'local-git'; commonDir: string } | { kind: 'remote-git'; executionIdentity: string }

interface LocalRepoExecutionSnapshot {
  boundary: Extract<RepoWriteBoundary, { kind: 'local-git' }>
  canonicalRepoPath: string
}

function serverWorkspaceLocatorPlatform(): WorkspaceLocatorPlatform {
  return process.platform === 'win32' ? 'win32' : 'posix'
}

export function repoWriteBoundaryKey(boundary: RepoWriteBoundary): string {
  switch (boundary.kind) {
    case 'local-git':
      return `local-git:${boundary.commonDir}`
    case 'remote-git':
      return `remote-git:${boundary.executionIdentity}`
  }
  const exhaustive: never = boundary
  return exhaustive
}

/**
 * Canonical repository identity is mandatory for every boundary-scoped read
 * and write. A workspace locator describes user intent, not a physical
 * repository, so never substitute the locator, a cached group, or a previous
 * identity when resolution fails. Fail before observing state or admitting an
 * operation instead.
 */
async function resolveLocalRepoWriteBoundary(repoId: WorkspaceId, signal?: AbortSignal): Promise<RepoWriteBoundary> {
  const locator = parseWorkspaceLocator(repoId, serverWorkspaceLocatorPlatform())
  if (!locator || locator.transport !== 'file') throw new Error('error.workspace-locator-malformed')
  return (await resolveLocalRepoExecution(locator.path, signal)).boundary
}

export async function resolveLocalRepoWriteBoundaryForPath(
  repoPath: string,
  signal?: AbortSignal,
): Promise<RepoWriteBoundary> {
  return (await resolveLocalRepoExecution(repoPath, signal)).boundary
}

export async function resolveLocalRepoExecution(
  repoPath: string,
  signal?: AbortSignal,
): Promise<LocalRepoExecutionSnapshot> {
  try {
    const canonicalRepoPath = await fs.realpath(repoPath)
    signal?.throwIfAborted()
    const commonDir = await resolveRepoCommonDir(canonicalRepoPath, { signal })
    signal?.throwIfAborted()
    return {
      canonicalRepoPath,
      boundary: {
        kind: 'local-git',
        commonDir,
      },
    }
  } catch {
    signal?.throwIfAborted()
    throw new RepositoryBoundaryUnavailableError()
  }
}

async function resolveRemoteRepoWriteBoundary(repoId: WorkspaceId, signal?: AbortSignal): Promise<RepoWriteBoundary> {
  return await resolveRepoWriteBoundaryForLocator(repoId, undefined, signal)
}

export async function resolveRepoWriteBoundaryForLocator(
  repoId: WorkspaceId,
  runtime?: RepoSourceRuntimeContext,
  signal?: AbortSignal,
): Promise<RepoWriteBoundary> {
  const locator = parseWorkspaceLocator(repoId, serverWorkspaceLocatorPlatform())
  if (!locator) throw new Error('error.workspace-locator-malformed')
  if (locator.transport === 'file') return await resolveLocalRepoWriteBoundary(repoId, signal)
  const target = await resolveRemoteWorkspaceTarget(repoId, runtime, signal)
  return await resolveRemoteRepoWriteBoundaryForTarget(
    target,
    signal,
    runtime ? remoteRuntimeAwareGitRunner(repoId, runtime.workspaceRuntimeId, target) : undefined,
  )
}

export async function resolveRemoteRepoWriteBoundaryForTarget(
  target: RemoteWorkspaceTarget,
  signal?: AbortSignal,
  run?: RemoteGitRunner,
): Promise<RepoWriteBoundary> {
  const commonDir = await resolveRemoteRepoCommonDir(target, { signal, run })
  signal?.throwIfAborted()
  if (!commonDir) throw new RepositoryBoundaryUnavailableError()
  const sshOptions = target.sshConnection?.options ?? []
  return {
    kind: 'remote-git',
    executionIdentity: JSON.stringify({
      host: target.host,
      user: target.user,
      port: target.port,
      options: sshOptions,
      ...(sshOptions.some(sshOptionUsesOriginalDestination)
        ? { destination: target.sshConnection?.destination ?? target.alias }
        : {}),
      writeGroupPath: commonDir,
    }),
  }
}

function sshOptionUsesOriginalDestination(option: string): boolean {
  for (let index = 0; index < option.length - 1; index += 1) {
    if (option[index] !== '%') continue
    const token = option[index + 1]
    if (token === '%') {
      index += 1
      continue
    }
    if (token === 'n') return true
  }
  return false
}

export async function resolveRepoWriteBoundaryKey(repoId: WorkspaceId, signal?: AbortSignal): Promise<string> {
  const boundary = isRemoteWorkspaceId(repoId)
    ? await resolveRemoteRepoWriteBoundary(repoId, signal)
    : await resolveLocalRepoWriteBoundary(repoId, signal)
  return repoWriteBoundaryKey(boundary)
}
