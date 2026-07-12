import { createHash } from 'node:crypto'
import { realpath } from 'node:fs'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { getWorktrees } from '#/system/git/worktrees.ts'
import { resolveRemoteTargetWithConfigFingerprint } from '#/system/ssh/config.ts'
import { resolveRemoteWorktree } from '#/system/ssh/git.ts'
import {
  buildCanonicalSshConnectionSnapshot,
  runRemoteCommand,
  type RemoteCommandRunner,
} from '#/system/ssh/commands.ts'
import { resolveKnownWorktree } from '#/shared/worktree-guards.ts'
import { isRemoteRepoId, normalizeRemoteRepoRef, parseRemoteRepoId } from '#/shared/remote-repo.ts'
import {
  isCurrentRepoRuntime,
  onRepoRuntimeClosed,
  type RepoRuntimeClosedEvent,
} from '#/server/modules/repo-runtimes.ts'
import { remoteRuntimeFailureFromCommandResult } from '#/server/modules/remote-runtime-failure.ts'
import {
  physicalWorktreeIdentityKey,
  type PhysicalWorktreeIdentity,
} from '#/server/worktree-removal/physical-worktree-identity.ts'

export interface ResolvePhysicalWorktreeIdentityInput {
  userId: string
  repoRoot: string
  repoRuntimeId: string
  worktreePath: string
  /** Retained for call-site intent; every resolution is fresh. */
  refresh?: boolean
  signal?: AbortSignal
}

declare const physicalWorktreeCapabilityBrand: unique symbol
export interface PhysicalWorktreeCapability {
  readonly identity: PhysicalWorktreeIdentity
  readonly [physicalWorktreeCapabilityBrand]: true
}

type ResolvedRemoteTarget = Awaited<ReturnType<typeof resolveRemoteTargetWithConfigFingerprint>>['target']
export type PhysicalWorktreeExecutionBinding =
  | {
      readonly kind: 'local'
      readonly canonicalWorktreePath: string
      readonly endpointMarker: PhysicalWorktreeEndpointMarker
    }
  | {
      readonly kind: 'remote'
      readonly canonicalWorktreePath: string
      readonly target: Readonly<ResolvedRemoteTarget>
      readonly configFingerprint: string
      readonly endpointMarker: PhysicalWorktreeEndpointMarker
    }

export interface PhysicalWorktreeEndpointMarker {
  readonly deviceId: string
  readonly inode: string
}

interface PhysicalWorktreeCapabilityState {
  userId: string
  repoRoot: string
  repoRuntimeId: string
  worktreePath: string
  execution: PhysicalWorktreeExecutionBinding
  runtimeSignal: AbortSignal
  validateExecution(signal: AbortSignal): Promise<void>
}

const physicalWorktreeCapabilities = new WeakMap<PhysicalWorktreeCapability, PhysicalWorktreeCapabilityState>()

interface PhysicalWorktreeRuntimeEpoch {
  key: string
  userId: string
  repoRoot: string
  repoRuntimeId: string
  active: boolean
  abortController: AbortController
  expectedIdentityKeyByTarget: Map<string, string>
  inFlightByTarget: Map<string, Promise<PhysicalWorktreeCapability>>
  remoteConfigFingerprint: string | null
}

export interface PhysicalWorktreeIdentityResolverDependencies {
  getLocalWorktrees: typeof getWorktrees
  nativeRealpath(path: string): Promise<string>
  nativeStat(path: string): Promise<PhysicalWorktreeEndpointMarker>
  resolveRemoteTarget: typeof resolveRemoteTargetWithConfigFingerprint
  resolveRemoteWorktree: typeof resolveRemoteWorktree
  runRemoteCommand: RemoteCommandRunner
  isCurrentRepoRuntime: typeof isCurrentRepoRuntime
  onRepoRuntimeClosed: typeof onRepoRuntimeClosed
}

const defaultDependencies: PhysicalWorktreeIdentityResolverDependencies = {
  getLocalWorktrees: getWorktrees,
  nativeRealpath,
  nativeStat,
  resolveRemoteTarget: resolveRemoteTargetWithConfigFingerprint,
  resolveRemoteWorktree,
  runRemoteCommand: async (command, target, options) => await runRemoteCommand(target, command, options),
  isCurrentRepoRuntime,
  onRepoRuntimeClosed,
}

/** Provider-owned canonical identity resolver, scoped to live repo-runtime epochs. */
export class PhysicalWorktreeIdentityResolver {
  private readonly deps: PhysicalWorktreeIdentityResolverDependencies
  private readonly epochs = new Map<string, PhysicalWorktreeRuntimeEpoch>()
  private readonly unsubscribeRepoRuntimeClosed: () => void
  private disposed = false

  constructor(deps: Partial<PhysicalWorktreeIdentityResolverDependencies> = {}) {
    this.deps = { ...defaultDependencies, ...deps }
    this.unsubscribeRepoRuntimeClosed = this.deps.onRepoRuntimeClosed((event) => this.releaseRuntime(event))
  }

  /** Provider extension point; capability issuance remains owned by resolver instances. */
  protected issueCapability(input: {
    identity: PhysicalWorktreeIdentity
    userId: string
    repoRoot: string
    repoRuntimeId: string
    worktreePath: string
    execution: PhysicalWorktreeExecutionBinding
    runtimeSignal: AbortSignal
    validateExecution(signal: AbortSignal): Promise<void>
  }): PhysicalWorktreeCapability {
    return issuePhysicalWorktreeCapability(input.identity, {
      userId: input.userId,
      repoRoot: input.repoRoot,
      repoRuntimeId: input.repoRuntimeId,
      worktreePath: input.worktreePath,
      execution: input.execution,
      runtimeSignal: input.runtimeSignal,
      validateExecution: input.validateExecution,
    })
  }

  async capture(input: ResolvePhysicalWorktreeIdentityInput): Promise<PhysicalWorktreeCapability> {
    if (!input.userId || !input.repoRoot || !input.repoRuntimeId) throw new Error('error.invalid-worktree-identity')
    const epoch = this.activeEpoch(input)
    const remote = isRemoteRepoId(input.repoRoot)
    const targetPath = remote ? normalizedRemoteWorktreePath(input) : path.resolve(input.worktreePath)
    const targetKey = `${remote ? 'remote' : 'local'}\0${targetPath}`
    let operation = epoch.inFlightByTarget.get(targetKey)
    if (!operation) {
      operation = this.resolveAndBind(epoch, input, targetKey, targetPath, remote)
      epoch.inFlightByTarget.set(targetKey, operation)
      const cleanup = () => {
        if (epoch.inFlightByTarget.get(targetKey) === operation) epoch.inFlightByTarget.delete(targetKey)
      }
      operation.then(cleanup, cleanup)
    }
    return await awaitWithAbort(operation, input.signal)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.unsubscribeRepoRuntimeClosed()
    for (const epoch of this.epochs.values()) deactivateEpoch(epoch)
    this.epochs.clear()
  }

  private async resolveAndBind(
    epoch: PhysicalWorktreeRuntimeEpoch,
    input: ResolvePhysicalWorktreeIdentityInput,
    targetKey: string,
    targetPath: string,
    remote: boolean,
  ): Promise<PhysicalWorktreeCapability> {
    const signal = epoch.abortController.signal
    const resolved = remote
      ? await this.resolveRemote(epoch, input, targetPath, signal)
      : await this.resolveLocal(epoch, input, targetPath, signal)
    this.assertEpochActive(epoch)
    const identity = resolved.identity
    const identityKey = `${physicalWorktreeIdentityKey(identity)}\0${endpointMarkerKey(resolved.execution.endpointMarker)}`
    const expectedIdentityKey = epoch.expectedIdentityKeyByTarget.get(targetKey)
    if (expectedIdentityKey && expectedIdentityKey !== identityKey) throw new Error('error.repo-runtime-stale')
    epoch.expectedIdentityKeyByTarget.set(targetKey, identityKey)
    return issuePhysicalWorktreeCapability(identity, {
      userId: input.userId,
      repoRoot: input.repoRoot,
      repoRuntimeId: input.repoRuntimeId,
      worktreePath: targetPath,
      execution: resolved.execution,
      runtimeSignal: epoch.abortController.signal,
      validateExecution: async (signal) => await this.validateExecution(epoch, identity, resolved.execution, signal),
    })
  }

  private async resolveLocal(
    epoch: PhysicalWorktreeRuntimeEpoch,
    input: ResolvePhysicalWorktreeIdentityInput,
    worktreePath: string,
    signal: AbortSignal,
  ): Promise<{ identity: PhysicalWorktreeIdentity; execution: PhysicalWorktreeExecutionBinding }> {
    const worktrees = await this.deps.getLocalWorktrees(input.repoRoot, { includeStatus: false, signal })
    this.assertEpochActive(epoch)
    const known = resolveKnownWorktree(worktrees, worktreePath)
    if (!known.ok) throw new Error(known.message)
    const endpoint = await this.deps.nativeRealpath(known.path)
    this.assertEpochActive(epoch)
    const endpointMarker = await this.deps.nativeStat(endpoint)
    this.assertEpochActive(epoch)
    return {
      identity: { kind: 'local', executionNamespaceId: 'local', endpoint },
      execution: Object.freeze({ kind: 'local', canonicalWorktreePath: endpoint, endpointMarker }),
    }
  }

  private async resolveRemote(
    epoch: PhysicalWorktreeRuntimeEpoch,
    input: ResolvePhysicalWorktreeIdentityInput,
    worktreePath: string,
    signal: AbortSignal,
  ): Promise<{ identity: PhysicalWorktreeIdentity; execution: PhysicalWorktreeExecutionBinding }> {
    const repo = parseRemoteRepoId(input.repoRoot)
    if (!repo) throw new Error('error.invalid-worktree-identity')
    const resolved = await this.deps.resolveRemoteTarget(
      { alias: repo.alias, remotePath: repo.remotePath },
      signal,
    )
    this.assertEpochActive(epoch)
    if (epoch.remoteConfigFingerprint && epoch.remoteConfigFingerprint !== resolved.configFingerprint) {
      throw new Error('error.repo-runtime-stale')
    }
    epoch.remoteConfigFingerprint = resolved.configFingerprint

    const known = await this.deps.resolveRemoteWorktree(resolved.target, worktreePath, {
      signal,
      run: this.deps.runRemoteCommand,
    })
    this.assertEpochActive(epoch)
    const result = await this.deps.runRemoteCommand(
      { type: 'resolvePhysicalWorktreeIdentity', path: known.path },
      resolved.target,
      { signal },
    )
    this.assertEpochActive(epoch)
    if (!result.ok) {
      const runtimeFailure = remoteRuntimeFailureFromCommandResult({
        repoRoot: input.repoRoot,
        repoRuntimeId: input.repoRuntimeId,
        target: resolved.target,
        result,
      })
      if (runtimeFailure) throw runtimeFailure
      throw new Error(result.message || result.stderr || 'error.unavailable')
    }
    const { identity, endpointMarker } = parseRemotePhysicalWorktreeCapture(result.stdout)
    return {
      identity,
      execution: Object.freeze({
        kind: 'remote',
        canonicalWorktreePath: identity.endpoint,
        target: Object.freeze({ ...resolved.target }),
        configFingerprint: resolved.configFingerprint,
        endpointMarker,
      }),
    }
  }

  private async validateExecution(
    epoch: PhysicalWorktreeRuntimeEpoch,
    identity: PhysicalWorktreeIdentity,
    execution: PhysicalWorktreeExecutionBinding,
    signal: AbortSignal,
  ): Promise<void> {
    signal.throwIfAborted()
    this.assertEpochActive(epoch)
    if (execution.kind === 'local') {
      const marker = await this.deps.nativeStat(execution.canonicalWorktreePath)
      signal.throwIfAborted()
      this.assertEpochActive(epoch)
      if (endpointMarkerKey(marker) !== endpointMarkerKey(execution.endpointMarker)) {
        throw new Error('error.repo-runtime-stale')
      }
      return
    }
    const result = await this.deps.runRemoteCommand(
      { type: 'resolvePhysicalWorktreeIdentity', path: execution.canonicalWorktreePath },
      execution.target,
      { signal },
    )
    signal.throwIfAborted()
    this.assertEpochActive(epoch)
    if (!result.ok) {
      const runtimeFailure = remoteRuntimeFailureFromCommandResult({
        repoRoot: epoch.repoRoot,
        repoRuntimeId: epoch.repoRuntimeId,
        target: execution.target,
        result,
      })
      if (runtimeFailure) throw runtimeFailure
      throw new Error(result.message || result.stderr || 'error.repo-runtime-stale')
    }
    const current = parseRemotePhysicalWorktreeCapture(result.stdout)
    if (
      physicalWorktreeIdentityKey(current.identity) !== physicalWorktreeIdentityKey(identity) ||
      endpointMarkerKey(current.endpointMarker) !== endpointMarkerKey(execution.endpointMarker)
    ) {
      throw new Error('error.repo-runtime-stale')
    }
  }

  private activeEpoch(input: ResolvePhysicalWorktreeIdentityInput): PhysicalWorktreeRuntimeEpoch {
    if (this.disposed || !this.deps.isCurrentRepoRuntime(input.userId, input.repoRoot, input.repoRuntimeId)) {
      throw new Error('error.repo-runtime-stale')
    }
    const key = runtimeKey(input)
    const existing = this.epochs.get(key)
    if (existing) {
      this.assertEpochActive(existing)
      return existing
    }
    const epoch: PhysicalWorktreeRuntimeEpoch = {
      key,
      userId: input.userId,
      repoRoot: input.repoRoot,
      repoRuntimeId: input.repoRuntimeId,
      active: true,
      abortController: new AbortController(),
      expectedIdentityKeyByTarget: new Map(),
      inFlightByTarget: new Map(),
      remoteConfigFingerprint: null,
    }
    this.epochs.set(key, epoch)
    return epoch
  }

  private assertEpochActive(epoch: PhysicalWorktreeRuntimeEpoch): void {
    if (
      this.disposed ||
      !epoch.active ||
      this.epochs.get(epoch.key) !== epoch ||
      !this.deps.isCurrentRepoRuntime(epoch.userId, epoch.repoRoot, epoch.repoRuntimeId)
    ) {
      throw new Error('error.repo-runtime-stale')
    }
  }

  private releaseRuntime(event: RepoRuntimeClosedEvent): void {
    const key = runtimeKey(event)
    const epoch = this.epochs.get(key)
    if (!epoch) return
    deactivateEpoch(epoch)
    this.epochs.delete(key)
  }
}

export function createPhysicalWorktreeIdentityResolver(
  deps: Partial<PhysicalWorktreeIdentityResolverDependencies> = {},
): PhysicalWorktreeIdentityResolver {
  return new PhysicalWorktreeIdentityResolver(deps)
}

export function physicalWorktreeCapabilityExecution(
  capability: PhysicalWorktreeCapability,
): PhysicalWorktreeExecutionBinding {
  return physicalWorktreeCapabilityState(capability).execution
}

export async function validatePhysicalWorktreeCapabilityExecution(
  capability: PhysicalWorktreeCapability,
  signal: AbortSignal | undefined,
): Promise<void> {
  const lease = physicalWorktreeCapabilityLease(capability)
  const operationSignal = signal ? AbortSignal.any([lease.runtimeSignal, signal]) : lease.runtimeSignal
  operationSignal.throwIfAborted()
  await lease.validateExecution(operationSignal)
  operationSignal.throwIfAborted()
}

export interface PhysicalWorktreeCapabilityLease {
  readonly runtimeSignal: AbortSignal
  validateExecution(signal: AbortSignal): Promise<void>
}

/** Provider-registry accessor; the signal is never exposed on the capability value. */
export function physicalWorktreeCapabilityLease(
  capability: PhysicalWorktreeCapability,
): PhysicalWorktreeCapabilityLease {
  const state = physicalWorktreeCapabilityState(capability)
  return Object.freeze({ runtimeSignal: state.runtimeSignal, validateExecution: state.validateExecution })
}

export function assertPhysicalWorktreeCapability(
  capability: PhysicalWorktreeCapability,
  input: ResolvePhysicalWorktreeIdentityInput,
): void {
  const state = physicalWorktreeCapabilityState(capability)
  const worktreePath = isRemoteRepoId(input.repoRoot)
    ? normalizedRemoteWorktreePath(input)
    : path.resolve(input.worktreePath)
  if (
    state.userId !== input.userId ||
    state.repoRoot !== input.repoRoot ||
    state.repoRuntimeId !== input.repoRuntimeId ||
    state.worktreePath !== worktreePath
  ) throw new Error('error.invalid-worktree-capability')
}

function issuePhysicalWorktreeCapability(
  identity: PhysicalWorktreeIdentity,
  state: PhysicalWorktreeCapabilityState,
): PhysicalWorktreeCapability {
  const frozenIdentity = Object.freeze({ ...identity }) as PhysicalWorktreeIdentity
  const capability = Object.freeze({ identity: frozenIdentity }) as PhysicalWorktreeCapability
  const execution =
    state.execution.kind === 'local'
      ? Object.freeze({ ...state.execution, endpointMarker: Object.freeze({ ...state.execution.endpointMarker }) })
      : Object.freeze({
          ...state.execution,
          target: Object.freeze({
            ...state.execution.target,
            sshConnection: Object.freeze({
              ...(state.execution.target.sshConnection ??
                buildCanonicalSshConnectionSnapshot(state.execution.target, '')),
              options: Object.freeze([
                ...(state.execution.target.sshConnection ??
                  buildCanonicalSshConnectionSnapshot(state.execution.target, '')).options,
              ]),
            }),
          }),
          endpointMarker: Object.freeze({ ...state.execution.endpointMarker }),
        })
  physicalWorktreeCapabilities.set(capability, Object.freeze({ ...state, execution }))
  return capability
}

function physicalWorktreeCapabilityState(capability: PhysicalWorktreeCapability): PhysicalWorktreeCapabilityState {
  const state = physicalWorktreeCapabilities.get(capability)
  if (!state) throw new Error('error.invalid-worktree-capability')
  return state
}

export function parseRemotePhysicalWorktreeIdentity(output: string): PhysicalWorktreeIdentity {
  return parseRemotePhysicalWorktreeCapture(output).identity
}

export function parseRemotePhysicalWorktreeEndpointMarker(output: string): PhysicalWorktreeEndpointMarker {
  return parseRemotePhysicalWorktreeCapture(output).endpointMarker
}

function parseRemotePhysicalWorktreeCapture(output: string): {
  identity: PhysicalWorktreeIdentity
  endpointMarker: PhysicalWorktreeEndpointMarker
} {
  const fields = output.split('\0')
  const runtimeToken = fields[0] ?? ''
  const machineFact = fields[1] ?? ''
  const rootNamespaceFact = fields[2] ?? ''
  const endpoint = fields[3] ?? ''
  const deviceId = fields[4] ?? ''
  const inode = fields[5] ?? ''
  if (
    fields.length !== 7 ||
    fields[6] !== '' ||
    !/^[a-f0-9]{32}$/u.test(runtimeToken) ||
    !validRemoteNamespaceFact(machineFact) ||
    !validRemoteNamespaceFact(rootNamespaceFact) ||
    !endpoint.startsWith('/') ||
    !validEndpointMarkerPart(deviceId) ||
    !validEndpointMarkerPart(inode)
  ) {
    throw new Error('error.invalid-worktree-identity')
  }
  const executionNamespaceId = createHash('sha256')
    .update(`goblin-remote-execution-v2\0${runtimeToken}\0${machineFact}\0${rootNamespaceFact}`)
    .digest('hex')
    .slice(0, 32)
  return {
    identity: { kind: 'remote', executionNamespaceId, endpoint },
    endpointMarker: Object.freeze({ deviceId, inode }),
  }
}

function nativeRealpath(input: string): Promise<string> {
  return new Promise((resolve, reject) => {
    realpath.native(input, (error, resolvedPath) => {
      if (error) reject(error)
      else resolve(resolvedPath)
    })
  })
}

async function nativeStat(input: string): Promise<PhysicalWorktreeEndpointMarker> {
  const value = await stat(input, { bigint: true })
  return Object.freeze({ deviceId: value.dev.toString(10), inode: value.ino.toString(10) })
}

function endpointMarkerKey(marker: PhysicalWorktreeEndpointMarker): string {
  return `${marker.deviceId}\0${marker.inode}`
}

function validEndpointMarkerPart(value: string): boolean {
  return value.length > 0 && value.length <= 32 && /^\d+$/u.test(value)
}

function normalizedRemoteWorktreePath(input: ResolvePhysicalWorktreeIdentityInput): string {
  const repo = parseRemoteRepoId(input.repoRoot)
  const worktree = repo ? normalizeRemoteRepoRef({ alias: repo.alias, remotePath: input.worktreePath }) : null
  if (!repo || !worktree) throw new Error('error.invalid-worktree-identity')
  return worktree.remotePath
}

function validRemoteNamespaceFact(value: string): boolean {
  return value.length > 0 && value.length <= 256 && /^[A-Za-z0-9._:-]+$/u.test(value)
}

function runtimeKey(input: { userId: string; repoRoot: string; repoRuntimeId: string }): string {
  return `${input.userId}\0${input.repoRoot}\0${input.repoRuntimeId}`
}

function deactivateEpoch(epoch: PhysicalWorktreeRuntimeEpoch): void {
  if (!epoch.active) return
  epoch.active = false
  epoch.abortController.abort(new Error('error.repo-runtime-stale'))
  epoch.expectedIdentityKeyByTarget.clear()
  epoch.inFlightByTarget.clear()
  epoch.remoteConfigFingerprint = null
}

function awaitWithAbort<T>(operation: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return operation
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise<T>((resolve, reject) => {
    const aborted = () => reject(signal.reason)
    signal.addEventListener('abort', aborted, { once: true })
    operation.then(
      (value) => {
        signal.removeEventListener('abort', aborted)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', aborted)
        reject(error)
      },
    )
  })
}
