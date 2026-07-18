// Source layer for the worktree-scoped file tree (docs/filetree.md).
//
// This module reads one directory level at a time. The UI composes
// those direct-children responses into a lazy tree; this layer never
// returns a pre-expanded subtree.

import path from 'node:path'
import { readdir } from 'node:fs/promises'
import { execa } from 'execa'
import type { RepoTreeNode } from '#/shared/api-types.ts'
import type { WorktreeInfo } from '#/shared/git-types.ts'
import type { RemoteRepoTarget } from '#/shared/remote-repo.ts'
import { getRemoteTreeWalk, type RemoteGitRunner } from '#/system/ssh/git.ts'
import { getRemoteDirectoryWalk } from '#/system/ssh/filesystem.ts'
import {
  buildLimitedChildNodes,
  parseNullSeparatedPaths,
  stripRemoteEntryPrefix,
} from '#/server/modules/repo-tree-source-pure.ts'

export const MAX_REPO_TREE_NODES = 50_000

export interface RepoTreeSourceOptions {
  /** POSIX path relative to the worktree root. Empty means the root directory. */
  readonly prefix?: string
}

export interface RepoTreeSourceResult {
  readonly nodes: ReadonlyArray<RepoTreeNode>
  readonly truncated: boolean
}

export async function getRepoTreeSourceLocal(
  worktreePath: string,
  options: RepoTreeSourceOptions,
  signal: AbortSignal | undefined,
): Promise<RepoTreeSourceResult> {
  if (signal?.aborted) throw new Error('aborted')
  const prefix = normalizePrefix(options.prefix)
  if (!isSafeNormalizedPrefix(prefix)) throw new Error('invalid tree prefix')
  return await getRepoTreeDirectoryChildrenLocal(worktreePath, prefix, signal)
}

export async function getWorkspaceTreeSourceLocal(
  workspacePath: string,
  options: RepoTreeSourceOptions,
  signal: AbortSignal | undefined,
): Promise<RepoTreeSourceResult> {
  if (signal?.aborted) throw new Error('aborted')
  const prefix = normalizePrefix(options.prefix)
  if (!isSafeNormalizedPrefix(prefix)) throw new Error('invalid tree prefix')
  const entries = await readDirectoryEntriesLocal(workspacePath, prefix, signal)
  return nodesFromDirectoryEntries(
    prefix,
    entries.map((entry) => entry.treeEntry),
  )
}

export interface GetRepoTreeSourceRemoteInput {
  readonly target: RemoteRepoTarget
  readonly worktreePath: string
  readonly options: RepoTreeSourceOptions
  readonly signal: AbortSignal | undefined
  readonly run?: RemoteGitRunner
  /** Optional trusted worktree list from the caller. */
  readonly knownWorktrees?: ReadonlyArray<WorktreeInfo>
}

export async function getRepoTreeSourceRemote(input: GetRepoTreeSourceRemoteInput): Promise<RepoTreeSourceResult> {
  return await readRepoTreeSourceRemote(input, getRemoteTreeWalk)
}

export async function getWorkspaceTreeSourceRemote(
  input: Omit<GetRepoTreeSourceRemoteInput, 'knownWorktrees'>,
): Promise<RepoTreeSourceResult> {
  return await readRepoTreeSourceRemote(input, getRemoteDirectoryWalk)
}

async function readRepoTreeSourceRemote(
  input: GetRepoTreeSourceRemoteInput,
  readDirectory: typeof getRemoteTreeWalk | typeof getRemoteDirectoryWalk,
): Promise<RepoTreeSourceResult> {
  const { target, worktreePath, options, signal, run, knownWorktrees } = input
  if (signal?.aborted) throw new Error('aborted')

  const prefix = normalizePrefix(options.prefix)
  if (!isSafeNormalizedPrefix(prefix)) throw new Error('invalid tree prefix')

  const remoteResult = await readDirectory(target, worktreePath, {
    signal,
    prefix,
    ...(run ? { run } : {}),
    ...(knownWorktrees ? { knownWorktrees } : {}),
  })
  if (signal?.aborted) throw new Error('aborted')
  if (!remoteResult.ok) throw new Error(remoteResult.message)

  const root = worktreePath.replace(/\/+$/u, '')
  const entries = parseNullSeparatedPaths(remoteResult.message)
    .map((entry) => {
      if (path.isAbsolute(entry)) return stripRemoteEntryPrefix(entry, root)
      return entry
    })
    .filter((entry): entry is string => entry !== null)

  return nodesFromDirectoryEntries(prefix, entries)
}

async function getRepoTreeDirectoryChildrenLocal(
  worktreePath: string,
  prefix: string,
  signal: AbortSignal | undefined,
): Promise<RepoTreeSourceResult> {
  const entries = await readDirectoryEntriesLocal(worktreePath, prefix, signal)
  const visibleEntries = await visibleGitDirectoryEntries(worktreePath, entries, signal)
  if (signal?.aborted) throw new Error('aborted')

  return nodesFromDirectoryEntries(
    prefix,
    visibleEntries.map((entry) => entry.treeEntry),
  )
}

async function readDirectoryEntriesLocal(
  rootPath: string,
  prefix: string,
  signal: AbortSignal | undefined,
): Promise<DirectoryEntryCandidate[]> {
  const dirents = await readdir(path.join(rootPath, ...prefix.split('/').filter(Boolean)), { withFileTypes: true })
  if (signal?.aborted) throw new Error('aborted')

  return dirents
    .filter((dirent) => dirent.name !== '.git')
    .map((dirent) => {
      const relative = prefix ? `${prefix}/${dirent.name}` : dirent.name
      const isDirectory = dirent.isDirectory()
      return {
        checkPath: relative,
        treeEntry: isDirectory ? `${relative}/` : relative,
        isDirectory,
      }
    })

}

interface DirectoryEntryCandidate {
  readonly checkPath: string
  readonly treeEntry: string
  readonly isDirectory: boolean
}

async function visibleGitDirectoryEntries(
  worktreePath: string,
  entries: ReadonlyArray<DirectoryEntryCandidate>,
  signal: AbortSignal | undefined,
): Promise<ReadonlyArray<DirectoryEntryCandidate>> {
  const ignored = await ignoredGitPathSet(
    worktreePath,
    entries.map((entry) => entry.checkPath),
    signal,
  )
  if (signal?.aborted) return []
  const ignoredEntries = entries.filter((entry) => ignored.has(entry.checkPath))
  const trackedIgnored = await trackedGitPathSet(worktreePath, ignoredEntries, signal)
  return entries.filter((entry) => !ignored.has(entry.checkPath) || trackedIgnored.has(entry.checkPath))
}

function nodesFromDirectoryEntries(prefix: string, entries: ReadonlyArray<string>): RepoTreeSourceResult {
  const result = buildLimitedChildNodes({ prefix, entries, maxNodes: MAX_REPO_TREE_NODES })
  const nodes: RepoTreeNode[] = result.nodes.map((node) => ({ ...node, status: 'clean' }))
  return { nodes, truncated: result.truncated }
}

async function ignoredGitPathSet(
  worktreePath: string,
  paths: ReadonlyArray<string>,
  signal: AbortSignal | undefined,
): Promise<ReadonlySet<string>> {
  if (paths.length === 0) return new Set()
  try {
    const nul = String.fromCharCode(0)
    const result = await execa('git', ['-C', worktreePath, 'check-ignore', '--stdin', '-z'], {
      // Keep the stdin stream NUL-terminated for paths containing whitespace or newlines.
      input: `${paths.join(nul)}${nul}`,
      reject: false,
      signal,
    })
    if (result.exitCode !== 0 && result.exitCode !== 1) return new Set()
    return new Set(parseNullSeparatedPaths(result.stdout))
  } catch {
    return new Set()
  }
}

async function trackedGitPathSet(
  worktreePath: string,
  entries: ReadonlyArray<DirectoryEntryCandidate>,
  signal: AbortSignal | undefined,
): Promise<ReadonlySet<string>> {
  const paths = entries.map((entry) => entry.checkPath)
  if (paths.length === 0) return new Set()
  try {
    const nul = String.fromCharCode(0)
    const result = await execa(
      'git',
      ['-C', worktreePath, 'ls-files', '-z', '--pathspec-from-file=-', '--pathspec-file-nul'],
      {
        // `--pathspec-file-nul` consumes a NUL-terminated pathspec stream.
        input: `${paths.join(nul)}${nul}`,
        reject: false,
        signal,
      },
    )
    if (result.exitCode !== 0) return new Set()
    const trackedEntries = new Set(parseNullSeparatedPaths(result.stdout))
    return new Set(
      entries
        .filter((candidate) => {
          if (trackedEntries.has(candidate.checkPath)) return true
          if (!candidate.isDirectory) return false
          for (const trackedEntry of trackedEntries) {
            if (trackedEntry.startsWith(`${candidate.checkPath}/`)) return true
          }
          return false
        })
        .map((candidate) => candidate.checkPath),
    )
  } catch {
    return new Set()
  }
}

function normalizePrefix(prefix: string | undefined): string {
  if (!prefix) return ''
  const trimmed = prefix
    .split(path.sep)
    .join('/')
    .replace(/^\.\/+/, '')
    .replace(/\/+$/, '')
  if (trimmed === '.' || trimmed === '') return ''
  return trimmed.replace(/^\/+/, '')
}

function isSafeNormalizedPrefix(prefix: string): boolean {
  if (prefix === '') return true
  if (prefix.includes('\0')) return false
  return !prefix.split('/').includes('..')
}
