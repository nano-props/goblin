// @vitest-environment node

import { describe, expect, test, vi } from 'vitest'
import {
  WorkspacePaneLayoutAggregate,
  type WorkspacePaneLayoutReplaceInput,
  type WorkspacePaneLayoutUpdateInput,
  type WorkspacePaneLayoutValidationInput,
} from '#/server/workspace-pane/workspace-pane-layout-aggregate.ts'
import type {
  WorkspacePaneLayoutRepository,
  WorkspacePaneLayoutRepositoryCasInput,
  WorkspacePaneLayoutRepositoryCasOutcome,
} from '#/server/workspace-pane/workspace-pane-layout-repository.ts'
import type { WorkspacePaneLayoutRestoreTransaction } from '#/server/workspace-pane/workspace-pane-layout-restore-transaction.ts'
import type { WorkspacePaneDurableLayout } from '#/shared/workspace-pane-tabs.ts'
import {
  workspacePaneRuntimeTabEntry,
  workspacePaneStaticTabEntry,
  workspacePaneTabEntryIdentity,
} from '#/shared/workspace-pane.ts'
import {
  issueTestPhysicalWorktreeExecutionCapability,
  testPhysicalWorktreeExecutionCapability,
  testPhysicalWorktreeIdentity,
} from '#/server/test-utils/physical-worktree-identity.ts'
import { physicalWorktreeAdmissionLease } from '#/server/worktree-removal/physical-worktree-capability.ts'
import { canonicalWorkspaceLocator } from '#/shared/workspace-locator.ts'

const scope = { userId: 'user-a', repoRoot: 'goblin+file:///repo', workspaceRuntimeId: 'runtime-a' }
const target = { branchName: 'feature/worktree', worktreePath: '/repo/worktree' }
const workspaceId = canonicalWorkspaceLocator(scope.repoRoot)
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
    canonicalBranch: branch,
  }
}

function worktreeProjection(branch: string): WorkspacePaneLayoutValidationInput['validTargets'][number] {
  return { target: runtimeWorktreeTarget, nativeWorktreePath: target.worktreePath, canonicalBranch: branch }
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
        target: worktreeProjection(target.branchName).target,
        branch: target.branchName,
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
    execution: {
      kind: 'local',
      canonicalWorktreePath: identity.endpoint,
      endpointMarker: { deviceId: 'replacement-device', inode: 'replacement-inode' },
    },
  })
}

describe('workspace pane layout aggregate', () => {
  test('splits a mixed command into durable static layout and epoch placement', async () => {
    const repository = memoryRepository()
    const aggregate = aggregateFor(repository)

    await replace(aggregate, {
      ...scope,
      ...worktreeMutationTarget,
      tabs: [workspacePaneStaticTabEntry('status'), terminal, workspacePaneStaticTabEntry('history')],
      validTargets: [worktreeProjection(target.branchName)],
      physicalWorktreeLease: physicalWorktreeAdmissionLease(
        testPhysicalWorktreeExecutionCapability(target.worktreePath),
      ),
      providerSnapshots: providers,
    })
    const snapshot = await readSnapshot(aggregate, scope, [worktreeProjection(target.branchName)], providers)

    expect(repository.layout).toEqual({
      entries: [
        {
          target: { kind: 'git-worktree', root: worktreeRoot },
          tabs: [workspacePaneStaticTabEntry('status'), workspacePaneStaticTabEntry('history')],
        },
      ],
    })
    expect(snapshot.entries[0]?.tabs).toEqual([
      workspacePaneStaticTabEntry('status'),
      terminal,
      workspacePaneStaticTabEntry('history'),
    ])
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
    await validateTargets(aggregate, [worktreeProjection(target.branchName)])
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
      ...worktreeMutationTarget,
      operation: { type: 'open-static', tabType: 'history' },
      validTargets: [worktreeProjection(target.branchName)],
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

  test('rejects an absolute replace after a CAS conflict instead of replaying stale layout', async () => {
    const repository = memoryRepository({
      entries: [{ target: { kind: 'git-worktree', root: worktreeRoot }, tabs: [] }],
    })
    const aggregate = aggregateFor(repository)
    await validateTargets(aggregate, [worktreeProjection(target.branchName)])
    repository.compareAndSwap = vi.fn(async () => ({
      kind: 'conflict' as const,
      snapshot: { layout: { entries: [] } },
    }))
    await expect(
      replace(aggregate, {
        ...scope,
        ...worktreeMutationTarget,
        tabs: [workspacePaneStaticTabEntry('history')],
        validTargets: [worktreeProjection(target.branchName)],
        physicalWorktreeLease: physicalWorktreeAdmissionLease(
          testPhysicalWorktreeExecutionCapability(target.worktreePath),
        ),
        providerSnapshots: [],
      }),
    ).rejects.toThrow('error.workspace-tabs-layout-conflict')
    expect(repository.compareAndSwap).toHaveBeenCalledOnce()
  })

  test('commits no overlay or revision when persistence fails', async () => {
    const repository = memoryRepository()
    repository.compareAndSwap = vi.fn(async () => ({
      kind: 'write-failure' as const,
      error: new Error('disk full'),
    }))
    const aggregate = aggregateFor(repository)

    await expect(
      replace(aggregate, {
        ...scope,
        ...worktreeMutationTarget,
        tabs: [terminal, workspacePaneStaticTabEntry('status')],
        validTargets: [worktreeProjection(target.branchName)],
        physicalWorktreeLease: physicalWorktreeAdmissionLease(
          testPhysicalWorktreeExecutionCapability(target.worktreePath),
        ),
        providerSnapshots: providers,
      }),
    ).rejects.toThrow('disk full')
    await expect(readSnapshot(aggregate, scope, [], providers)).resolves.toMatchObject({
      revision: 0,
      entries: [{ tabs: [workspacePaneStaticTabEntry('status'), terminal] }],
    })
  })

  test('keeps runtime target overlay, clock, and snapshot unchanged when admission fails', async () => {
    const aggregate = aggregateFor(memoryRepository())
    const validTargets = [worktreeProjection(target.branchName)]
    const lease = physicalWorktreeAdmissionLease(testPhysicalWorktreeExecutionCapability(target.worktreePath))
    const baseline = await readSnapshot(aggregate, scope, validTargets, providers)

    await aggregate.runExclusive(scope.repoRoot, async (operation) => {
      await expect(
        operation.commitRuntimeTabPlacement(
          {
            ...scope,
            target: runtimeWorktreeTarget,
            lease,
            intent: runtimeIntent,
            validTargets,
            stagedProviderSnapshots: providers,
          },
          () => {
          throw new Error('runtime admission failed')
          },
        ),
      ).rejects.toThrow('runtime admission failed')
      expect(operation.indexedAdmissionLeases(scope)).toEqual([])
      await expect(
        operation.snapshot({ scope, validTargets, providerSnapshots: providers }),
      ).resolves.toEqual(baseline)
    })
  })

  test('atomically swaps the staged runtime target state after the commit callback succeeds', async () => {
    const aggregate = aggregateFor(memoryRepository())
    const validTargets = [worktreeProjection(target.branchName)]
    const lease = physicalWorktreeAdmissionLease(testPhysicalWorktreeExecutionCapability(target.worktreePath))
    await readSnapshot(aggregate, scope, validTargets, providers)

    await aggregate.runExclusive(scope.repoRoot, async (operation) => {
      let callbackObservedUncommittedState = false
      const snapshot = await operation.commitRuntimeTabPlacement(
        {
          ...scope,
          target: runtimeWorktreeTarget,
          lease,
          intent: runtimeIntent,
          validTargets,
          stagedProviderSnapshots: providers,
        },
        () => {
          callbackObservedUncommittedState = operation.indexedAdmissionLeases(scope).length === 0
        },
      )

      expect(callbackObservedUncommittedState).toBe(true)
      expect(operation.indexedAdmissionLeases(scope)).toEqual([lease])
      await expect(
        operation.snapshot({ scope, validTargets, providerSnapshots: providers }),
      ).resolves.toEqual(snapshot)
    })
  })

  test('reapplying the same runtime placement is idempotent and loads durable state once per intent', async () => {
    const repository = memoryRepository()
    repository.load = vi.fn(repository.load)
    repository.compareAndSwap = vi.fn(repository.compareAndSwap)
    const aggregate = aggregateFor(repository)
    const validTargets = [worktreeProjection(target.branchName)]
    const lease = physicalWorktreeAdmissionLease(testPhysicalWorktreeExecutionCapability(target.worktreePath))
    const commitAdmission = vi.fn()

    const snapshots = []
    for (let attempt = 0; attempt < 2; attempt += 1) {
      snapshots.push(
        await aggregate.runExclusive(scope.repoRoot, async (operation) =>
          await operation.commitRuntimeTabPlacement(
            {
              ...scope,
              target: runtimeWorktreeTarget,
              lease,
              intent: runtimeIntent,
              validTargets,
              stagedProviderSnapshots: providers,
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
    const validTargets = [worktreeProjection(target.branchName)]
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
          branch: target.branchName,
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
        await aggregate.runExclusive(scope.repoRoot, async (operation) =>
          await operation.commitRuntimeTabPlacement(
            {
              ...scope,
              target: runtimeWorktreeTarget,
              lease,
              intent,
              validTargets,
              stagedProviderSnapshots,
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
    const validTargets = [worktreeProjection(target.branchName)]
    const firstLease = physicalWorktreeAdmissionLease(testPhysicalWorktreeExecutionCapability(target.worktreePath))
    const replacementLease = physicalWorktreeAdmissionLease(replacementCapability())
    await aggregate.runExclusive(scope.repoRoot, async (operation) => {
      await operation.commitRuntimeTabPlacement(
        { ...scope, target: runtimeWorktreeTarget, lease: firstLease, intent: runtimeIntent, validTargets, stagedProviderSnapshots: providers },
        () => undefined,
      )
    })
    const baseline = await readSnapshot(aggregate, scope, validTargets, providers)

    await expect(
      aggregate.runExclusive(scope.repoRoot, async (operation) =>
        await operation.commitRuntimeTabPlacement(
          {
            ...scope,
            target: runtimeWorktreeTarget,
            lease: replacementLease,
            intent: runtimeIntent,
            validTargets,
            stagedProviderSnapshots: providers,
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
    const validTargets = [worktreeProjection(target.branchName)]

    for (const [epochScope, lease] of [[scope, firstLease], [siblingScope, firstLease]] as const) {
      await aggregate.runExclusive(scope.repoRoot, async (operation) => {
        await operation.commitRuntimeTabPlacement(
          { ...epochScope, target: runtimeWorktreeTarget, lease, intent: runtimeIntent, validTargets, stagedProviderSnapshots: providers },
          () => undefined,
        )
      })
    }
    const siblingBaseline = await readSnapshot(aggregate, siblingScope, validTargets, providers)

    await aggregate.runExclusive(scope.repoRoot, async (operation) => {
      await operation.commitRuntimeTabPlacement(
        { ...scope, target: runtimeWorktreeTarget, lease: replacementLease, intent: runtimeIntent, validTargets, stagedProviderSnapshots: providers },
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
      aggregate.runExclusive(scope.repoRoot, async (operation) =>
        await operation.commitRuntimeTabPlacement(
          {
            ...scope,
            target: runtimeWorktreeTarget,
            lease,
            intent: runtimeIntent,
            validTargets: [],
            stagedProviderSnapshots: providers,
          },
          () => undefined,
        ),
      ),
    ).rejects.toThrow('error.workspace-tabs-target-invalid')
    expect(repository.load).not.toHaveBeenCalled()
    expect(aggregate.activeEpochs(scope.repoRoot)).toEqual([])
  })

  test('uses one monotonic clock across durable, target, overlay, and provider dependencies', async () => {
    const branchTarget = branchProjection('main')
    const repository = memoryRepository({ entries: [{ target: { kind: 'git-branch', branch: 'main' }, tabs: [] }] })
    const aggregate = aggregateFor(repository)
    const validated = await validate(aggregate, {
      ...scope,
      validTargets: [branchTarget],
      physicalTargets: [],
      expectedRepoEntry: { kind: 'local', id: 'goblin+file:///repo' },
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

  test('advances the canonical clock when authoritative target metadata changes', async () => {
    const repository = memoryRepository({
      entries: [
        {
          target: { kind: 'git-worktree', root: worktreeRoot },
          tabs: [],
        },
      ],
    })
    const aggregate = aggregateFor(repository)
    const oldTarget = worktreeProjection('feature/old')
    const currentTarget = worktreeProjection('feature/current')

    const first = await readSnapshot(aggregate, scope, [oldTarget], [])
    const current = await readSnapshot(aggregate, scope, [currentTarget], [])

    expect(first).toMatchObject({ revision: 0, entries: [{ target: { kind: 'git-worktree' } }] })
    expect(current).toMatchObject({ revision: 1, entries: [{ target: { kind: 'git-worktree' } }] })
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
      validTargets: [branchProjection('main')],
      physicalTargets: [],
      expectedRepoEntry: { kind: 'local', id: 'goblin+file:///repo' },
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
        const current = await repository.load(input.repoRoot)
        return { kind: 'accepted' as const, snapshot: current }
      },
    }
    const aggregate = aggregateFor(repository, restoreTransaction)

    await validate(aggregate, {
      ...scope,
      validTargets: [branchProjection('main')],
      physicalTargets: [],
      expectedRepoEntry: { kind: 'local', id: 'goblin+file:///repo' },
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
      validTargets: [branchProjection('main')],
      physicalTargets: [],
      expectedRepoEntry: { kind: 'local', id: 'goblin+file:///repo' },
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
      validTargets: [],
      physicalTargets: [],
      expectedRepoEntry: { kind: 'local', id: 'goblin+file:///repo' },
      providerSnapshots: [],
    })

    await expect(
      update(aggregate, {
        ...scope,
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
      validTargets: [],
      physicalTargets: [],
      expectedRepoEntry: { kind: 'local', id: 'goblin+file:///repo' },
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
      validTargets: [],
      physicalTargets: [],
      expectedRepoEntry: { kind: 'local', id: 'goblin+file:///repo' },
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
        validTargets: [worktreeProjection(target.branchName)],
        physicalTargets: [],
        expectedRepoEntry: { kind: 'local', id: 'goblin+file:///repo' },
        providerSnapshots: [],
      }),
    ).resolves.toEqual({ kind: 'membership-conflict' })
    expect(aggregate.activeEpochs('/repo')).toEqual([])
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
        validTargets: [branchProjection('main')],
        physicalTargets: [],
        expectedRepoEntry: { kind: 'local', id: 'goblin+file:///repo' },
        providerSnapshots: [],
        assertCurrent: () => {
          if (!current) throw new Error('error.workspace-runtime-stale')
        },
      }),
    ).rejects.toThrow('error.workspace-runtime-stale')
    expect(aggregate.activeEpochs('/repo')).toEqual([])
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
        validTargets: [],
        physicalTargets: [],
        expectedRepoEntry: { kind: 'local', id: 'goblin+file:///repo' },
        providerSnapshots: [],
      }),
    ).rejects.toBe(failure)
    expect(aggregate.activeEpochs('/repo')).toEqual([])
  })

  test('uses current provider branch metadata for a live worktree target', async () => {
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
      validTargets: [worktreeProjection('old-branch')],
      physicalTargets: [],
      expectedRepoEntry: { kind: 'local', id: 'goblin+file:///repo' },
      providerSnapshots: [
        {
          type: 'terminal',
          revision: 1,
          liveSessions: [
            {
              sessionId: 'term-currentcurrentcurrent1',
              target: worktreeProjection('current-branch').target,
              branch: 'current-branch',
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
      validTargets: [worktreeProjection('feature/current')],
      physicalTargets: [],
      expectedRepoEntry: { kind: 'local', id: 'goblin+file:///repo' },
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
      target: mainTarget.target,
      nativeWorktreePath: null,
      operation: { type: 'open-static', tabType: 'history' },
      validTargets: [mainTarget],
      providerSnapshots: [],
    })

    expect(result).toEqual({ affectedUserIds: ['user-a'] })
  })
})

interface MemoryRepository extends WorkspacePaneLayoutRepository {
  layout: WorkspacePaneDurableLayout
  compareAndSwap(input: WorkspacePaneLayoutRepositoryCasInput): Promise<WorkspacePaneLayoutRepositoryCasOutcome>
}

function memoryRepository(initial: WorkspacePaneDurableLayout = { entries: [] }): MemoryRepository {
  let layout = initial
  const repository: MemoryRepository = {
    get layout() {
      return layout
    },
    set layout(value) {
      layout = value
    },
    async load() {
      return { layout: structuredClone(layout) }
    },
    async compareAndSwap(input) {
      if (JSON.stringify(layout) !== JSON.stringify(input.expected)) {
        return { kind: 'conflict', snapshot: { layout: structuredClone(layout) } }
      }
      const changed = JSON.stringify(layout) !== JSON.stringify(input.replacement)
      layout = structuredClone(input.replacement)
      return { kind: 'accepted', changed, snapshot: { layout: structuredClone(layout) } }
    },
  }
  return repository
}

function aggregateFor(
  repository: WorkspacePaneLayoutRepository,
  restoreTransaction: WorkspacePaneLayoutRestoreTransaction = {
    async validateMembershipAndLoad(input) {
      const current = await repository.load(input.repoRoot)
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
    validTargets,
    physicalTargets: [],
    expectedRepoEntry: { kind: 'local', id: 'goblin+file:///repo' },
    providerSnapshots: [],
  })
  if (result.kind !== 'validated') throw new Error('test target validation failed')
}

async function replace(aggregate: WorkspacePaneLayoutAggregate, input: WorkspacePaneLayoutReplaceInput) {
  return await aggregate.runExclusive(input.repoRoot, async (operation) => await operation.replace(input))
}

async function update(aggregate: WorkspacePaneLayoutAggregate, input: WorkspacePaneLayoutUpdateInput) {
  return await aggregate.runExclusive(input.repoRoot, async (operation) => await operation.update(input))
}

async function readSnapshot(
  aggregate: WorkspacePaneLayoutAggregate,
  snapshotScope: typeof scope,
  validTargets: WorkspacePaneLayoutValidationInput['validTargets'],
  providerSnapshots: WorkspacePaneLayoutValidationInput['providerSnapshots'],
) {
  return await aggregate.runExclusive(
    snapshotScope.repoRoot,
    async (operation) =>
      await operation.snapshot({
        scope: snapshotScope,
        validTargets,
        providerSnapshots,
      }),
  )
}

async function validate(aggregate: WorkspacePaneLayoutAggregate, input: WorkspacePaneLayoutValidationInput) {
  return await aggregate.runExclusive(
    input.repoRoot,
    async (operation) => await operation.validateMembershipAndSnapshot(input),
  )
}
