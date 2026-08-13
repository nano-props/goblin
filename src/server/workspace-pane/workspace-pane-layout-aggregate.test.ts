// @vitest-environment node

import { describe, expect, test, vi } from 'vitest'
import {
  WorkspacePaneLayoutAggregate,
  type WorkspacePaneLayoutUpdateInput,
  type WorkspacePaneLayoutValidationInput,
} from '#/server/workspace-pane/workspace-pane-layout-aggregate.ts'
import type { WorkspacePaneLayoutRepository } from '#/server/workspace-pane/workspace-pane-layout-repository.ts'
import { createMemoryWorkspacePaneLayoutRepository } from '#/server/test-utils/workspace-pane-layout-repository.ts'
import type { WorkspacePaneLayoutRestoreTransaction } from '#/server/workspace-pane/workspace-pane-layout-restore-transaction.ts'
import type { WorkspacePaneDurableLayout } from '#/shared/workspace-pane-tabs.ts'
import { localWorkspaceSessionEntry } from '#/shared/remote-workspace.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import {
  workspacePaneRuntimeTabEntry,
  workspacePaneStaticTabEntry,
  workspacePaneTabEntryIdentity,
} from '#/shared/workspace-pane.ts'

const WORKSPACE_ID = workspaceIdForTest('goblin+file:///repo')
const OTHER_WORKSPACE_ID = workspaceIdForTest('goblin+file:///other-repo')
const LOCAL_WORKSPACE_ENTRY = localWorkspaceSessionEntry(WORKSPACE_ID)
import {
  issueTestPhysicalWorktreeExecutionCapability,
  testPhysicalWorktreeExecutionCapability,
  testPhysicalWorktreeIdentity,
} from '#/server/test-utils/physical-worktree-identity.ts'
import { physicalWorktreeAdmissionLease } from '#/server/worktree-removal/physical-worktree-capability.ts'
import { canonicalWorkspaceLocator } from '#/shared/workspace-locator.ts'
import type {
  WorkspaceRuntimeEpochCapability,
  WorkspaceRuntimeMembershipCapability,
} from '#/server/modules/workspace-runtimes.ts'

const scope = { userId: 'user-a', workspaceId: WORKSPACE_ID, workspaceRuntimeId: 'runtime-a' }
const testEpochCapability = epochCapabilityForTest(scope)
const testMembershipCapability: WorkspaceRuntimeMembershipCapability = {
  ...testEpochCapability,
  clientId: 'client-a',
  generation: 1,
}
const target = { branchName: 'feature/worktree', worktreePath: '/repo/worktree' }

function memoryRepository(initial?: WorkspacePaneDurableLayout) {
  return createMemoryWorkspacePaneLayoutRepository(WORKSPACE_ID, initial)
}
const workspaceId = canonicalWorkspaceLocator(WORKSPACE_ID)
const worktreeRoot = canonicalWorkspaceLocator('goblin+file:///repo/worktree')
if (!workspaceId || !worktreeRoot) throw new Error('invalid workspace locator fixture')
const canonicalWorkspaceId = workspaceId
const runtimeWorktreeTarget = {
  kind: 'git-worktree' as const,
  workspaceId: canonicalWorkspaceId,
  workspaceRuntimeId: scope.workspaceRuntimeId,
  root: worktreeRoot,
}
const worktreeMutationTarget = { target: runtimeWorktreeTarget, nativeWorktreePath: target.worktreePath }

function branchProjection(
  branch: string,
  workspaceRuntimeId = scope.workspaceRuntimeId,
): WorkspacePaneLayoutValidationInput['validTargets'][number] {
  return {
    target: { kind: 'git-branch', workspaceId: canonicalWorkspaceId, workspaceRuntimeId, branch },
    nativeWorktreePath: null,
  }
}

function worktreeProjection(): WorkspacePaneLayoutValidationInput['validTargets'][number] {
  return { target: runtimeWorktreeTarget, nativeWorktreePath: target.worktreePath }
}
const terminal = workspacePaneRuntimeTabEntry('terminal', 'term-livelivelivelivelive1')
const runtimeIntent = {
  runtimeType: 'terminal' as const,
  sessionId: 'term-livelivelivelivelive1',
  insertAfterIdentity: null,
}
const providers = [
  {
    type: 'terminal' as const,
    revision: 1,
    liveSessions: [
      {
        sessionId: 'term-livelivelivelivelive1',
        target: worktreeProjection().target,
        worktreePath: target.worktreePath,
      },
    ],
  },
]

function replacementCapability() {
  const identity = testPhysicalWorktreeIdentity(target.worktreePath)
  return issueTestPhysicalWorktreeExecutionCapability({
    identity,
    worktreePath: target.worktreePath,
  })
}

describe('workspace pane layout aggregate', () => {
  test('memory repository preserves raw fixtures within its bound workspace', async () => {
    const status = workspacePaneStaticTabEntry('status')
    const raw = { entries: [{ target: { kind: 'git-branch' as const, branch: 'main' }, tabs: [status, status] }] }
    const repository = memoryRepository(raw)

    await expect(repository.load(WORKSPACE_ID)).resolves.toEqual({ layout: raw })
    await expect(repository.load(OTHER_WORKSPACE_ID)).rejects.toThrow(
      'memory workspace pane layout repository scope mismatch',
    )
  })

  test('memory repository rejects a stale expected layout without replacing authority', async () => {
    const current = {
      entries: [{ target: { kind: 'git-branch' as const, branch: 'main' }, tabs: [] }],
    }
    const repository = memoryRepository(current)

    await expect(
      repository.compareAndSwap({
        workspaceId: WORKSPACE_ID,
        expected: { entries: [] },
        replacement: { entries: [] },
        epochCapability: testEpochCapability,
      }),
    ).resolves.toEqual({ kind: 'conflict', snapshot: { layout: current } })
    expect(repository.layout).toEqual(current)
  })

  test('re-reads and replans the original update intent after a CAS conflict', async () => {
    const repository = memoryRepository({
      entries: [
        {
          target: { kind: 'git-worktree', root: worktreeRoot },
          tabs: [workspacePaneStaticTabEntry('status')],
        },
      ],
    })
    const originalCas = repository.compareAndSwap
    const aggregate = aggregateFor(repository)
    await validateTargets(aggregate, [worktreeProjection()])
    let first = true
    repository.compareAndSwap = vi.fn(async (input) => {
      if (first) {
        first = false
        repository.layout = {
          entries: [
            {
              target: { kind: 'git-worktree', root: worktreeRoot },
              tabs: [workspacePaneStaticTabEntry('status'), workspacePaneStaticTabEntry('files')],
            },
          ],
        }
        return { kind: 'conflict' as const, snapshot: { layout: repository.layout } }
      }
      return await originalCas(input)
    })
    await update(aggregate, {
      ...scope,
      epochCapability: testEpochCapability,
      ...worktreeMutationTarget,
      operation: { type: 'open-static', tabType: 'history' },
      validTargets: [worktreeProjection()],
      physicalWorktreeLease: physicalWorktreeAdmissionLease(
        testPhysicalWorktreeExecutionCapability(target.worktreePath),
      ),
      providerSnapshots: [],
    })

    expect(repository.layout.entries[0]?.tabs).toEqual([
      workspacePaneStaticTabEntry('status'),
      workspacePaneStaticTabEntry('files'),
      workspacePaneStaticTabEntry('history'),
    ])
    expect(repository.compareAndSwap).toHaveBeenCalledTimes(2)
  })

  test('keeps runtime target overlay, clock, and snapshot unchanged when admission fails', async () => {
    const aggregate = aggregateFor(memoryRepository())
    const validTargets = [worktreeProjection()]
    const lease = physicalWorktreeAdmissionLease(testPhysicalWorktreeExecutionCapability(target.worktreePath))
    const baseline = await readSnapshot(aggregate, scope, validTargets, providers)

    await aggregate.runExclusive(scope.workspaceId, async (operation) => {
      await expect(
        operation.commitRuntimeTabPlacement(
          {
            ...scope,
            target: runtimeWorktreeTarget,
            lease,
            intent: runtimeIntent,
            validTargets,
            stagedProviderSnapshots: providers,
            epochCapability: testMembershipCapability,
          },
          () => {
            throw new Error('runtime admission failed')
          },
        ),
      ).rejects.toThrow('runtime admission failed')
      expect(operation.indexedAdmissionLeases(scope)).toEqual([])
      await expect(
        operation.snapshot({ scope, validTargets, providerSnapshots: providers, epochCapability: testEpochCapability }),
      ).resolves.toEqual(baseline)
    })
  })

  test('rejects a snapshot when its runtime expires during the durable layout read', async () => {
    const repository = memoryRepository()
    const load = repository.load
    const loadStarted = Promise.withResolvers<void>()
    const resumeLoad = Promise.withResolvers<void>()
    repository.load = vi.fn(async (workspaceId) => {
      loadStarted.resolve()
      await resumeLoad.promise
      return await load(workspaceId)
    })
    const aggregate = aggregateFor(repository)
    let current = true
    const snapshot = aggregate.runExclusive(
      scope.workspaceId,
      async (operation) =>
        await operation.snapshot({
          scope,
          validTargets: [worktreeProjection()],
          providerSnapshots: providers,
          epochCapability: {
            ...scope,
            isCurrent: () => current,
            assertCurrent: () => {
              if (!current) throw new Error('error.workspace-runtime-stale')
            },
          },
        }),
    )

    await loadStarted.promise
    current = false
    resumeLoad.resolve()

    await expect(snapshot).rejects.toThrow('error.workspace-runtime-stale')
  })

  test('atomically swaps the staged runtime target state after the commit callback succeeds', async () => {
    const aggregate = aggregateFor(memoryRepository())
    const validTargets = [worktreeProjection()]
    const lease = physicalWorktreeAdmissionLease(testPhysicalWorktreeExecutionCapability(target.worktreePath))
    await readSnapshot(aggregate, scope, validTargets, providers)

    await aggregate.runExclusive(scope.workspaceId, async (operation) => {
      let callbackObservedUncommittedState = false
      const snapshot = await operation.commitRuntimeTabPlacement(
        {
          ...scope,
          target: runtimeWorktreeTarget,
          lease,
          intent: runtimeIntent,
          validTargets,
          stagedProviderSnapshots: providers,
          epochCapability: testMembershipCapability,
        },
        () => {
          callbackObservedUncommittedState = operation.indexedAdmissionLeases(scope).length === 0
        },
      )

      expect(callbackObservedUncommittedState).toBe(true)
      expect(operation.indexedAdmissionLeases(scope)).toEqual([lease])
      await expect(
        operation.snapshot({ scope, validTargets, providerSnapshots: providers, epochCapability: testEpochCapability }),
      ).resolves.toEqual(snapshot)
    })
  })

  test('reapplying the same runtime placement is idempotent and loads durable state once per intent', async () => {
    const repository = memoryRepository()
    repository.load = vi.fn(repository.load)
    repository.compareAndSwap = vi.fn(repository.compareAndSwap)
    const aggregate = aggregateFor(repository)
    const validTargets = [worktreeProjection()]
    const lease = physicalWorktreeAdmissionLease(testPhysicalWorktreeExecutionCapability(target.worktreePath))
    const commitAdmission = vi.fn()

    const snapshots = []
    for (let attempt = 0; attempt < 2; attempt += 1) {
      snapshots.push(
        await aggregate.runExclusive(
          scope.workspaceId,
          async (operation) =>
            await operation.commitRuntimeTabPlacement(
              {
                ...scope,
                target: runtimeWorktreeTarget,
                lease,
                intent: runtimeIntent,
                validTargets,
                stagedProviderSnapshots: providers,
                epochCapability: testMembershipCapability,
              },
              commitAdmission,
            ),
        ),
      )
    }

    expect(snapshots[1]).toEqual(snapshots[0])
    expect(snapshots[1]?.entries[0]?.tabs.filter((tab) => tab.type === 'terminal')).toEqual([terminal])
    expect(repository.load).toHaveBeenCalledTimes(2)
    expect(repository.compareAndSwap).not.toHaveBeenCalled()
    expect(commitAdmission).toHaveBeenCalledTimes(2)
    expect(aggregate.physicalTargets(lease)).toEqual([{ ...scope, target: runtimeWorktreeTarget }])
  })

  test('preserves an anchored runtime placement when the same intent is reapplied', async () => {
    const aggregate = aggregateFor(memoryRepository())
    const validTargets = [worktreeProjection()]
    const lease = physicalWorktreeAdmissionLease(testPhysicalWorktreeExecutionCapability(target.worktreePath))
    const firstTerminal = workspacePaneRuntimeTabEntry('terminal', 'term-firstfirstfirstfirst001')
    const anchoredTerminal = workspacePaneRuntimeTabEntry('terminal', 'term-anchoranchoranchor001')
    const stagedProviderSnapshots = [
      {
        type: 'terminal' as const,
        revision: 1,
        liveSessions: [firstTerminal, anchoredTerminal].map((entry) => ({
          sessionId: entry.runtimeSessionId,
          target: runtimeWorktreeTarget,
          worktreePath: target.worktreePath,
        })),
      },
    ]
    const intent = {
      runtimeType: 'terminal' as const,
      sessionId: anchoredTerminal.runtimeSessionId,
      insertAfterIdentity: workspacePaneTabEntryIdentity(workspacePaneStaticTabEntry('status')),
    }

    const snapshots = []
    for (let attempt = 0; attempt < 2; attempt += 1) {
      snapshots.push(
        await aggregate.runExclusive(
          scope.workspaceId,
          async (operation) =>
            await operation.commitRuntimeTabPlacement(
              {
                ...scope,
                target: runtimeWorktreeTarget,
                lease,
                intent,
                validTargets,
                stagedProviderSnapshots,
                epochCapability: testMembershipCapability,
              },
              () => undefined,
            ),
        ),
      )
    }

    expect(snapshots[0].entries[0]?.tabs).toEqual([
      workspacePaneStaticTabEntry('status'),
      anchoredTerminal,
      firstTerminal,
    ])
    expect(snapshots[1]).toEqual(snapshots[0])
    expect(snapshots[1].revision).toBe(snapshots[0].revision)
    expect(snapshots[1].entries[0]?.tabs.filter((tab) => tab.type === 'terminal')).toHaveLength(2)
  })

  test('preserves an existing epoch and its physical index when a replacement admission fails', async () => {
    const aggregate = aggregateFor(memoryRepository())
    const validTargets = [worktreeProjection()]
    const firstLease = physicalWorktreeAdmissionLease(testPhysicalWorktreeExecutionCapability(target.worktreePath))
    const replacementLease = physicalWorktreeAdmissionLease(replacementCapability())
    await aggregate.runExclusive(scope.workspaceId, async (operation) => {
      await operation.commitRuntimeTabPlacement(
        {
          ...scope,
          target: runtimeWorktreeTarget,
          lease: firstLease,
          intent: runtimeIntent,
          validTargets,
          stagedProviderSnapshots: providers,
          epochCapability: testMembershipCapability,
        },
        () => undefined,
      )
    })
    const baseline = await readSnapshot(aggregate, scope, validTargets, providers)

    await expect(
      aggregate.runExclusive(
        scope.workspaceId,
        async (operation) =>
          await operation.commitRuntimeTabPlacement(
            {
              ...scope,
              target: runtimeWorktreeTarget,
              lease: replacementLease,
              intent: runtimeIntent,
              validTargets,
              stagedProviderSnapshots: providers,
              epochCapability: testMembershipCapability,
            },
            () => {
              throw new Error('replacement admission failed')
            },
          ),
      ),
    ).rejects.toThrow('replacement admission failed')

    await expect(readSnapshot(aggregate, scope, validTargets, providers)).resolves.toEqual(baseline)
    expect(aggregate.physicalTargets(firstLease)).toEqual([{ ...scope, target: runtimeWorktreeTarget }])
    expect(aggregate.physicalTargets(replacementLease)).toEqual([])
  })

  test('replaces a target lease without retaining its old reverse index and leaves sibling epochs unchanged', async () => {
    const aggregate = aggregateFor(memoryRepository())
    const firstLease = physicalWorktreeAdmissionLease(testPhysicalWorktreeExecutionCapability(target.worktreePath))
    const replacementLease = physicalWorktreeAdmissionLease(replacementCapability())
    const siblingScope = { ...scope, userId: 'user-b' }
    const validTargets = [worktreeProjection()]

    for (const [epochScope, lease] of [
      [scope, firstLease],
      [siblingScope, firstLease],
    ] as const) {
      const epochCapability = epochCapabilityForTest(epochScope)
      await aggregate.runExclusive(scope.workspaceId, async (operation) => {
        await operation.commitRuntimeTabPlacement(
          {
            ...epochScope,
            target: runtimeWorktreeTarget,
            lease,
            intent: runtimeIntent,
            validTargets,
            stagedProviderSnapshots: providers,
            epochCapability: {
              ...epochCapability,
              clientId: 'client-a',
              generation: 1,
            },
          },
          () => undefined,
        )
      })
    }
    const siblingBaseline = await readSnapshot(aggregate, siblingScope, validTargets, providers)

    await aggregate.runExclusive(scope.workspaceId, async (operation) => {
      await operation.commitRuntimeTabPlacement(
        {
          ...scope,
          target: runtimeWorktreeTarget,
          lease: replacementLease,
          intent: runtimeIntent,
          validTargets,
          stagedProviderSnapshots: providers,
          epochCapability: testMembershipCapability,
        },
        () => undefined,
      )
    })

    expect(aggregate.physicalTargets(firstLease)).toEqual([{ ...siblingScope, target: runtimeWorktreeTarget }])
    expect(aggregate.physicalTargets(replacementLease)).toEqual([{ ...scope, target: runtimeWorktreeTarget }])
    await expect(readSnapshot(aggregate, siblingScope, validTargets, providers)).resolves.toEqual(siblingBaseline)
  })

  test('rejects staging a runtime target outside the authoritative target projection', async () => {
    const repository = memoryRepository()
    repository.load = vi.fn(repository.load)
    const aggregate = aggregateFor(repository)
    const lease = physicalWorktreeAdmissionLease(testPhysicalWorktreeExecutionCapability(target.worktreePath))

    await expect(
      aggregate.runExclusive(
        scope.workspaceId,
        async (operation) =>
          await operation.commitRuntimeTabPlacement(
            {
              ...scope,
              target: runtimeWorktreeTarget,
              lease,
              intent: runtimeIntent,
              validTargets: [],
              stagedProviderSnapshots: providers,
              epochCapability: testMembershipCapability,
            },
            () => undefined,
          ),
      ),
    ).rejects.toThrow('error.workspace-tabs-target-invalid')
    expect(repository.load).not.toHaveBeenCalled()
    expect(aggregate.activeEpochs(scope.workspaceId)).toEqual([])
  })

  test('uses one monotonic clock across durable, target, overlay, and provider dependencies', async () => {
    const branchTarget = branchProjection('main')
    const repository = memoryRepository({
      entries: [{ target: { kind: 'git-branch', branch: 'main' }, tabs: [] }],
    })
    const aggregate = aggregateFor(repository)
    const validated = await validate(aggregate, {
      ...scope,
      epochCapability: testEpochCapability,
      validTargets: [branchTarget],
      physicalTargets: [],
      expectedWorkspaceEntry: LOCAL_WORKSPACE_ENTRY,
      providerSnapshots: [],
    })
    if (validated.kind !== 'validated') throw new Error('unexpected membership conflict')
    const first = validated.snapshot
    const unchanged = await readSnapshot(aggregate, scope, [branchTarget], [])
    repository.layout = {
      entries: [{ target: { kind: 'git-branch', branch: 'main' }, tabs: [workspacePaneStaticTabEntry('history')] }],
    }
    const durable = await readSnapshot(aggregate, scope, [branchTarget], [])
    const provider = await readSnapshot(aggregate, scope, [branchTarget], [{ ...providers[0], liveSessions: [] }])

    expect([first.revision, unchanged.revision, durable.revision, provider.revision]).toEqual([0, 0, 1, 2])
    expect(provider.entries[0]?.tabs.map(workspacePaneTabEntryIdentity)).toEqual([
      workspacePaneTabEntryIdentity(workspacePaneStaticTabEntry('history')),
    ])
  })

  test('does not expose unvalidated durable targets in a new epoch', async () => {
    const aggregate = aggregateFor(
      memoryRepository({
        entries: [
          {
            target: { kind: 'git-branch', branch: 'stale' },
            tabs: [workspacePaneStaticTabEntry('history')],
          },
        ],
      }),
    )

    await expect(readSnapshot(aggregate, scope, [], [])).resolves.toMatchObject({ entries: [] })
  })

  test('does not durably repair targets from an unversioned projection', async () => {
    const valid: WorkspacePaneDurableLayout['entries'][number] = {
      target: { kind: 'git-branch', branch: 'main' },
      tabs: [workspacePaneStaticTabEntry('history')],
    }
    const invalid: WorkspacePaneDurableLayout['entries'][number] = {
      target: { kind: 'git-branch', branch: 'deleted' },
      tabs: [workspacePaneStaticTabEntry('status')],
    }
    const repository = memoryRepository({ entries: [valid, invalid] })
    const aggregate = aggregateFor(repository)

    const result = await validate(aggregate, {
      ...scope,
      epochCapability: testEpochCapability,
      validTargets: [branchProjection('main')],
      physicalTargets: [],
      expectedWorkspaceEntry: LOCAL_WORKSPACE_ENTRY,
      providerSnapshots: [],
    })

    expect(repository.layout).toEqual({ entries: [valid, invalid] })
    expect(result).toMatchObject({
      kind: 'validated',
      snapshot: { entries: [{ target: { kind: 'git-branch', branch: 'main' }, tabs: valid.tabs }] },
    })
  })

  test('repairs multiple invalid targets in one membership-aware transaction', async () => {
    const valid: WorkspacePaneDurableLayout['entries'][number] = {
      target: { kind: 'git-branch', branch: 'main' },
      tabs: [],
    }
    const invalidA: WorkspacePaneDurableLayout['entries'][number] = {
      target: { kind: 'git-branch', branch: 'deleted-a' },
      tabs: [],
    }
    const invalidB: WorkspacePaneDurableLayout['entries'][number] = {
      target: { kind: 'git-branch', branch: 'deleted-b' },
      tabs: [],
    }
    const repository = memoryRepository({ entries: [valid, invalidA, invalidB] })
    const repairs: string[][] = []
    const restoreTransaction: WorkspacePaneLayoutRestoreTransaction = {
      async validateMembershipAndLoad(input) {
        repairs.push([])
        const current = await repository.load(input.workspaceId)
        return { kind: 'accepted' as const, snapshot: current }
      },
    }
    const aggregate = aggregateFor(repository, restoreTransaction)

    await validate(aggregate, {
      ...scope,
      epochCapability: testEpochCapability,
      validTargets: [branchProjection('main')],
      physicalTargets: [],
      expectedWorkspaceEntry: LOCAL_WORKSPACE_ENTRY,
      providerSnapshots: [],
    })

    expect(repairs).toHaveLength(1)
    expect(repository.layout).toEqual({ entries: [valid, invalidA, invalidB] })
  })

  test('does not report a durable change when restore validation is a no-op', async () => {
    const valid: WorkspacePaneDurableLayout['entries'][number] = {
      target: { kind: 'git-branch', branch: 'main' },
      tabs: [workspacePaneStaticTabEntry('history')],
    }
    const repository = memoryRepository({ entries: [valid] })
    const aggregate = aggregateFor(repository)

    const result = await validate(aggregate, {
      ...scope,
      epochCapability: testEpochCapability,
      validTargets: [branchProjection('main')],
      physicalTargets: [],
      expectedWorkspaceEntry: LOCAL_WORKSPACE_ENTRY,
      providerSnapshots: [],
    })

    expect(result).toMatchObject({
      kind: 'validated',
      snapshot: { entries: [{ target: { kind: 'git-branch', branch: 'main' }, tabs: valid.tabs }] },
    })
  })

  test('does not let a pane mutation create target validity after restore validation', async () => {
    const repository = memoryRepository()
    const aggregate = aggregateFor(repository)
    await validate(aggregate, {
      ...scope,
      epochCapability: testEpochCapability,
      validTargets: [],
      physicalTargets: [],
      expectedWorkspaceEntry: LOCAL_WORKSPACE_ENTRY,
      providerSnapshots: [],
    })

    await expect(
      update(aggregate, {
        ...scope,
        epochCapability: testEpochCapability,
        target: branchProjection('feature').target,
        nativeWorktreePath: null,
        operation: { type: 'open-static', tabType: 'history' },
        validTargets: [],
        providerSnapshots: [],
      }),
    ).rejects.toThrow('error.workspace-tabs-target-invalid')
    expect(repository.layout).toEqual({ entries: [] })
  })

  test('does not let provider membership authorize a durable target mutation', async () => {
    const repository = memoryRepository()
    const aggregate = aggregateFor(repository)

    await expect(
      update(aggregate, {
        ...scope,
        epochCapability: testEpochCapability,
        ...worktreeMutationTarget,
        operation: { type: 'open-static', tabType: 'history' },
        validTargets: [],
        providerSnapshots: providers,
        physicalWorktreeLease: physicalWorktreeAdmissionLease(
          testPhysicalWorktreeExecutionCapability(target.worktreePath),
        ),
      }),
    ).rejects.toThrow('error.workspace-tabs-target-invalid')
  })

  test('does not treat persistence failure as repair authority', async () => {
    const repository = memoryRepository({
      entries: [
        {
          target: { kind: 'git-branch', branch: 'deleted' },
          tabs: [workspacePaneStaticTabEntry('status')],
        },
      ],
    })
    repository.compareAndSwap = vi.fn(async () => ({
      kind: 'write-failure' as const,
      error: new Error('disk full'),
    }))
    const aggregate = aggregateFor(repository)

    const result = await validate(aggregate, {
      ...scope,
      epochCapability: testEpochCapability,
      validTargets: [],
      physicalTargets: [],
      expectedWorkspaceEntry: LOCAL_WORKSPACE_ENTRY,
      providerSnapshots: [],
    })

    expect(result).toMatchObject({
      kind: 'validated',
      snapshot: { entries: [] },
    })
    expect(repository.layout.entries).toHaveLength(1)
    await expect(readSnapshot(aggregate, scope, [], [])).resolves.toMatchObject({ entries: [] })
  })

  test('keeps invalid durable tabs suppressed when only a live provider still references the target', async () => {
    const repository = memoryRepository({
      entries: [
        {
          target: { kind: 'git-worktree', root: worktreeRoot },
          tabs: [workspacePaneStaticTabEntry('history')],
        },
      ],
    })
    repository.compareAndSwap = vi.fn(async () => ({
      kind: 'write-failure' as const,
      error: new Error('disk full'),
    }))
    const aggregate = aggregateFor(repository)

    const result = await validate(aggregate, {
      ...scope,
      epochCapability: testEpochCapability,
      validTargets: [],
      physicalTargets: [],
      expectedWorkspaceEntry: LOCAL_WORKSPACE_ENTRY,
      providerSnapshots: providers,
    })

    expect(result).toMatchObject({
      kind: 'validated',
      snapshot: {
        entries: [
          {
            target: { kind: 'git-worktree', root: worktreeRoot },
            tabs: [workspacePaneStaticTabEntry('status'), terminal],
          },
        ],
      },
    })
  })

  test('checks membership before committing restore epoch metadata even when no repair is needed', async () => {
    const repository = memoryRepository()
    const aggregate = new WorkspacePaneLayoutAggregate({
      repository,
      restoreTransaction: {
        async validateMembershipAndLoad() {
          return { kind: 'membership-conflict', snapshot: { layout: { entries: [] } } }
        },
      },
    })

    await expect(
      validate(aggregate, {
        ...scope,
        epochCapability: testEpochCapability,
        validTargets: [worktreeProjection()],
        physicalTargets: [],
        expectedWorkspaceEntry: LOCAL_WORKSPACE_ENTRY,
        providerSnapshots: [],
      }),
    ).resolves.toEqual({ kind: 'membership-conflict' })
    expect(aggregate.activeEpochs(WORKSPACE_ID)).toEqual([])
  })

  test('rechecks runtime currentness after the restore transaction before committing epoch state', async () => {
    const repository = memoryRepository()
    let current = true
    const aggregate = aggregateFor(repository, {
      async validateMembershipAndLoad() {
        current = false
        return { kind: 'accepted', changed: false, snapshot: { layout: { entries: [] } } }
      },
    })

    await expect(
      validate(aggregate, {
        ...scope,
        epochCapability: epochCapabilityForTest(scope, () => {
          if (!current) throw new Error('error.workspace-runtime-stale')
        }),
        validTargets: [branchProjection('main')],
        physicalTargets: [],
        expectedWorkspaceEntry: LOCAL_WORKSPACE_ENTRY,
        providerSnapshots: [],
      }),
    ).rejects.toThrow('error.workspace-runtime-stale')
    expect(aggregate.activeEpochs(WORKSPACE_ID)).toEqual([])
  })

  test('does not degrade when restore transaction fails before producing an outcome', async () => {
    const repository = memoryRepository()
    const failure = new Error('settings unavailable')
    const aggregate = aggregateFor(repository, {
      async validateMembershipAndLoad() {
        throw failure
      },
    })

    await expect(
      validate(aggregate, {
        ...scope,
        epochCapability: testEpochCapability,
        validTargets: [],
        physicalTargets: [],
        expectedWorkspaceEntry: LOCAL_WORKSPACE_ENTRY,
        providerSnapshots: [],
      }),
    ).rejects.toBe(failure)
    expect(aggregate.activeEpochs(WORKSPACE_ID)).toEqual([])
  })

  test('uses the validated target identity for a live worktree provider', async () => {
    const repository = memoryRepository({
      entries: [
        {
          target: { kind: 'git-worktree', root: worktreeRoot },
          tabs: [],
        },
      ],
    })
    const aggregate = aggregateFor(repository)
    const result = await validate(aggregate, {
      ...scope,
      epochCapability: testEpochCapability,
      validTargets: [worktreeProjection()],
      physicalTargets: [],
      expectedWorkspaceEntry: LOCAL_WORKSPACE_ENTRY,
      providerSnapshots: [
        {
          type: 'terminal',
          revision: 1,
          liveSessions: [
            {
              sessionId: 'term-currentcurrentcurrent1',
              target: worktreeProjection().target,
              worktreePath: '/repo/worktree',
            },
          ],
        },
      ],
    })

    expect(result).toMatchObject({
      kind: 'validated',
      snapshot: { entries: [{ target: { kind: 'git-worktree', root: worktreeRoot } }] },
    })
  })

  test('uses validated repo projection metadata for a worktree without a live provider', async () => {
    const repository = memoryRepository({
      entries: [
        {
          target: { kind: 'git-worktree', root: worktreeRoot },
          tabs: [workspacePaneStaticTabEntry('history')],
        },
      ],
    })
    const aggregate = aggregateFor(repository)

    const result = await validate(aggregate, {
      ...scope,
      epochCapability: testEpochCapability,
      validTargets: [worktreeProjection()],
      physicalTargets: [],
      expectedWorkspaceEntry: LOCAL_WORKSPACE_ENTRY,
      providerSnapshots: [],
    })

    expect(result).toMatchObject({
      kind: 'validated',
      snapshot: { entries: [{ target: { kind: 'git-worktree', root: worktreeRoot } }] },
    })
  })

  test('returns every active user affected by a durable layout commit', async () => {
    const aggregate = aggregateFor(
      memoryRepository({
        entries: [
          {
            target: { kind: 'git-branch', branch: 'main' },
            tabs: [workspacePaneStaticTabEntry('status')],
          },
        ],
      }),
    )
    await validateTargets(aggregate, [branchProjection('main')])
    const mainTarget = branchProjection('main')
    await readSnapshot(
      aggregate,
      { ...scope, userId: 'user-b', workspaceRuntimeId: 'runtime-b' },
      [branchProjection('main', 'runtime-b')],
      [],
    )

    const result = await update(aggregate, {
      ...scope,
      epochCapability: testEpochCapability,
      target: mainTarget.target,
      nativeWorktreePath: null,
      operation: { type: 'open-static', tabType: 'history' },
      validTargets: [mainTarget],
      providerSnapshots: [],
    })

    expect(result).toEqual({ affectedUserIds: ['user-a'], projectionCurrent: true })
  })
})

function aggregateFor(
  repository: WorkspacePaneLayoutRepository,
  restoreTransaction: WorkspacePaneLayoutRestoreTransaction = {
    async validateMembershipAndLoad(input) {
      const current = await repository.load(input.workspaceId)
      return { kind: 'accepted' as const, changed: false, snapshot: current }
    },
  },
): WorkspacePaneLayoutAggregate {
  return new WorkspacePaneLayoutAggregate({ repository, restoreTransaction })
}

async function validateTargets(
  aggregate: WorkspacePaneLayoutAggregate,
  validTargets: WorkspacePaneLayoutValidationInput['validTargets'],
): Promise<void> {
  const result = await validate(aggregate, {
    ...scope,
    epochCapability: testEpochCapability,
    validTargets,
    physicalTargets: [],
    expectedWorkspaceEntry: LOCAL_WORKSPACE_ENTRY,
    providerSnapshots: [],
  })
  if (result.kind !== 'validated') throw new Error('test target validation failed')
}

async function update(aggregate: WorkspacePaneLayoutAggregate, input: WorkspacePaneLayoutUpdateInput) {
  return await aggregate.runExclusive(input.workspaceId, async (operation) => await operation.update(input))
}

async function readSnapshot(
  aggregate: WorkspacePaneLayoutAggregate,
  snapshotScope: typeof scope,
  validTargets: WorkspacePaneLayoutValidationInput['validTargets'],
  providerSnapshots: WorkspacePaneLayoutValidationInput['providerSnapshots'],
) {
  return await aggregate.runExclusive(
    snapshotScope.workspaceId,
    async (operation) =>
      await operation.snapshot({
        scope: snapshotScope,
        validTargets,
        providerSnapshots,
        epochCapability: epochCapabilityForTest(snapshotScope),
      }),
  )
}

async function validate(aggregate: WorkspacePaneLayoutAggregate, input: WorkspacePaneLayoutValidationInput) {
  return await aggregate.runExclusive(
    input.workspaceId,
    async (operation) => await operation.validateMembershipAndSnapshot(input),
  )
}

function epochCapabilityForTest(
  authorityScope: typeof scope,
  assertCurrent: () => void = () => {},
): WorkspaceRuntimeEpochCapability {
  return {
    ...authorityScope,
    isCurrent: () => {
      try {
        assertCurrent()
        return true
      } catch {
        return false
      }
    },
    assertCurrent,
  }
}
