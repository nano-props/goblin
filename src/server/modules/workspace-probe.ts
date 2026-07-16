import path from 'node:path'
import { constants as fsConstants } from 'node:fs'
import { git } from '#/system/git/git-exec.ts'
import { parseWorkspaceLocator, type WorkspaceLocatorPlatform } from '#/shared/workspace-locator.ts'
import {
  capabilitiesFromGitProbe,
  type WorkspaceGitProbeResult,
  type WorkspaceSettledProbeState,
  type WorkspaceUnavailableReason,
} from '#/shared/workspace-runtime.ts'
import { resolveServerRemoteRepoConnection } from '#/server/modules/remote.ts'
import { parseGitHubRemoteUrl } from '#/system/github/graphql.ts'

export interface LocalWorkspaceProbeDependencies {
  stat(path: string): Promise<{ isDirectory(): boolean }>
  access(path: string, mode: number): Promise<void>
  realpath(path: string): Promise<string>
  gitRoot(path: string, signal?: AbortSignal): Promise<LocalGitRootProbe>
}

export type LocalGitRootProbe =
  | { status: 'root'; path: string; pullRequests: 'github' | 'none' }
  | { status: 'not-repository' }
  | { status: 'inconclusive'; diagnostic: string }

const defaultDependencies: LocalWorkspaceProbeDependencies = {
  stat: async (workspacePath) => await (await import('node:fs/promises')).stat(workspacePath),
  access: async (workspacePath, mode) => await (await import('node:fs/promises')).access(workspacePath, mode),
  realpath: async (workspacePath) => await (await import('node:fs/promises')).realpath(workspacePath),
  gitRoot: probeLocalGitRoot,
}

export async function probeLocalWorkspace(
  input: string,
  platform: WorkspaceLocatorPlatform,
  options: {
    signal?: AbortSignal
    dependencies?: LocalWorkspaceProbeDependencies
  } = {},
): Promise<WorkspaceSettledProbeState> {
  const locator = parseWorkspaceLocator(input, platform)
  if (!locator) return { status: 'unavailable', reason: 'error.workspace-locator-malformed' }
  if (locator.transport !== 'file') {
    return { status: 'unavailable', reason: 'error.workspace-transport-unsupported' }
  }

  const dependencies = options.dependencies ?? defaultDependencies
  options.signal?.throwIfAborted()
  const directoryFailure = await probeDirectory(locator.path, dependencies)
  if (directoryFailure) return { status: 'unavailable', reason: directoryFailure }

  const write = await canWrite(locator.path, dependencies)
  const gitProbe = await probeGitAtWorkspaceRoot(locator.path, dependencies, options.signal)
  const diagnostics =
    gitProbe.status === 'inconclusive' ? [{ scope: 'git' as const, message: gitProbe.diagnostic }] : []
  return {
    status: 'ready',
    name: workspaceName(locator.path, platform),
    capabilities: capabilitiesFromGitProbe(gitProbe, { write, terminal: true }),
    diagnostics,
  }
}

/** Probe the transport named by the canonical workspace locator. */
export async function probeWorkspace(
  input: string,
  platform: WorkspaceLocatorPlatform,
  options: { signal?: AbortSignal } = {},
): Promise<WorkspaceSettledProbeState> {
  const locator = parseWorkspaceLocator(input, platform)
  if (!locator) return { status: 'unavailable', reason: 'error.workspace-locator-malformed' }
  if (locator.transport === 'file') return await probeLocalWorkspace(input, platform, options)

  const resolved = await resolveServerRemoteRepoConnection({ repoId: input }, options.signal)
  if (resolved.kind === 'failed') {
    return {
      status: 'unavailable',
      reason:
        resolved.lifecycle.reason === 'path-missing'
          ? 'error.workspace-path-not-found'
          : 'error.workspace-transport-unavailable',
    }
  }
  return {
    status: 'ready',
    name: resolved.name,
    capabilities: {
      files: { read: true, write: true },
      terminal: { available: true },
      git: resolved.gitAvailable
        ? { status: 'available', worktrees: true, pullRequests: { provider: 'none' } }
        : { status: 'unavailable' },
    },
    diagnostics: resolved.gitDiagnostic ? [{ scope: 'git', message: resolved.gitDiagnostic }] : [],
  }
}

async function probeDirectory(
  workspacePath: string,
  dependencies: LocalWorkspaceProbeDependencies,
): Promise<WorkspaceUnavailableReason | null> {
  try {
    const value = await dependencies.stat(workspacePath)
    if (!value.isDirectory()) return 'error.workspace-path-not-directory'
    await dependencies.access(workspacePath, fsConstants.R_OK)
    return null
  } catch (error) {
    const code = errorCode(error)
    if (code === 'ENOENT') return 'error.workspace-path-not-found'
    if (code === 'ENOTDIR') return 'error.workspace-path-not-directory'
    if (code === 'EACCES' || code === 'EPERM') return 'error.workspace-permission-denied'
    return 'error.workspace-transport-unavailable'
  }
}

async function canWrite(workspacePath: string, dependencies: LocalWorkspaceProbeDependencies): Promise<boolean> {
  try {
    await dependencies.access(workspacePath, fsConstants.W_OK)
    return true
  } catch {
    return false
  }
}

async function probeGitAtWorkspaceRoot(
  workspacePath: string,
  dependencies: LocalWorkspaceProbeDependencies,
  signal?: AbortSignal,
): Promise<WorkspaceGitProbeResult> {
  const result = await dependencies.gitRoot(workspacePath, signal)
  if (result.status !== 'root') return result
  try {
    const [workspaceRoot, gitRoot] = await Promise.all([
      dependencies.realpath(workspacePath),
      dependencies.realpath(result.path),
    ])
    if (workspaceRoot !== gitRoot) return { status: 'parent-only' }
    return {
      status: 'available',
      worktrees: true,
      pullRequests: { provider: result.pullRequests },
    }
  } catch (error) {
    return { status: 'inconclusive', diagnostic: errorMessage(error) }
  }
}

async function probeLocalGitRoot(workspacePath: string, signal?: AbortSignal): Promise<LocalGitRootProbe> {
  try {
    const root = await git(workspacePath, ['rev-parse', '--show-toplevel'], { signal })
    return { status: 'root', path: root, pullRequests: await localPullRequestProvider(workspacePath, signal) }
  } catch (error) {
    if (isNotRepositoryError(error)) return { status: 'not-repository' }
    return { status: 'inconclusive', diagnostic: errorMessage(error) }
  }
}

async function localPullRequestProvider(workspacePath: string, signal?: AbortSignal): Promise<'github' | 'none'> {
  try {
    const configured = await git(workspacePath, ['config', '--get-regexp', '^remote\\..*\\.url$'], { signal })
    return pullRequestProviderFromGitConfig(configured)
  } catch {
    signal?.throwIfAborted()
    // No matching remote config is a conclusive provider result, not a Git
    // availability failure. Repository capability remains usable without PRs.
    return 'none'
  }
}

export function pullRequestProviderFromGitConfig(configured: string): 'github' | 'none' {
  const hasGitHubRemote = configured.split('\n').some((line) => {
    const separator = line.search(/\s/)
    return separator >= 0 && parseGitHubRemoteUrl(line.slice(separator).trim()) !== null
  })
  return hasGitHubRemote ? 'github' : 'none'
}

function isNotRepositoryError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const stderr = 'stderr' in error && typeof error.stderr === 'string' ? error.stderr : ''
  return /not a git repository/i.test(stderr)
}

function errorCode(error: unknown): string {
  return error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'Git probe failed'
}

function workspaceName(workspacePath: string, platform: WorkspaceLocatorPlatform): string {
  const implementation = platform === 'win32' ? path.win32 : path.posix
  return implementation.basename(workspacePath) || implementation.parse(workspacePath).root
}
