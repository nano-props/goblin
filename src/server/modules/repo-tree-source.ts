// Source layer for the worktree-scoped file tree (docs/filetree.md).
//
// This module is responsible for two things only:
//   1. Enumerate visible git worktree files under the worktree root,
//      honouring git's standard exclude rules and the depth bound.
//   2. Return the stable node shape consumed by the React Aria tree.
//
// The source layer never touches the HTTP envelope, the route layer,
// or UI types. Its output is the wire-shaped { nodes, truncated }
// minus the wire envelope -- the read layer (repo-tree.ts) is the
// only thing allowed to wrap it into RepoTreeResult.
//
// SSH remote enumeration lives in the same module but in a separate
// function (getRepoTreeSourceRemote); the read layer dispatches
// based on the cwd's repo kind.
//
// Public surface (the only stable contract):
//   - getRepoTreeSourceLocal / getRepoTreeSourceRemote -- the two
//     fetchers the read layer calls.
//   - MAX_REPO_TREE_NODES / MAX_REPO_TREE_DEPTH -- the bounds the
//     wire schema enforces at the perimeter.
//   - RepoTreeSourceOptions / RepoTreeSourceResult -- the option /
//     result shapes.
// Pure transforms behind the fetchers (buildNodes, the NUL parser,
// the path-prefix stripper) live in
// `repo-tree-source-pure.ts` and are NOT re-exported from here --
// tests import them directly from the pure module. This keeps the
// source layer's public surface narrow.

import path from 'node:path'
import { execa } from 'execa'
import type { RepoTreeNode } from '#/shared/api-types.ts'
import type { WorktreeInfo } from '#/shared/git-types.ts'
import type { RemoteRepoTarget } from '#/shared/remote-repo.ts'
import { getRemoteTreeWalk } from '#/system/ssh/git.ts'
import {
  buildNodes,
  parseNullSeparatedPaths,
  stripRemoteEntryPrefix,
} from '#/server/modules/repo-tree-source-pure.ts'

/** Hard cap on nodes emitted in a single response. Sized so a fully
 *  expanded tree of a normal-sized repo fits, while oversized
 *  worktrees still get a bounded in-process transform. */
export const MAX_REPO_TREE_NODES = 50_000

/** Hard cap on depth requested by callers. The schema enforces
 *  this same bound at the perimeter -- duplicated here as a defensive
 *  upper bound for direct callers of the source layer. */
export const MAX_REPO_TREE_DEPTH = 10

export interface RepoTreeSourceOptions {
  /** POSIX path relative to the worktree root. The result is rooted
   *  at prefix and contains nodes at or below it. */
  readonly prefix?: string
  /** Inclusive maximum directory depth from the worktree root. The
   *  root directory itself counts as depth 0. Default 10. */
  readonly depth?: number
}

export interface RepoTreeSourceResult {
  readonly nodes: ReadonlyArray<RepoTreeNode>
  readonly truncated: boolean
}

/** Local FS implementation of the source layer. The read layer calls
 *  this when the cwd is a local repo; SSH goes through
 *  getRepoTreeSourceRemote (PR 5). */
export async function getRepoTreeSourceLocal(
  worktreePath: string,
  options: RepoTreeSourceOptions,
  signal: AbortSignal | undefined,
): Promise<RepoTreeSourceResult> {
  if (signal?.aborted) return { nodes: [], truncated: false }

  const depth = clampDepth(options.depth ?? MAX_REPO_TREE_DEPTH)
  const prefix = normalizePrefix(options.prefix)
  let entries: string[]
  try {
    const result = await execa('git', ['-C', worktreePath, 'ls-files', '-co', '--exclude-standard', '-z'], {
      reject: false,
      signal,
    })
    if (result.exitCode !== 0) return { nodes: [], truncated: false }
    entries = parseNullSeparatedPaths(result.stdout)
  } catch (err) {
    if (signal?.aborted) return { nodes: [], truncated: false }
    // Unknown git/FS errors: surface as an empty result so the route
    // layer does not 500; the read layer returns the empty envelope.
    void err
    return { nodes: [], truncated: false }
  }
  if (signal?.aborted) return { nodes: [], truncated: false }

  const candidateEntries = filterCandidateEntries(entries, prefix, depth)
  const limitedEntries = candidateEntries.slice(0, MAX_REPO_TREE_NODES + 1)
  const allNodes = buildNodes({
    worktreePath,
    prefix,
    depth,
    entries: limitedEntries,
  })

  const truncated = candidateEntries.length > MAX_REPO_TREE_NODES || allNodes.length > MAX_REPO_TREE_NODES
  const sliced = truncated ? allNodes.slice(0, MAX_REPO_TREE_NODES) : allNodes

  const nodes: RepoTreeNode[] = sliced.map((node) => ({ ...node, status: 'clean' }))

  return { nodes, truncated }
}

export interface GetRepoTreeSourceRemoteInput {
  readonly target: RemoteRepoTarget
  readonly worktreePath: string
  readonly options: RepoTreeSourceOptions
  readonly signal: AbortSignal | undefined
  /** Optional trusted worktree list from the caller. When supplied the
   *  underlying `getRemoteTreeWalk` skips its own `gitWorktreeList`
   *  round trip and validates the requested path against this list. */
  readonly knownWorktrees?: ReadonlyArray<WorktreeInfo>
}

/** SSH implementation of the source layer. The remote side runs a
 *  git-owned file enumeration over the worktree root, returns
 *  NUL-separated POSIX paths, and the local process builds the same
 *  node shape via `buildNodes` so the view is unchanged.
 *
 *  Remote enumeration uses the same `git ls-files -co
 *  --exclude-standard` semantics as the local path, so ignored files
 *  and git's standard excludes are handled by git on both sides. */
export async function getRepoTreeSourceRemote(input: GetRepoTreeSourceRemoteInput): Promise<RepoTreeSourceResult> {
  const { target, worktreePath, options, signal, knownWorktrees } = input
  if (signal?.aborted) return { nodes: [], truncated: false }

  const depth = clampDepth(options.depth ?? MAX_REPO_TREE_DEPTH)
  const prefix = normalizePrefix(options.prefix)

  let remoteResult
  try {
    remoteResult = await getRemoteTreeWalk(target, worktreePath, {
      signal,
      depth,
      ...(knownWorktrees ? { knownWorktrees } : {}),
    })
  } catch (err) {
    if (signal?.aborted) return { nodes: [], truncated: false }
    // Surface as an empty result so the read layer does not 500.
    void err
    return { nodes: [], truncated: false }
  }
  if (signal?.aborted) return { nodes: [], truncated: false }
  if (!remoteResult.ok) return { nodes: [], truncated: false }

  const rawEntries = parseNullSeparatedPaths(remoteResult.message)
  if (signal?.aborted) return { nodes: [], truncated: false }

  // Older tests and commands may provide absolute paths rooted at the
  // worktree; the current command returns relative POSIX paths. Accept
  // both shapes and normalize to the same relative entry contract.
  const root = worktreePath.replace(/\/+$/u, '')
  const entries = rawEntries
    .map((entry) => {
      if (path.isAbsolute(entry)) return stripRemoteEntryPrefix(entry, root)
      return entry
    })
    .filter((entry): entry is string => entry !== null)

  const candidateEntries = filterCandidateEntries(entries, prefix, depth)
  const limitedEntries = candidateEntries.slice(0, MAX_REPO_TREE_NODES + 1)
  const allNodes = buildNodes({
    worktreePath,
    prefix,
    depth,
    entries: limitedEntries,
  })

  const truncated = candidateEntries.length > MAX_REPO_TREE_NODES || allNodes.length > MAX_REPO_TREE_NODES
  const sliced = truncated ? allNodes.slice(0, MAX_REPO_TREE_NODES) : allNodes

  const nodes: RepoTreeNode[] = sliced.map((node) => ({ ...node, status: 'clean' }))

  return { nodes, truncated }
}

function clampDepth(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return MAX_REPO_TREE_DEPTH
  return Math.min(Math.floor(value), MAX_REPO_TREE_DEPTH)
}

function normalizePrefix(prefix: string | undefined): string {
  if (!prefix) return ''
  const trimmed = prefix
    .split(path.sep)
    .join('/')
    .replace(/^\.\/+/, '')
    .replace(/\/+$/, '')
  if (trimmed === '.' || trimmed === '') return ''
  // POSIX style: relative to root, no leading slash.
  return trimmed.replace(/^\/+/, '')
}

function filterCandidateEntries(entries: ReadonlyArray<string>, prefix: string, depth: number): string[] {
  const prefixWithSep = prefix ? `${prefix}/` : ''
  return entries.filter((entry) => {
    const relative = entry.split(path.sep).join('/')
    if (relative === '') return false
    if (prefix && relative !== prefix && !relative.startsWith(prefixWithSep)) return false
    const segments = relative.split('/').filter(Boolean).length
    return segments <= depth
  })
}
