import { describe, expect, test, vi } from 'vitest'
import { createTerminalSessionEnsurer } from '#/server/terminal/terminal-session-ensurer.ts'
import { createTerminalSessionCreateProvider } from '#/server/terminal/terminal-session-create-provider.ts'
import { createPhysicalWorktreeOperationCoordinator } from '#/server/worktree-removal/physical-worktree-operation-coordinator.ts'
import {
  physicalWorktreeExecutionBinding,
  type PhysicalWorktreeExecutionCapability,
} from '#/server/worktree-removal/physical-worktree-identity-resolver.ts'
import {
  issueTestPhysicalWorktreeExecutionCapability,
  testPhysicalWorktreeIdentity,
} from '#/server/test-utils/physical-worktree-identity.ts'

const REMOTE_REPO = 'ssh-config://prod/srv/repo'
const REMOTE_PATH = '/srv/worktrees/feature'

describe('physical worktree capability boundaries', () => {
  test('freezes the exact remote target snapshot used after capture', () => {
    const target = remoteTarget('host-a.test')
    const capability = remoteCapability(target)
    target.host = 'host-b.test'

    const execution = physicalWorktreeExecutionBinding(capability)
    expect(execution).toMatchObject({
      kind: 'remote',
      canonicalWorktreePath: REMOTE_PATH,
      target: { host: 'host-a.test' },
    })
  })

  test('remote terminal invocation consumes the captured target without resolving the alias again', async () => {
    const prepareSession = vi.fn(async () => ({ ok: false as const, message: 'stop-after-capture' }))
    const ensurer = createTerminalSessionEnsurer({
      manager: { prepareSession },
      broadcastSessionsChanged: vi.fn(),
    })
    const capability = remoteCapability(remoteTarget('host-a.test'))

    await ensurer.ensure(
      'user-a',
      {
        repoRoot: REMOTE_REPO,
        repoRuntimeId: 'runtime-a',
        branch: 'feature',
        worktreePath: REMOTE_PATH,
      },
      {
        terminalSessionId: 'term-capabilitycapability01',
        cols: 80,
        rows: 24,
        scopedWorktreePath: REMOTE_PATH,
        physicalWorktreeCapability: capability,
        signal: new AbortController().signal,
      },
    )

    expect(prepareSession).toHaveBeenCalledWith(
      expect.objectContaining({
        physicalWorktreeCapability: capability,
        args: expect.arrayContaining([expect.stringContaining('host-a.test')]),
      }),
    )
  })

  test('rejects a structurally forged capability even with an active matching permit', async () => {
    const identity = testPhysicalWorktreeIdentity('/repo/worktree')
    const forged = Object.freeze({ identity }) as PhysicalWorktreeExecutionCapability
    const worktreeOperations = createPhysicalWorktreeOperationCoordinator()
    const createAdmitted = vi.fn()
    const provider = createTerminalSessionCreateProvider({
      sessionService: { createAdmitted },
      worktreeOperations,
    })

    await expect(worktreeOperations.runOperation(forged, async () => null)).rejects.toThrow(
      'error.invalid-worktree-capability',
    )
    expect(createAdmitted).not.toHaveBeenCalled()
  })
})

function remoteCapability(target: ReturnType<typeof remoteTarget>): PhysicalWorktreeExecutionCapability {
  return issueTestPhysicalWorktreeExecutionCapability({
    identity: {
      kind: 'remote',
      executionNamespaceId: '0123456789abcdef0123456789abcdef',
      endpoint: REMOTE_PATH,
    },
    userId: 'user-a',
    repoRoot: REMOTE_REPO,
    repoRuntimeId: 'runtime-a',
    worktreePath: REMOTE_PATH,
    execution: {
      kind: 'remote',
      canonicalWorktreePath: REMOTE_PATH,
      target,
      configFingerprint: 'config-a',
      endpointMarker: { deviceId: '10', inode: '20' },
    },
  })
}

function remoteTarget(host: string) {
  return {
    id: REMOTE_REPO,
    alias: 'prod',
    host,
    user: 'developer',
    port: 22,
    remotePath: '/srv/repo',
    displayName: 'prod',
  }
}
