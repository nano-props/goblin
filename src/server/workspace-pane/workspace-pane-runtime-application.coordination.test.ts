import { describe, expect, test, vi } from 'vitest'
import type * as WorkspaceRuntimesModule from '#/server/modules/workspace-runtimes.ts'
import {
  deferred,
  paneTabsSnapshot,
  request,
  runtimeTabsCoordinator,
  terminalCreateSuccess,
  terminalSession,
  workspaceRuntimeMembershipCapability,
} from '#/server/test-utils/workspace-pane-runtime-application.ts'
import {
  testPhysicalWorktreeExecutionCapability,
  testPhysicalWorktrees,
} from '#/server/test-utils/physical-worktree-identity.ts'
import type { ServerTerminalCreateSuccess } from '#/server/terminal/terminal-session-creator.ts'
import { WorkspaceRuntimeStaleError } from '#/server/modules/workspace-runtimes.ts'
import { createWorkspacePaneRuntimeApplication } from '#/server/workspace-pane/workspace-pane-runtime-application.ts'
import {
  createPhysicalWorktreeOperationCoordinator,
  type PhysicalWorktreeOperationPermit,
} from '#/server/worktree-removal/physical-worktree-operation-coordinator.ts'
import type { WorkspaceProbeState } from '#/shared/workspace-runtime.ts'

const workspaceProbeStateForRuntimeMock = vi.hoisted(() =>
  vi.fn<() => WorkspaceProbeState>(() => ({
    status: 'ready' as const,
    capabilities: {
      files: { read: true as const, write: true },
      terminal: { available: true },
      git: { status: 'available' as const, worktrees: true, pullRequests: { provider: 'none' as const } },
    },
    diagnostics: [],
  })),
)
vi.mock('#/server/modules/workspace-runtimes.ts', async (importActual) => {
  const actual = await importActual<typeof WorkspaceRuntimesModule>()
  return { ...actual, workspaceProbeStateForRuntime: workspaceProbeStateForRuntimeMock }
})

describe('removal coordination and failure settlement', () => {
  test('serializes open and close through the shared user/runtime/worktree queue', async () => {
    const createResult = deferred<ServerTerminalCreateSuccess>()
    const createStarted = deferred<void>()
    const session = terminalSession('term-111111111111111111111', 'pty_session_1_aaaaaaaaa')
    const listSessions = vi.fn().mockResolvedValueOnce([session]).mockResolvedValueOnce([])
    const application = createWorkspacePaneRuntimeApplication({
      worktreeOperations: createPhysicalWorktreeOperationCoordinator(),
      physicalWorktrees: testPhysicalWorktrees,
      terminalSessions: { listSessionsForUser: listSessions },
      terminal: {
        createAdmitted: async () => {
          createStarted.resolve()
          return await createResult.promise
        },
        close: () => ({ kind: 'closed' as const }),
      },
      workspaceTabsCoordinator: runtimeTabsCoordinator({
        ensureRuntimeTabForSession: async (input: { commitAdmission: (canonicalBranch: string) => void }) => {
          input.commitAdmission(request.branch)
          return { kind: 'committed' as const, snapshot: paneTabsSnapshot }
        },
        reconcileWorktreeAdmitted: vi.fn(async () => paneTabsSnapshot),
      }),
      captureWorkspaceRuntimeMembershipCapability: () => workspaceRuntimeMembershipCapability(),
      invalidateWorkspaceTabs: vi.fn(),
      broadcastWorkspaceTabsChanged: () => {},
    })

    const open = application.open('client-test', 'user-test', { runtimeType: 'terminal', request })
    await createStarted.promise
    const close = application.close('client-test', 'user-test', {
      runtimeType: 'terminal',
      sessionId: session.terminalSessionId,
      target: {
        target: request.target,
      },
    })
    expect(listSessions).not.toHaveBeenCalled()

    createResult.resolve(terminalCreateSuccess())
    await expect(open).resolves.toMatchObject({ ok: true })
    await expect(close).resolves.toMatchObject({ ok: true })
    expect(listSessions).toHaveBeenCalledOnce()
  })

  test('lets an earlier admitted open finish before a later removal that fails validation', async () => {
    const worktreeOperations = createPhysicalWorktreeOperationCoordinator()
    const createResult = deferred<ServerTerminalCreateSuccess>()
    const create = vi.fn(async () => await createResult.promise)
    const close = vi.fn(async () => ({ kind: 'closed' as const }))
    const application = createWorkspacePaneRuntimeApplication({
      worktreeOperations,
      physicalWorktrees: testPhysicalWorktrees,
      terminalSessions: { listSessionsForUser: async () => [] },
      terminal: { createAdmitted: create, close },
      workspaceTabsCoordinator: runtimeTabsCoordinator({
        ensureRuntimeTabForSession: async (input: {
          physicalWorktreeCapability: ReturnType<typeof testPhysicalWorktreeExecutionCapability>
          permit: PhysicalWorktreeOperationPermit
          commitAdmission: (canonicalBranch: string) => void
        }) => {
          worktreeOperations.assertPermit(input.physicalWorktreeCapability, input.permit)
          input.commitAdmission(request.branch)
          return { kind: 'committed' as const, snapshot: paneTabsSnapshot }
        },
      }),
      captureWorkspaceRuntimeMembershipCapability: () => workspaceRuntimeMembershipCapability(),
      invalidateWorkspaceTabs: vi.fn(),
      broadcastWorkspaceTabsChanged: vi.fn(),
    })

    const open = application.open('client-test', 'user-test', { runtimeType: 'terminal', request })
    const physicalWorktreeCapability = testPhysicalWorktreeExecutionCapability(request.worktreePath)
    await vi.waitFor(() => expect(create).toHaveBeenCalledOnce())
    const removal = worktreeOperations.runRemoval(physicalWorktreeCapability, async () => ({
      ok: false,
      message: 'validation failed',
    }))
    expect(worktreeOperations.isRemovalAdmitted(physicalWorktreeCapability)).toBe(true)

    createResult.resolve(terminalCreateSuccess())
    await expect(open).resolves.toMatchObject({ ok: true })
    await expect(removal).resolves.toEqual({
      admitted: true,
      value: { ok: false, message: 'validation failed' },
    })
    expect(close).not.toHaveBeenCalled()
  })

  test('does not call the terminal provider while physical removal is admitted', async () => {
    const worktreeOperations = createPhysicalWorktreeOperationCoordinator()
    const physicalWorktreeCapability = testPhysicalWorktreeExecutionCapability(request.worktreePath)
    const removalGate = deferred<void>()
    const removal = worktreeOperations.runRemoval(physicalWorktreeCapability, async () => await removalGate.promise)
    const createAdmitted = vi.fn(async () => terminalCreateSuccess())
    const application = createWorkspacePaneRuntimeApplication({
      worktreeOperations,
      physicalWorktrees: { capture: async () => physicalWorktreeCapability },
      terminalSessions: { listSessionsForUser: async () => [] },
      terminal: { createAdmitted, close: () => ({ kind: 'failed' as const }) },
      workspaceTabsCoordinator: runtimeTabsCoordinator({ ensureRuntimeTabForSession: vi.fn() }),
      captureWorkspaceRuntimeMembershipCapability: () => workspaceRuntimeMembershipCapability(),
      invalidateWorkspaceTabs: vi.fn(),
      broadcastWorkspaceTabsChanged: vi.fn(),
    })

    await expect(application.open('client-test', 'user-test', { runtimeType: 'terminal', request })).resolves.toEqual({
      ok: false,
      runtimeType: 'terminal',
      message: 'error.worktree-removal-in-progress',
    })
    expect(createAdmitted).not.toHaveBeenCalled()
    removalGate.resolve()
    await removal
  })

  test('retires an unpublished terminal if placement preparation throws', async () => {
    const runtime = terminalCreateSuccess()
    const retire = vi.fn()
    runtime.admission = { ...runtime.admission, kind: 'prepared', abort: retire }
    const close = vi.fn(async () => ({ kind: 'closed' as const }))
    const broadcastWorkspaceTabsChanged = vi.fn()
    const application = createWorkspacePaneRuntimeApplication({
      worktreeOperations: createPhysicalWorktreeOperationCoordinator(),
      physicalWorktrees: testPhysicalWorktrees,
      terminalSessions: { listSessionsForUser: async () => [] },
      terminal: { createAdmitted: async () => runtime, close },
      workspaceTabsCoordinator: runtimeTabsCoordinator({
        ensureRuntimeTabForSession: async () => {
          throw new Error('projection failed')
        },
      }),
      captureWorkspaceRuntimeMembershipCapability: () => workspaceRuntimeMembershipCapability(),
      invalidateWorkspaceTabs: vi.fn(),
      broadcastWorkspaceTabsChanged,
    })

    await expect(application.open('client-test', 'user-test', { runtimeType: 'terminal', request })).resolves.toEqual({
      ok: false,
      runtimeType: 'terminal',
      message: 'error.unavailable',
    })
    expect(retire).toHaveBeenCalledOnce()
    expect(close).not.toHaveBeenCalled()
    expect(broadcastWorkspaceTabsChanged).not.toHaveBeenCalled()
  })

  test('preserves a typed final runtime-stale admission result', async () => {
    const runtime = terminalCreateSuccess()
    const abort = vi.fn()
    runtime.admission = { ...runtime.admission, kind: 'prepared', abort }
    const application = createWorkspacePaneRuntimeApplication({
      worktreeOperations: createPhysicalWorktreeOperationCoordinator(),
      physicalWorktrees: testPhysicalWorktrees,
      terminalSessions: { listSessionsForUser: async () => [] },
      terminal: { createAdmitted: async () => runtime, close: () => ({ kind: 'failed' as const }) },
      workspaceTabsCoordinator: runtimeTabsCoordinator({
        ensureRuntimeTabForSession: async () => {
          throw new WorkspaceRuntimeStaleError()
        },
      }),
      captureWorkspaceRuntimeMembershipCapability: () => workspaceRuntimeMembershipCapability(),
      invalidateWorkspaceTabs: vi.fn(),
      broadcastWorkspaceTabsChanged: vi.fn(),
    })

    await expect(application.open('client-test', 'user-test', { runtimeType: 'terminal', request })).resolves.toEqual({
      ok: false,
      runtimeType: 'terminal',
      message: 'error.workspace-runtime-stale',
    })
    expect(abort).toHaveBeenCalledOnce()
  })

  test('surfaces target identity changes as a distinct fast-fail', async () => {
    const runtime = terminalCreateSuccess()
    const abort = vi.fn()
    runtime.admission = { ...runtime.admission, kind: 'prepared', abort }
    const application = createWorkspacePaneRuntimeApplication({
      worktreeOperations: createPhysicalWorktreeOperationCoordinator(),
      physicalWorktrees: testPhysicalWorktrees,
      terminalSessions: { listSessionsForUser: async () => [] },
      terminal: { createAdmitted: async () => runtime, close: () => ({ kind: 'failed' as const }) },
      workspaceTabsCoordinator: runtimeTabsCoordinator({
        ensureRuntimeTabForSession: async () => ({ kind: 'target-stale' }),
      }),
      captureWorkspaceRuntimeMembershipCapability: () => workspaceRuntimeMembershipCapability(),
      invalidateWorkspaceTabs: vi.fn(),
      broadcastWorkspaceTabsChanged: vi.fn(),
    })

    await expect(application.open('client-test', 'user-test', { runtimeType: 'terminal', request })).resolves.toEqual({
      ok: false,
      runtimeType: 'terminal',
      message: 'error.workspace-target-stale',
    })
    expect(abort).toHaveBeenCalledOnce()
  })

  test('does not compensate an invariant failure after admission', async () => {
    const runtime = terminalCreateSuccess()
    const publish = vi.fn(runtime.admission.commit)
    const retire = vi.fn()
    const publishCommittedEffects = vi.fn()
    runtime.admission = { kind: 'prepared', commit: publish, publishCommittedEffects, abort: retire }
    const close = vi.fn(async () => ({ kind: 'closed' as const }))
    const broadcastWorkspaceTabsChanged = vi.fn()
    const application = createWorkspacePaneRuntimeApplication({
      worktreeOperations: createPhysicalWorktreeOperationCoordinator(),
      physicalWorktrees: testPhysicalWorktrees,
      terminalSessions: { listSessionsForUser: async () => [] },
      terminal: { createAdmitted: async () => runtime, close },
      workspaceTabsCoordinator: runtimeTabsCoordinator({
        ensureRuntimeTabForSession: async (input: { commitAdmission: (canonicalBranch: string) => void }) => {
          input.commitAdmission(request.branch)
          throw new Error('invariant failure after admission')
        },
      }),
      captureWorkspaceRuntimeMembershipCapability: () => workspaceRuntimeMembershipCapability(),
      invalidateWorkspaceTabs: vi.fn(),
      broadcastWorkspaceTabsChanged,
    })

    await expect(application.open('client-test', 'user-test', { runtimeType: 'terminal', request })).resolves.toEqual({
      ok: false,
      runtimeType: 'terminal',
      message: 'error.unavailable',
    })
    expect(publish).toHaveBeenCalledOnce()
    expect(retire).not.toHaveBeenCalled()
    expect(close).not.toHaveBeenCalled()
    expect(publishCommittedEffects).not.toHaveBeenCalled()
    expect(broadcastWorkspaceTabsChanged).not.toHaveBeenCalled()
  })
})
