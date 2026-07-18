import path from 'node:path'
import {
  PhysicalWorktreeIdentityResolver,
  type ResolvePhysicalWorktreeIdentityInput,
} from '#/server/worktree-removal/physical-worktree-identity-resolver.ts'
import type {
  PhysicalWorktreeExecutionBinding,
  PhysicalWorktreeExecutionCapability,
} from '#/server/worktree-removal/physical-worktree-capability.ts'
import type { PhysicalWorktreeIdentity } from '#/server/worktree-removal/physical-worktree-identity.ts'

export function testPhysicalWorktreeIdentity(endpoint: string): PhysicalWorktreeIdentity {
  return { kind: 'local', executionNamespaceId: 'local', endpoint: path.resolve(endpoint) }
}

class TestPhysicalWorktreeIdentityResolver extends PhysicalWorktreeIdentityResolver {
  constructor() {
    super({ onWorkspaceRuntimeClosed: () => () => undefined })
  }

  issue(input: {
    identity: PhysicalWorktreeIdentity
    userId?: string
    repoRoot?: string
    workspaceRuntimeId?: string
    worktreePath?: string
    execution?: PhysicalWorktreeExecutionBinding
    runtimeSignal?: AbortSignal
    validateExecution?(signal: AbortSignal): Promise<void>
  }): PhysicalWorktreeExecutionCapability {
    const endpoint = input.worktreePath ?? input.identity.endpoint
    return this.issueCapability({
      identity: input.identity,
      userId: input.userId ?? 'test-user',
      repoRoot: input.repoRoot ?? '/repo',
      workspaceRuntimeId: input.workspaceRuntimeId ?? 'test-runtime',
      worktreePath: endpoint,
      execution: input.execution ?? {
        kind: 'local',
        canonicalWorktreePath: input.identity.endpoint,
        endpointMarker: { deviceId: 'test-device', inode: 'test-inode' },
      },
      runtimeSignal: input.runtimeSignal ?? new AbortController().signal,
      validateExecution: input.validateExecution ?? (async () => undefined),
    })
  }
}

const testPhysicalWorktreeIdentityResolver = new TestPhysicalWorktreeIdentityResolver()

export function issueTestPhysicalWorktreeExecutionCapability(
  input: Parameters<TestPhysicalWorktreeIdentityResolver['issue']>[0],
): PhysicalWorktreeExecutionCapability {
  return testPhysicalWorktreeIdentityResolver.issue(input)
}

export function testPhysicalWorktreeExecutionCapability(
  endpoint: string,
  input: Partial<
    Pick<ResolvePhysicalWorktreeIdentityInput, 'userId' | 'repoRoot' | 'workspaceRuntimeId' | 'worktreePath'>
  > = {},
): PhysicalWorktreeExecutionCapability {
  const worktreePath = input.worktreePath ?? endpoint
  return issueTestPhysicalWorktreeExecutionCapability({
    identity: testPhysicalWorktreeIdentity(endpoint),
    userId: input.userId,
    repoRoot: input.repoRoot,
    workspaceRuntimeId: input.workspaceRuntimeId,
    worktreePath,
  })
}

export const testPhysicalWorktrees = {
  async capture(input: ResolvePhysicalWorktreeIdentityInput): Promise<PhysicalWorktreeExecutionCapability> {
    return testPhysicalWorktreeExecutionCapability(input.worktreePath, input)
  },
}
