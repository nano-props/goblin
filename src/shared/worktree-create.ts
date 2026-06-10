import { isSafeBranchName } from '#/shared/refnames.ts'

export type CreateWorktreeMode =
  | { kind: 'newBranch'; newBranch: string; baseRef: string }
  | { kind: 'existingBranch'; branch: string }
  | { kind: 'trackRemoteBranch'; remoteRef: string; localBranch: string }
  | { kind: 'detached'; ref: string }

export interface CreateWorktreeInput {
  worktreePath: string
  mode: CreateWorktreeMode
}

export interface CreateWorktreeRpcInput extends CreateWorktreeInput {
  cwd: string
  sourceToken?: string
}

export function parseRemoteTrackingRefs(output: string): string[] {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((ref) => isRemoteTrackingRef(ref))
}

export function deriveLocalBranchFromRemoteRef(remoteRef: string): string | null {
  if (!isRemoteTrackingRef(remoteRef)) return null
  const slash = remoteRef.indexOf('/')
  const branch = slash >= 0 ? remoteRef.slice(slash + 1) : ''
  return isSafeBranchName(branch) ? branch : null
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
      const remoteRef = stringField(mode.remoteRef)
      const localBranch = stringField(mode.localBranch)
      return remoteRef && localBranch && isRemoteTrackingRef(remoteRef) && isSafeBranchName(localBranch)
        ? { kind: 'trackRemoteBranch', remoteRef, localBranch }
        : null
    }
    case 'detached': {
      const ref = stringField(mode.ref)
      return ref && isSafeRefInput(ref) ? { kind: 'detached', ref } : null
    }
    default:
      return null
  }
}

function stringField(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isRemoteTrackingRef(ref: string): boolean {
  const slash = ref.indexOf('/')
  if (slash <= 0) return false
  if (ref.endsWith('/HEAD')) return false
  const remote = ref.slice(0, slash)
  const branch = ref.slice(slash + 1)
  return isSafeRemoteName(remote) && isSafeBranchName(branch)
}

function isSafeRemoteName(remote: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(remote)
}

function isSafeRefInput(ref: string): boolean {
  return isSafeBranchName(ref) || isRemoteTrackingRef(ref)
}
