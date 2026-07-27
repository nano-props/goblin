import { createHash } from 'node:crypto'
import { realpath } from 'node:fs'
import path from 'node:path'
import { parseWorkspaceLocator, type WorkspaceId } from '#/shared/workspace-locator.ts'
import { readWorktreeMembership } from '#/system/git/worktrees.ts'
import { resolveRemoteTargetWithConfigFingerprint } from '#/system/ssh/config.ts'
import { resolveRemoteWorktree } from '#/system/ssh/git.ts'
import { runRemoteCommand, type RemoteCommandRunner } from '#/system/ssh/commands.ts'
import { resolveKnownWorktree } from '#/shared/worktree-guards.ts'
import { isRemoteWorkspaceId, normalizeRemoteWorkspaceRef, parseRemoteWorkspaceId } from '#/shared/remote-workspace.ts'
import {
  isCurrentWorkspaceRuntime,
  onWorkspaceRuntimeClosed,
  type WorkspaceRuntimeClosedEvent,
} from '#/server/modules/workspace-runtimes.ts'
import { remoteWorkspaceRuntimeFailureFromCommandResult } from '#/server/modules/remote-workspace-runtime-failure.ts'
import type { PhysicalWorktreeIdentity } from '#/server/worktree-removal/physical-worktree-identity.ts'
import { localWorkspaceNativePath } from '#/server/modules/workspace-path.ts'
import {
  issuePhysicalWorktreeExecutionCapability,
  type PhysicalWorktreeExecutionBinding,
  type PhysicalWorktreeExecutionCapability,
} from '#/server/worktree-removal/physical-worktree-capability.ts'

export interface ResolvePhysicalWorktreeIdentityInput {
  userId: string
  workspaceId: WorkspaceId
  workspaceRuntimeId: string
  worktreePath: string
  signal?: AbortSignal
}

interface PhysicalWorktreeRuntimeEpoch {
  key: string
  userId: string
  workspaceId: WorkspaceId
  workspaceRuntimeId: string
  active: boolean
  abortController: AbortController
  inFlightByTarget: Map<string, Promise<PhysicalWorktreeExecutionCapability>>
  remoteConfigFingerprint: string | null
}

export interface PhysicalWorktreeIdentityResolverDependencies {
  getLocalWorktrees: typeof readWorktreeMembership
  nativeRealpath(path: string): Promise<string>
  resolveRemoteTarget: typeof resolveRemoteTargetWithConfigFingerprint
  resolveRemoteWorktree: typeof resolveRemoteWorktree
  runRemoteCommand: RemoteCommandRunner
  isCurrentWorkspaceRuntime: typeof isCurrentWorkspaceRuntime
  onWorkspaceRuntimeClosed: typeof onWorkspaceRuntimeClosed
}

const defaultDependencies: PhysicalWorktreeIdentityResolverDependencies = {
  getLocalWorktrees: readWorktreeMembership,
  nativeRealpath,
  resolveRemoteTarget: resolveRemoteTargetWithConfigFingerprint,
  resolveRemoteWorktree,
  runRemoteCommand: async (command, target, options) => await runRemoteCommand(target, command, options),
  isCurrentWorkspaceRuntime,
  onWorkspaceRuntimeClosed,
}

/** Provider-owned canonical identity resolver, scoped to live workspace-runtime epochs. */
export class PhysicalWorktreeIdentityResolver {
  private readonly deps: PhysicalWorktreeIdentityResolverDependencies
  private readonly epochs = new Map<string, PhysicalWorktreeRuntimeEpoch>()
  private readonly unsubscribeWorkspaceRuntimeClosed: () => void
  private disposed = false

  constructor(deps: Partial<PhysicalWorktreeIdentityResolverDependencies> = {}) {
    this.deps = { ...defaultDependencies, ...deps }
    this.unsubscribeWorkspaceRuntimeClosed = this.deps.onWorkspaceRuntimeClosed((event) => this.releaseRuntime(event))
  }

  /** Provider extension point; capability issuance remains owned by resolver instances. */
  protected issueCapability(input: {
    identity: PhysicalWorktreeIdentity
    userId: string
    workspaceId: WorkspaceId
    workspaceRuntimeId: string
    worktreePath: string
    execution: PhysicalWorktreeExecutionBinding
    runtimeSignal: AbortSignal
  }): PhysicalWorktreeExecutionCapability {
    return issuePhysicalWorktreeExecutionCapability(input.identity, {
      userId: input.userId,
      workspaceId: input.workspaceId,
      workspaceRuntimeId: input.workspaceRuntimeId,
      worktreePath: input.worktreePath,
      execution: input.execution,
      runtimeSignal: input.runtimeSignal,
    })
  }

  async capture(input: ResolvePhysicalWorktreeIdentityInput): Promise<PhysicalWorktreeExecutionCapability> {
    if (!input.userId || !input.workspaceId || !input.workspaceRuntimeId)
      throw new Error('error.invalid-worktree-identity')
    const platform = process.platform === 'win32' ? 'win32' : 'posix'
    const workspace = parseWorkspaceLocator(input.workspaceId, platform)
    if (!workspace) throw new Error('error.workspace-locator-malformed')
    const targetsWorkspaceRoot =
      workspace.transport === 'file'
        ? path.resolve(input.worktreePath) === path.resolve(workspace.path)
        : path.posix.resolve(input.worktreePath) === path.posix.resolve(workspace.path)
    if (targetsWorkspaceRoot) return await this.captureWorkspace(input)
    const epoch = this.activeEpoch(input)
    const remote = workspace.transport === 'ssh'
    const targetPath = remote ? normalizedRemoteWorktreePath(input) : path.resolve(input.worktreePath)
    const targetKey = `${remote ? 'remote' : 'local'}\0${targetPath}`
    let operation = epoch.inFlightByTarget.get(targetKey)
    if (!operation) {
      operation = this.resolveAndBind(epoch, input, targetPath, remote)
      epoch.inFlightByTarget.set(targetKey, operation)
      const cleanup = () => {
        if (epoch.inFlightByTarget.get(targetKey) === operation) epoch.inFlightByTarget.delete(targetKey)
      }
      operation.then(cleanup, cleanup)
    }
    return await awaitWithAbort(operation, input.signal)
  }

  async captureWorkspace(input: ResolvePhysicalWorktreeIdentityInput): Promise<PhysicalWorktreeExecutionCapability> {
    if (!input.userId || !input.workspaceId || !input.workspaceRuntimeId)
      throw new Error('error.invalid-worktree-identity')
    const platform = process.platform === 'win32' ? 'win32' : 'posix'
    const locator = parseWorkspaceLocator(input.workspaceId, platform)
    if (!locator) throw new Error('error.workspace-locator-malformed')
    const epoch = this.activeEpoch(input)
    const targetKey = `workspace\0${locator.path}`
    let operation = epoch.inFlightByTarget.get(targetKey)
    if (!operation) {
      operation = this.resolveWorkspaceAndBind(epoch, input, locator)
      epoch.inFlightByTarget.set(targetKey, operation)
      const cleanup = () => {
        if (epoch.inFlightByTarget.get(targetKey) === operation) epoch.inFlightByTarget.delete(targetKey)
      }
      operation.then(cleanup, cleanup)
    }
    return await awaitWithAbort(operation, input.signal)
  }

  private async resolveWorkspaceAndBind(
    epoch: PhysicalWorktreeRuntimeEpoch,
    input: ResolvePhysicalWorktreeIdentityInput,
    locator: NonNullable<ReturnType<typeof parseWorkspaceLocator>>,
  ): Promise<PhysicalWorktreeExecutionCapability> {
    const signal = epoch.abortController.signal
    const resolved =
      locator.transport === 'file'
        ? await this.resolveLocalWorkspace(epoch, locator.path)
        : await this.resolveRemoteWorkspace(epoch, input, locator.profile, locator.path)
    this.assertEpochActive(epoch)
    return issuePhysicalWorktreeExecutionCapability(resolved.identity, {
      userId: input.userId,
      workspaceId: input.workspaceId,
      workspaceRuntimeId: input.workspaceRuntimeId,
      worktreePath: locator.path,
      execution: resolved.execution,
      runtimeSignal: signal,
    })
  }

  private async resolveLocalWorkspace(epoch: PhysicalWorktreeRuntimeEpoch, workspacePath: string) {
    const endpoint = await this.deps.nativeRealpath(workspacePath)
    this.assertEpochActive(epoch)
    return {
      identity: { kind: 'local' as const, executionNamespaceId: 'local' as const, endpoint },
      execution: Object.freeze({ kind: 'local' as const, canonicalWorktreePath: endpoint }),
    }
  }

  private async resolveRemoteWorkspace(
    epoch: PhysicalWorktreeRuntimeEpoch,
    input: ResolvePhysicalWorktreeIdentityInput,
    profile: string,
    workspacePath: string,
  ) {
    const resolved = await this.deps.resolveRemoteTarget(
      { alias: profile, remotePath: workspacePath },
      epoch.abortController.signal,
    )
    this.assertEpochActive(epoch)
    this.captureRemoteConfigFingerprint(epoch, resolved.configFingerprint)
    const run = this.runtimeAwareRemoteRunner({
      workspaceId: input.workspaceId,
      workspaceRuntimeId: input.workspaceRuntimeId,
    })
    const result = await run({ type: 'resolvePhysicalWorktreeIdentity', path: workspacePath }, resolved.target, {
      signal: epoch.abortController.signal,
    })
    if (!result.ok) throw new Error(result.message || result.stderr || 'error.unavailable')
    const captured = parseRemotePhysicalWorktreeCapture(result.stdout)
    return {
      identity: captured.identity,
      execution: Object.freeze({
        kind: 'remote' as const,
        canonicalWorktreePath: captured.identity.endpoint,
        target: Object.freeze({ ...resolved.target }),
        configFingerprint: resolved.configFingerprint,
      }),
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.unsubscribeWorkspaceRuntimeClosed()
    for (const epoch of this.epochs.values()) deactivateEpoch(epoch)
    this.epochs.clear()
  }

  private async resolveAndBind(
    epoch: PhysicalWorktreeRuntimeEpoch,
    input: ResolvePhysicalWorktreeIdentityInput,
    targetPath: string,
    remote: boolean,
  ): Promise<PhysicalWorktreeExecutionCapability> {
    const signal = epoch.abortController.signal
    const resolved = remote
      ? await this.resolveRemote(epoch, input, targetPath, signal)
      : await this.resolveLocal(epoch, input, targetPath, signal)
    this.assertEpochActive(epoch)
    return issuePhysicalWorktreeExecutionCapability(resolved.identity, {
      userId: input.userId,
      workspaceId: input.workspaceId,
      workspaceRuntimeId: input.workspaceRuntimeId,
      worktreePath: targetPath,
      execution: resolved.execution,
      runtimeSignal: epoch.abortController.signal,
    })
  }

  private async resolveLocal(
    epoch: PhysicalWorktreeRuntimeEpoch,
    input: ResolvePhysicalWorktreeIdentityInput,
    worktreePath: string,
    signal: AbortSignal,
  ): Promise<{ identity: PhysicalWorktreeIdentity; execution: PhysicalWorktreeExecutionBinding }> {
    const workspacePath = localWorkspaceNativePath(input.workspaceId)
    if (!workspacePath) throw new Error('error.workspace-locator-malformed')
    const worktrees = await this.deps.getLocalWorktrees(workspacePath, signal)
    this.assertEpochActive(epoch)
    const known = resolveKnownWorktree(worktrees, worktreePath)
    if (!known.ok) throw new Error(known.message)
    const endpoint = await this.deps.nativeRealpath(known.path)
    this.assertEpochActive(epoch)
    return {
      identity: { kind: 'local', executionNamespaceId: 'local', endpoint },
      execution: Object.freeze({ kind: 'local', canonicalWorktreePath: endpoint }),
    }
  }

  private async resolveRemote(
    epoch: PhysicalWorktreeRuntimeEpoch,
    input: ResolvePhysicalWorktreeIdentityInput,
    worktreePath: string,
    signal: AbortSignal,
  ): Promise<{ identity: PhysicalWorktreeIdentity; execution: PhysicalWorktreeExecutionBinding }> {
    const workspace = parseRemoteWorkspaceId(input.workspaceId)
    if (!workspace) throw new Error('error.invalid-worktree-identity')
    const resolved = await this.deps.resolveRemoteTarget(
      { alias: workspace.alias, remotePath: workspace.remotePath },
      signal,
    )
    this.assertEpochActive(epoch)
    this.captureRemoteConfigFingerprint(epoch, resolved.configFingerprint)

    const runRemoteCommand = this.runtimeAwareRemoteRunner({
      workspaceId: input.workspaceId,
      workspaceRuntimeId: input.workspaceRuntimeId,
    })
    const known = await this.deps.resolveRemoteWorktree(resolved.target, worktreePath, {
      signal,
      run: runRemoteCommand,
    })
    this.assertEpochActive(epoch)
    const result = await runRemoteCommand(
      { type: 'resolvePhysicalWorktreeIdentity', path: known.path },
      resolved.target,
      { signal },
    )
    this.assertEpochActive(epoch)
    if (!result.ok) throw new Error(result.message || result.stderr || 'error.unavailable')
    const identity = parseRemotePhysicalWorktreeIdentity(result.stdout)
    return {
      identity,
      execution: Object.freeze({
        kind: 'remote',
        canonicalWorktreePath: identity.endpoint,
        target: Object.freeze({ ...resolved.target }),
        configFingerprint: resolved.configFingerprint,
      }),
    }
  }

  private activeEpoch(input: ResolvePhysicalWorktreeIdentityInput): PhysicalWorktreeRuntimeEpoch {
    if (
      this.disposed ||
      !this.deps.isCurrentWorkspaceRuntime(input.userId, input.workspaceId, input.workspaceRuntimeId)
    ) {
      throw new Error('error.workspace-runtime-stale')
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
      workspaceId: input.workspaceId,
      workspaceRuntimeId: input.workspaceRuntimeId,
      active: true,
      abortController: new AbortController(),
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
      !this.deps.isCurrentWorkspaceRuntime(epoch.userId, epoch.workspaceId, epoch.workspaceRuntimeId)
    ) {
      throw new Error('error.workspace-runtime-stale')
    }
  }

  private captureRemoteConfigFingerprint(epoch: PhysicalWorktreeRuntimeEpoch, fingerprint: string): void {
    if (epoch.remoteConfigFingerprint && epoch.remoteConfigFingerprint !== fingerprint) {
      throw new Error('error.workspace-runtime-stale')
    }
    epoch.remoteConfigFingerprint = fingerprint
  }

  private runtimeAwareRemoteRunner(input: {
    workspaceId: WorkspaceId
    workspaceRuntimeId: string
  }): RemoteCommandRunner {
    return async (command, target, options) => {
      const result = await this.deps.runRemoteCommand(command, target, options)
      const runtimeFailure = remoteWorkspaceRuntimeFailureFromCommandResult({
        workspaceId: input.workspaceId,
        workspaceRuntimeId: input.workspaceRuntimeId,
        target,
        result,
      })
      if (runtimeFailure) throw runtimeFailure
      return result
    }
  }

  private releaseRuntime(event: WorkspaceRuntimeClosedEvent): void {
    const key = runtimeKey({
      userId: event.userId,
      workspaceId: event.workspaceId,
      workspaceRuntimeId: event.workspaceRuntimeId,
    })
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

export function parseRemotePhysicalWorktreeIdentity(output: string): PhysicalWorktreeIdentity {
  return parseRemotePhysicalWorktreeCapture(output).identity
}

function parseRemotePhysicalWorktreeCapture(output: string): {
  identity: PhysicalWorktreeIdentity
} {
  const fields = output.split('\0')
  const runtimeToken = fields[0] ?? ''
  const machineFact = fields[1] ?? ''
  const rootNamespaceFact = fields[2] ?? ''
  const endpoint = fields[3] ?? ''
  if (
    fields.length !== 5 ||
    fields[4] !== '' ||
    !/^[a-f0-9]{32}$/u.test(runtimeToken) ||
    !validRemoteNamespaceFact(machineFact) ||
    !validRemoteNamespaceFact(rootNamespaceFact) ||
    !endpoint.startsWith('/')
  ) {
    throw new Error('error.invalid-worktree-identity')
  }
  const executionNamespaceId = createHash('sha256')
    .update(`goblin-remote-execution-v2\0${runtimeToken}\0${machineFact}\0${rootNamespaceFact}`)
    .digest('hex')
    .slice(0, 32)
  return {
    identity: { kind: 'remote', executionNamespaceId, endpoint },
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

function normalizedRemoteWorktreePath(input: ResolvePhysicalWorktreeIdentityInput): string {
  const workspace = parseRemoteWorkspaceId(input.workspaceId)
  const worktree = workspace
    ? normalizeRemoteWorkspaceRef({ alias: workspace.alias, remotePath: input.worktreePath })
    : null
  if (!workspace || !worktree) throw new Error('error.invalid-worktree-identity')
  return worktree.remotePath
}

function validRemoteNamespaceFact(value: string): boolean {
  return value.length > 0 && value.length <= 256 && /^[A-Za-z0-9._:-]+$/u.test(value)
}

function runtimeKey(input: { userId: string; workspaceId: WorkspaceId; workspaceRuntimeId: string }): string {
  return `${input.userId}\0${input.workspaceId}\0${input.workspaceRuntimeId}`
}

function deactivateEpoch(epoch: PhysicalWorktreeRuntimeEpoch): void {
  if (!epoch.active) return
  epoch.active = false
  epoch.abortController.abort(new Error('error.workspace-runtime-stale'))
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
