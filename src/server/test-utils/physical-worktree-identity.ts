import path from 'node:path'
import {
  PhysicalWorktreeIdentityResolver,
  type PhysicalWorktreeCapability,
  type PhysicalWorktreeExecutionBinding,
  type ResolvePhysicalWorktreeIdentityInput,
} from '#/server/worktree-removal/physical-worktree-identity-resolver.ts'
import type { PhysicalWorktreeIdentity } from '#/server/worktree-removal/physical-worktree-identity.ts'
import type {
  WorkspacePaneTabsReplaceInput,
  WorkspacePaneTabsRuntime,
} from '#/server/workspace-pane/workspace-pane-tabs-runtime.ts'

export function testPhysicalWorktreeIdentity(endpoint: string): PhysicalWorktreeIdentity {
  return { kind: 'local', executionNamespaceId: 'local', endpoint: path.resolve(endpoint) }
}

class TestPhysicalWorktreeIdentityResolver extends PhysicalWorktreeIdentityResolver {
  constructor() {
    super({ onRepoRuntimeClosed: () => () => undefined })
  }

  issue(input: {
    identity: PhysicalWorktreeIdentity
    userId?: string
    repoRoot?: string
    repoRuntimeId?: string
    worktreePath?: string
    execution?: PhysicalWorktreeExecutionBinding
    runtimeSignal?: AbortSignal
    validateExecution?(signal: AbortSignal): Promise<void>
  }): PhysicalWorktreeCapability {
    const endpoint = input.worktreePath ?? input.identity.endpoint
    return this.issueCapability({
      identity: input.identity,
      userId: input.userId ?? 'test-user',
      repoRoot: input.repoRoot ?? '/repo',
      repoRuntimeId: input.repoRuntimeId ?? 'test-runtime',
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

export function issueTestPhysicalWorktreeCapability(
  input: Parameters<TestPhysicalWorktreeIdentityResolver['issue']>[0],
): PhysicalWorktreeCapability {
  return testPhysicalWorktreeIdentityResolver.issue(input)
}

export function testPhysicalWorktreeCapability(
  endpoint: string,
  input: Partial<
    Pick<ResolvePhysicalWorktreeIdentityInput, 'userId' | 'repoRoot' | 'repoRuntimeId' | 'worktreePath'>
  > = {},
): PhysicalWorktreeCapability {
  const worktreePath = input.worktreePath ?? endpoint
  return issueTestPhysicalWorktreeCapability({
    identity: testPhysicalWorktreeIdentity(endpoint),
    userId: input.userId,
    repoRoot: input.repoRoot,
    repoRuntimeId: input.repoRuntimeId,
    worktreePath,
  })
}

export const testPhysicalWorktrees = {
  async capture(input: ResolvePhysicalWorktreeIdentityInput): Promise<PhysicalWorktreeCapability> {
    return testPhysicalWorktreeCapability(input.worktreePath, input)
  },
}

export function replaceTestWorkspaceTabs(
  runtime: WorkspacePaneTabsRuntime<string>,
  input: Omit<WorkspacePaneTabsReplaceInput<string>, 'physicalWorktreeIdentity' | 'repoRoot'> & {
    repoRoot?: string
    physicalWorktreeIdentity?: PhysicalWorktreeIdentity | null
  },
): void {
  const plan = runtime.planReplace({
    ...input,
    repoRoot: input.repoRoot ?? (input.scope.includes('\0') ? input.scope.split('\0')[0]! : '/repo'),
    physicalWorktreeIdentity:
      input.physicalWorktreeIdentity ??
      (input.worktreePath === null ? null : testPhysicalWorktreeIdentity(input.worktreePath)),
  })
  runtime.commitPlan(plan)
}
