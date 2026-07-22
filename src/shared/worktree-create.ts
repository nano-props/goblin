// Canonical mode-discriminated input for "create a worktree".
//
// Every layer — web (dialog), server (IPC + repo backend), system (git
// worktree add / SSH command script) — speaks the same shape. The trust
// boundary is `normalizeCreateWorktreeInput`: anything coming in from the
// client is re-validated here, then re-validated again by the system
// layer that maps it to argv or a shell script. Two layers of validation
// keep a malformed payload from ever reaching `git worktree add`.
//
// We deliberately exclude the `detached` mode here — detached worktrees
// would land in `worktreesByPath` but have no matching `BranchSnapshotInfo`,
// which leaves them invisible in the BranchNavigator. Reintroducing the mode
// should be a paired change with a detached-worktree row in the list.

import * as v from 'valibot'
import { isSafeBranchName, isSafeRefName, isSafeRemoteName } from '#/shared/refnames.ts'
import type { WorktreeBootstrapDecision } from '#/shared/worktree-bootstrap-summary.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'

export type CreateWorktreeMode =
  | { kind: 'newBranch'; newBranch: string; baseRef: string }
  | { kind: 'existingBranch'; branch: string }
  | { kind: 'trackRemoteBranch'; remote: RemoteTrackingBranchIdentity; localBranch: string }

export const RemoteTrackingBranchIdentitySchema = v.strictObject({
  ref: v.pipe(v.string(), v.check(isSafeRefName)),
  remote: v.pipe(v.string(), v.check(isSafeRemoteName)),
  branch: v.pipe(v.string(), v.check(isSafeBranchName)),
})

export type RemoteTrackingBranchIdentity = v.InferOutput<typeof RemoteTrackingBranchIdentitySchema>

export interface RemoteFetchAuthority {
  name: string
  fetchSpecs: readonly string[]
}

export interface CreateWorktreeInput {
  worktreePath: string
  mode: CreateWorktreeMode
}

/** Wire-shape envelope used by the IPC bridge: includes `cwd` on top of the canonical input. */
export interface CreateWorktreeIpcInput extends CreateWorktreeInput {
  cwd: WorkspaceId
  workspaceRuntimeId: string
  worktreeBootstrap: WorktreeBootstrapDecision
}

export function normalizeCreateWorktreeInput(input: unknown): CreateWorktreeInput | null {
  if (!input || typeof input !== 'object') return null
  const raw = input as { worktreePath?: unknown; mode?: unknown }
  const worktreePath = typeof raw.worktreePath === 'string' ? raw.worktreePath.trim() : ''
  if (!worktreePath) return null
  const mode = normalizeCreateWorktreeMode(raw.mode)
  return mode ? { worktreePath, mode } : null
}

function normalizeCreateWorktreeMode(input: unknown): CreateWorktreeMode | null {
  if (!input || typeof input !== 'object') return null
  const mode = input as Record<string, unknown>
  switch (mode.kind) {
    case 'newBranch': {
      const newBranch = stringField(mode.newBranch)
      const baseRef = stringField(mode.baseRef)
      return newBranch && baseRef && isSafeBranchName(newBranch) && isSafeRefInput(baseRef)
        ? { kind: 'newBranch', newBranch, baseRef }
        : null
    }
    case 'existingBranch': {
      const branch = stringField(mode.branch)
      return branch && isSafeBranchName(branch) ? { kind: 'existingBranch', branch } : null
    }
    case 'trackRemoteBranch': {
      const remote = v.safeParse(RemoteTrackingBranchIdentitySchema, mode.remote)
      const localBranch = stringField(mode.localBranch)
      return remote.success && localBranch && isSafeBranchName(localBranch)
        ? { kind: 'trackRemoteBranch', remote: remote.output, localBranch }
        : null
    }
    default:
      return null
  }
}

function stringField(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isSafeRefInput(ref: string): boolean {
  return isSafeBranchName(ref)
}

/** Resolve full remote-tracking refs against the authoritative remote names. */
export function parseRemoteTrackingRefs(
  output: string,
  remotes: readonly RemoteFetchAuthority[],
): RemoteTrackingBranchIdentity[] {
  const remoteNames = remotes.map((remote) => remote.name)
  if (new Set(remoteNames).size !== remoteNames.length || remoteNames.some((remote) => !isSafeRemoteName(remote))) {
    throw new Error('Invalid remote name authority')
  }
  const refs = output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  if (new Set(refs).size !== refs.length) throw new Error('Invalid remote-tracking ref output')
  const authorities = remotes.map((remote) => ({
    name: remote.name,
    positive: remote.fetchSpecs
      .filter((spec) => !spec.startsWith('^') && !spec.startsWith('+^'))
      .map(parsePositiveFetchRefspec)
      .filter((spec): spec is PositiveFetchRefspec => spec !== null),
    negative: remote.fetchSpecs.filter((spec) => spec.startsWith('^') || spec.startsWith('+^')).map(parseNegativeFetchRefspec),
  }))
  const parsed: RemoteTrackingBranchIdentity[] = []
  for (const fullRef of refs) {
    if (!fullRef.startsWith('refs/remotes/') || !isSafeBranchName(fullRef)) {
      throw new Error('Invalid remote-tracking ref output')
    }
    const matches = authorities.flatMap((remote) => {
      const branches = remote.positive.flatMap((spec) => {
        const sourceRef = sourceRefForDestination(fullRef, spec)
        if (!sourceRef || remote.negative.some((negative) => matchesRefspecSource(sourceRef, negative))) return []
        const branch = sourceRef.slice('refs/heads/'.length)
        return [{ remote: remote.name, branch }]
      })
      return [...new Map(branches.map((match) => [match.branch, match])).values()]
    })
    const uniqueMatches = [...new Map(matches.map((match) => [`${match.remote}\0${match.branch}`, match])).values()]
    if (uniqueMatches.length === 0) continue
    if (uniqueMatches.length !== 1) throw new Error('Ambiguous remote-tracking ref ownership')
    const [match] = uniqueMatches
    if (match.branch !== 'HEAD') parsed.push({ ref: fullRef, remote: match.remote, branch: match.branch })
  }
  return parsed
}

interface PositiveFetchRefspec {
  source: string
  destination: string
}

interface NegativeFetchRefspec {
  source: string
}

function stripForce(spec: string): string {
  return spec.startsWith('+') ? spec.slice(1) : spec
}

function parsePositiveFetchRefspec(rawSpec: string): PositiveFetchRefspec | null {
  const spec = stripForce(rawSpec)
  const separator = spec.indexOf(':')
  if (spec.startsWith('^') || separator !== spec.lastIndexOf(':')) {
    throw new Error('Invalid remote fetch refspec')
  }
  if (separator < 0) {
    if (!isValidRefspecPattern(spec)) throw new Error('Invalid remote fetch refspec')
    return null
  }
  const source = spec.slice(0, separator)
  const destination = spec.slice(separator + 1)
  const sourceStars = countStars(source)
  const destinationStars = countStars(destination)
  if (
    !isValidRefspecPattern(source) ||
    !isValidRefspecPattern(destination) ||
    sourceStars > 1 ||
    destinationStars !== sourceStars
  ) {
    throw new Error('Invalid remote fetch refspec')
  }
  if (!source.startsWith('refs/heads/') || !destination.startsWith('refs/remotes/')) return null
  return { source, destination }
}

function parseNegativeFetchRefspec(rawSpec: string): NegativeFetchRefspec {
  if (rawSpec.startsWith('+')) throw new Error('Invalid negative remote fetch refspec')
  const spec = rawSpec
  if (!spec.startsWith('^') || spec.includes(':')) throw new Error('Invalid negative remote fetch refspec')
  const source = spec.slice(1)
  if (!isValidRefspecPattern(source) || countStars(source) > 1) {
    throw new Error('Invalid negative remote fetch refspec')
  }
  return { source }
}

function sourceRefForDestination(ref: string, spec: PositiveFetchRefspec): string | null {
  if (!spec.destination.includes('*')) {
    if (ref !== spec.destination) return null
    const branch = spec.source.slice('refs/heads/'.length)
    return branch === 'HEAD' || isSafeBranchName(branch) ? spec.source : null
  }
  const [destinationPrefix, destinationSuffix] = spec.destination.split('*') as [string, string]
  if (
    !ref.startsWith(destinationPrefix) ||
    !ref.endsWith(destinationSuffix) ||
    ref.length < destinationPrefix.length + destinationSuffix.length
  ) {
    return null
  }
  const capture = ref.slice(destinationPrefix.length, ref.length - destinationSuffix.length)
  const [sourcePrefix, sourceSuffix] = spec.source.split('*') as [string, string]
  const sourceRef = `${sourcePrefix}${capture}${sourceSuffix}`
  const branch = sourceRef.slice('refs/heads/'.length)
  return branch === 'HEAD' || isSafeBranchName(branch) ? sourceRef : null
}

function matchesRefspecSource(ref: string, spec: NegativeFetchRefspec): boolean {
  if (!spec.source.includes('*')) return ref === spec.source
  const [prefix, suffix] = spec.source.split('*') as [string, string]
  return ref.startsWith(prefix) && ref.endsWith(suffix) && ref.length >= prefix.length + suffix.length
}

function countStars(value: string): number {
  return [...value].filter((character) => character === '*').length
}

function isValidRefspecPattern(value: string): boolean {
  if (countStars(value) > 1) return false
  return isSafeRefName(value.replace('*', 'refspec-pattern'))
}

/** Derive the local branch from the producer's structured remote identity. */
export function deriveLocalBranchFromRemoteRef(remote: RemoteTrackingBranchIdentity): string {
  return remote.branch
}
