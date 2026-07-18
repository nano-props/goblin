import path from 'node:path'
import { buildCanonicalSshConnectionSnapshot } from '#/system/ssh/commands.ts'
import { isRemoteWorkspaceId } from '#/shared/remote-workspace.ts'
import {
  physicalWorktreeIdentityKey,
  type PhysicalWorktreeIdentity,
} from '#/server/worktree-removal/physical-worktree-identity.ts'
import type { resolveRemoteTargetWithConfigFingerprint } from '#/system/ssh/config.ts'

export interface PhysicalWorktreeExecutionInput {
  userId: string
  repoRoot: string
  workspaceRuntimeId: string
  worktreePath: string
}

declare const physicalWorktreeExecutionCapabilityBrand: unique symbol
declare const physicalWorktreeAdmissionLeaseBrand: unique symbol

export interface PhysicalWorktreeAdmissionLease {
  readonly identity: PhysicalWorktreeIdentity
  readonly generationKey: string
  readonly [physicalWorktreeAdmissionLeaseBrand]: true
}

export interface PhysicalWorktreeExecutionCapability {
  readonly identity: PhysicalWorktreeIdentity
  readonly [physicalWorktreeExecutionCapabilityBrand]: true
}

export interface PhysicalWorktreeExecutionScope extends PhysicalWorktreeExecutionInput {}

type ResolvedRemoteWorkspaceTarget = Awaited<ReturnType<typeof resolveRemoteTargetWithConfigFingerprint>>['target']
export type PhysicalWorktreeExecutionBinding =
  | {
      readonly kind: 'local'
      readonly canonicalWorktreePath: string
      readonly endpointMarker: PhysicalWorktreeEndpointMarker
    }
  | {
      readonly kind: 'remote'
      readonly canonicalWorktreePath: string
      readonly target: Readonly<ResolvedRemoteWorkspaceTarget>
      readonly configFingerprint: string
      readonly endpointMarker: PhysicalWorktreeEndpointMarker
    }

export interface PhysicalWorktreeEndpointMarker {
  readonly deviceId: string
  readonly inode: string
}

interface PhysicalWorktreeExecutionCapabilityState extends PhysicalWorktreeExecutionInput {
  execution: PhysicalWorktreeExecutionBinding
  admissionLease: PhysicalWorktreeAdmissionLease
  validateExecution(signal: AbortSignal): Promise<void>
}

const capabilities = new WeakMap<PhysicalWorktreeExecutionCapability, PhysicalWorktreeExecutionCapabilityState>()
const admissionSignals = new WeakMap<PhysicalWorktreeAdmissionLease, AbortSignal>()

export function issuePhysicalWorktreeExecutionCapability(
  identity: PhysicalWorktreeIdentity,
  state: Omit<PhysicalWorktreeExecutionCapabilityState, 'admissionLease'> & { runtimeSignal: AbortSignal },
): PhysicalWorktreeExecutionCapability {
  const frozenIdentity = Object.freeze({ ...identity }) as PhysicalWorktreeIdentity
  const admissionLease = Object.freeze({
    identity: frozenIdentity,
    generationKey: executionGenerationKey(state.execution),
  }) as PhysicalWorktreeAdmissionLease
  const capability = Object.freeze({ identity: frozenIdentity }) as PhysicalWorktreeExecutionCapability
  const execution = freezeExecutionBinding(state.execution)
  const { runtimeSignal, ...capabilityState } = state
  admissionSignals.set(admissionLease, runtimeSignal)
  capabilities.set(capability, Object.freeze({ ...capabilityState, admissionLease, execution }))
  return capability
}

export function physicalWorktreeExecutionBinding(
  capability: PhysicalWorktreeExecutionCapability,
): PhysicalWorktreeExecutionBinding {
  return capabilityState(capability).execution
}

export function physicalWorktreeExecutionScope(
  capability: PhysicalWorktreeExecutionCapability,
): PhysicalWorktreeExecutionScope {
  const state = capabilityState(capability)
  return {
    userId: state.userId,
    repoRoot: state.repoRoot,
    workspaceRuntimeId: state.workspaceRuntimeId,
    worktreePath: state.worktreePath,
  }
}

export async function validatePhysicalWorktreeExecution(
  capability: PhysicalWorktreeExecutionCapability,
  signal: AbortSignal | undefined,
): Promise<void> {
  const state = capabilityState(capability)
  const runtimeSignal = physicalWorktreeAdmissionLeaseSignal(state.admissionLease)
  const operationSignal = signal ? AbortSignal.any([runtimeSignal, signal]) : runtimeSignal
  operationSignal.throwIfAborted()
  await state.validateExecution(operationSignal)
  operationSignal.throwIfAborted()
}

export function physicalWorktreeAdmissionLease(
  capability: PhysicalWorktreeExecutionCapability,
): PhysicalWorktreeAdmissionLease {
  return capabilityState(capability).admissionLease
}

export function physicalWorktreeAdmissionLeaseSignal(lease: PhysicalWorktreeAdmissionLease): AbortSignal {
  const signal = admissionSignals.get(lease)
  if (!signal) throw new Error('error.invalid-worktree-admission-lease')
  return signal
}

export function physicalWorktreeAdmissionLeaseKey(lease: PhysicalWorktreeAdmissionLease): string {
  return `${physicalWorktreeIdentityKey(lease.identity)}\0${lease.generationKey}`
}

export function assertPhysicalWorktreeExecutionCapability(
  capability: PhysicalWorktreeExecutionCapability,
  input: PhysicalWorktreeExecutionInput,
): void {
  const state = capabilityState(capability)
  const worktreePath = isRemoteWorkspaceId(input.repoRoot)
    ? path.posix.resolve(input.worktreePath)
    : path.resolve(input.worktreePath)
  if (
    state.userId !== input.userId ||
    state.repoRoot !== input.repoRoot ||
    state.workspaceRuntimeId !== input.workspaceRuntimeId ||
    state.worktreePath !== worktreePath
  )
    throw new Error('error.invalid-worktree-capability')
}

function capabilityState(capability: PhysicalWorktreeExecutionCapability): PhysicalWorktreeExecutionCapabilityState {
  const state = capabilities.get(capability)
  if (!state) throw new Error('error.invalid-worktree-capability')
  return state
}

function freezeExecutionBinding(execution: PhysicalWorktreeExecutionBinding): PhysicalWorktreeExecutionBinding {
  if (execution.kind === 'local') {
    return Object.freeze({ ...execution, endpointMarker: Object.freeze({ ...execution.endpointMarker }) })
  }
  const sshConnection = execution.target.sshConnection ?? buildCanonicalSshConnectionSnapshot(execution.target, '')
  return Object.freeze({
    ...execution,
    target: Object.freeze({
      ...execution.target,
      sshConnection: Object.freeze({ ...sshConnection, options: Object.freeze([...sshConnection.options]) }),
    }),
    endpointMarker: Object.freeze({ ...execution.endpointMarker }),
  })
}

function executionGenerationKey(execution: PhysicalWorktreeExecutionBinding): string {
  const endpoint = `${execution.endpointMarker.deviceId}\0${execution.endpointMarker.inode}`
  return execution.kind === 'local' ? endpoint : `${execution.configFingerprint}\0${endpoint}`
}
