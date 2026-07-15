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
import { workspacePaneTabsTargetIdentityKey } from '#/shared/workspace-pane-tabs-target.ts'
import { testPhysicalWorktreeExecutionCapability } from '#/server/test-utils/physical-worktree-identity.ts'
import { physicalWorktreeAdmissionLease } from '#/server/worktree-removal/physical-worktree-identity-resolver.ts'

const scope = { userId: 'user-a', repoRoot: '/repo', repoRuntimeId: 'runtime-a' }
const target = { branchName: 'feature/worktree', worktreePath: '/repo/worktree' }
const terminal = workspacePaneRuntimeTabEntry('terminal', 'term-livelivelivelivelive1')
const providers = [{
  type: 'terminal' as const,
  revision: 1,
  liveSessions: [{ sessionId: 'term-livelivelivelivelive1', branch: target.branchName, worktreePath: target.worktreePath }],
}]

describe('workspace pane layout aggregate', () => {
  test('splits a mixed command into durable static layout and epoch placement', async () => {
    const repository = memoryRepository()
    const aggregate = aggregateFor(repository)

    await replace(aggregate, {
      ...scope,
      ...target,
      tabs: [workspacePaneStaticTabEntry('status'), terminal, workspacePaneStaticTabEntry('history')],
      validTargets: [{ repoRoot: '/repo', ...target }],
      physicalWorktreeLease: physicalWorktreeAdmissionLease(testPhysicalWorktreeExecutionCapability(target.worktreePath)),
      providerSnapshots: providers,
    })
    const snapshot = await readSnapshot(aggregate, scope, [{ repoRoot: '/repo', ...target }], providers)

    expect(repository.layout).toEqual({ entries: [{
      repoRoot: '/repo',
      ...target,
      tabs: [workspacePaneStaticTabEntry('status'), workspacePaneStaticTabEntry('history')],
    }] })
    expect(snapshot.entries[0]?.tabs).toEqual([
      workspacePaneStaticTabEntry('status'),
      terminal,
      workspacePaneStaticTabEntry('history'),
    ])
  })

  test('re-reads and replans the original update intent after a CAS conflict', async () => {
    const repository = memoryRepository({ entries: [{
      repoRoot: '/repo',
      ...target,
      tabs: [workspacePaneStaticTabEntry('status')],
    }] })
    const originalCas = repository.compareAndSwap
    const aggregate = aggregateFor(repository)
    await validateTargets(aggregate, [{ repoRoot: '/repo', ...target }])
    let first = true
    repository.compareAndSwap = vi.fn(async (input) => {
      if (first) {
        first = false
        repository.layout = { entries: [{
          repoRoot: '/repo',
          ...target,
          tabs: [workspacePaneStaticTabEntry('status'), workspacePaneStaticTabEntry('files')],
        }] }
        return { kind: 'conflict' as const, snapshot: { layout: repository.layout } }
      }
      return await originalCas(input)
    })
    await update(aggregate, {
      ...scope,
      ...target,
      operation: { type: 'open-static', tabType: 'history' },
      validTargets: [{ repoRoot: '/repo', ...target }],
      physicalWorktreeLease: physicalWorktreeAdmissionLease(testPhysicalWorktreeExecutionCapability(target.worktreePath)),
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
    const repository = memoryRepository({ entries: [{ repoRoot: '/repo', ...target, tabs: [] }] })
    const aggregate = aggregateFor(repository)
    await validateTargets(aggregate, [{ repoRoot: '/repo', ...target }])
    repository.compareAndSwap = vi.fn(async () => ({
      kind: 'conflict' as const,
      snapshot: { layout: { entries: [] } },
    }))
    await expect(replace(aggregate, {
      ...scope,
      ...target,
      tabs: [workspacePaneStaticTabEntry('history')],
      validTargets: [{ repoRoot: '/repo', ...target }],
      physicalWorktreeLease: physicalWorktreeAdmissionLease(testPhysicalWorktreeExecutionCapability(target.worktreePath)),
      providerSnapshots: [],
    })).rejects.toThrow('error.workspace-tabs-layout-conflict')
    expect(repository.compareAndSwap).toHaveBeenCalledOnce()
  })

  test('commits no overlay or revision when persistence fails', async () => {
    const repository = memoryRepository()
    repository.compareAndSwap = vi.fn(async () => ({
      kind: 'write-failure' as const,
      error: new Error('disk full'),
    }))
    const aggregate = aggregateFor(repository)

    await expect(replace(aggregate, {
      ...scope,
      ...target,
      tabs: [terminal, workspacePaneStaticTabEntry('status')],
      validTargets: [{ repoRoot: '/repo', ...target }],
      physicalWorktreeLease: physicalWorktreeAdmissionLease(testPhysicalWorktreeExecutionCapability(target.worktreePath)),
      providerSnapshots: providers,
    })).rejects.toThrow('disk full')
    await expect(readSnapshot(aggregate, scope, [], providers)).resolves.toMatchObject({
      revision: 0,
      entries: [{ tabs: [workspacePaneStaticTabEntry('status'), terminal] }],
    })
  })

  test('uses one monotonic clock across durable, target, overlay, and provider dependencies', async () => {
    const branchTarget = { repoRoot: '/repo', branchName: 'main', worktreePath: null }
    const repository = memoryRepository({ entries: [{ ...branchTarget, tabs: [] }] })
    const aggregate = aggregateFor(repository)
    const validated = await validate(aggregate, {
      ...scope,
      validTargets: [branchTarget],
      physicalTargets: [],
      expectedRepoEntry: { kind: 'local', id: '/repo' },
      providerSnapshots: [],
    })
    if (validated.kind !== 'validated') throw new Error('unexpected membership conflict')
    const first = validated.snapshot
    const unchanged = await readSnapshot(aggregate, scope, [branchTarget], [])
    repository.layout = { entries: [{ ...branchTarget, tabs: [workspacePaneStaticTabEntry('history')] }] }
    const durable = await readSnapshot(aggregate, scope, [branchTarget], [])
    const provider = await readSnapshot(aggregate, scope, [branchTarget], [{ ...providers[0], liveSessions: [] }])

    expect([first.revision, unchanged.revision, durable.revision, provider.revision]).toEqual([0, 0, 1, 2])
    expect(provider.entries[0]?.tabs.map(workspacePaneTabEntryIdentity)).toEqual([
      workspacePaneTabEntryIdentity(workspacePaneStaticTabEntry('history')),
    ])
  })

  test('advances the canonical clock when authoritative target metadata changes', async () => {
    const repository = memoryRepository({ entries: [{
      repoRoot: '/repo', branchName: 'feature/old', worktreePath: '/repo/worktree', tabs: [],
    }] })
    const aggregate = aggregateFor(repository)
    const oldTarget = { repoRoot: '/repo', branchName: 'feature/old', worktreePath: '/repo/worktree' }
    const currentTarget = { ...oldTarget, branchName: 'feature/current' }

    const first = await readSnapshot(aggregate, scope, [oldTarget], [])
    const current = await readSnapshot(aggregate, scope, [currentTarget], [])

    expect(first).toMatchObject({ revision: 0, entries: [{ branchName: 'feature/old' }] })
    expect(current).toMatchObject({ revision: 1, entries: [{ branchName: 'feature/current' }] })
  })

  test('does not expose unvalidated durable targets in a new epoch', async () => {
    const aggregate = aggregateFor(memoryRepository({ entries: [{
        repoRoot: '/repo', branchName: 'stale', worktreePath: null, tabs: [workspacePaneStaticTabEntry('history')],
      }] }))

    await expect(readSnapshot(aggregate, scope, [], [])).resolves.toMatchObject({ entries: [] })
  })

  test('repairs invalid targets locally while preserving valid siblings', async () => {
    const valid = { repoRoot: '/repo', branchName: 'main', worktreePath: null, tabs: [workspacePaneStaticTabEntry('history')] }
    const invalid = { repoRoot: '/repo', branchName: 'deleted', worktreePath: null, tabs: [workspacePaneStaticTabEntry('status')] }
    const repository = memoryRepository({ entries: [valid, invalid] })
    const aggregate = aggregateFor(repository)

    const result = await validate(aggregate, {
      ...scope,
      validTargets: [{ repoRoot: '/repo', branchName: 'main', worktreePath: null }],
      physicalTargets: [],
      expectedRepoEntry: { kind: 'local', id: '/repo' },
      providerSnapshots: [],
    })

    expect(repository.layout).toEqual({ entries: [valid] })
    expect(result).toMatchObject({
      kind: 'validated',
      snapshot: { entries: [valid] },
    })
  })

  test('repairs multiple invalid targets in one membership-aware transaction', async () => {
    const valid = { repoRoot: '/repo', branchName: 'main', worktreePath: null, tabs: [] }
    const invalidA = { repoRoot: '/repo', branchName: 'deleted-a', worktreePath: null, tabs: [] }
    const invalidB = { repoRoot: '/repo', branchName: 'deleted-b', worktreePath: null, tabs: [] }
    const repository = memoryRepository({ entries: [valid, invalidA, invalidB] })
    const repairs: string[][] = []
    const restoreTransaction: WorkspacePaneLayoutRestoreTransaction = {
      async validateMembershipAndRepair(input) {
        repairs.push([...input.validTargetKeys])
        const current = await repository.load(input.repoRoot)
        const outcome = await repository.compareAndSwap({
          repoRoot: input.repoRoot,
          expected: current.layout,
          replacement: { entries: current.layout.entries.filter((entry) =>
            input.validTargetKeys.includes(workspacePaneTabsTargetIdentityKey(entry))) },
        })
        if (outcome.kind !== 'accepted') throw new Error('test repair transaction failed')
        return outcome
      },
    }
    const aggregate = aggregateFor(repository, restoreTransaction)

    await validate(aggregate, {
      ...scope,
      validTargets: [{ repoRoot: '/repo', branchName: 'main', worktreePath: null }],
      physicalTargets: [],
      expectedRepoEntry: { kind: 'local', id: '/repo' },
      providerSnapshots: [],
    })

    expect(repairs).toHaveLength(1)
    expect(repository.layout).toEqual({ entries: [valid] })
  })

  test('does not report a durable change when restore validation is a no-op', async () => {
    const valid = {
      repoRoot: '/repo',
      branchName: 'main',
      worktreePath: null,
      tabs: [workspacePaneStaticTabEntry('history')],
    }
    const repository = memoryRepository({ entries: [valid] })
    const aggregate = aggregateFor(repository)

    const result = await validate(aggregate, {
      ...scope,
      validTargets: [{ repoRoot: '/repo', branchName: 'main', worktreePath: null }],
      physicalTargets: [],
      expectedRepoEntry: { kind: 'local', id: '/repo' },
      providerSnapshots: [],
    })

    expect(result).toMatchObject({
      kind: 'validated',
      snapshot: { entries: [valid] },
    })
  })

  test('does not let a pane mutation create target validity after restore validation', async () => {
    const repository = memoryRepository()
    const aggregate = aggregateFor(repository)
    await validate(aggregate, {
      ...scope,
      validTargets: [],
      physicalTargets: [],
      expectedRepoEntry: { kind: 'local', id: '/repo' },
      providerSnapshots: [],
    })

    await expect(update(aggregate, {
      ...scope,
      repoRoot: '/repo',
      branchName: 'feature',
      worktreePath: null,
      operation: { type: 'open-static', tabType: 'history' },
      validTargets: [],
      providerSnapshots: [],
    })).rejects.toThrow('error.workspace-tabs-target-invalid')
    expect(repository.layout).toEqual({ entries: [] })
  })

  test('does not let provider membership authorize a durable target mutation', async () => {
    const repository = memoryRepository()
    const aggregate = aggregateFor(repository)

    await expect(update(aggregate, {
      ...scope,
      ...target,
      operation: { type: 'open-static', tabType: 'history' },
      validTargets: [],
      providerSnapshots: providers,
      physicalWorktreeLease: physicalWorktreeAdmissionLease(testPhysicalWorktreeExecutionCapability(target.worktreePath)),
    })).rejects.toThrow('error.workspace-tabs-target-invalid')
  })

  test('suppresses invalid targets when repair persistence fails', async () => {
    const repository = memoryRepository({ entries: [{
      repoRoot: '/repo', branchName: 'deleted', worktreePath: null, tabs: [workspacePaneStaticTabEntry('status')],
    }] })
    repository.compareAndSwap = vi.fn(async () => ({
      kind: 'write-failure' as const,
      error: new Error('disk full'),
    }))
    const aggregate = aggregateFor(repository)

    const result = await validate(aggregate, {
      ...scope,
      validTargets: [],
      physicalTargets: [],
      expectedRepoEntry: { kind: 'local', id: '/repo' },
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
    const repository = memoryRepository({ entries: [{
      repoRoot: '/repo', ...target, tabs: [workspacePaneStaticTabEntry('history')],
    }] })
    repository.compareAndSwap = vi.fn(async () => ({
      kind: 'write-failure' as const,
      error: new Error('disk full'),
    }))
    const aggregate = aggregateFor(repository)

    const result = await validate(aggregate, {
      ...scope,
      validTargets: [],
      physicalTargets: [],
      expectedRepoEntry: { kind: 'local', id: '/repo' },
      providerSnapshots: providers,
    })

    expect(result).toMatchObject({
      kind: 'validated',
      snapshot: {
        entries: [{
          worktreePath: target.worktreePath,
          tabs: [workspacePaneStaticTabEntry('status'), terminal],
        }],
      },
    })
  })

  test('checks membership before committing restore epoch metadata even when no repair is needed', async () => {
    const repository = memoryRepository()
    const aggregate = new WorkspacePaneLayoutAggregate({
      repository,
      restoreTransaction: {
        async validateMembershipAndRepair() {
          return { kind: 'membership-conflict', snapshot: { layout: { entries: [] } } }
        },
      },
    })

    await expect(validate(aggregate, {
      ...scope,
      validTargets: [{ repoRoot: '/repo', ...target }],
      physicalTargets: [],
      expectedRepoEntry: { kind: 'local', id: '/repo' },
      providerSnapshots: [],
    })).resolves.toEqual({ kind: 'membership-conflict' })
    expect(aggregate.activeEpochs('/repo')).toEqual([])
  })

  test('rechecks runtime currentness after the restore transaction before committing epoch state', async () => {
    const repository = memoryRepository()
    let current = true
    const aggregate = aggregateFor(repository, {
      async validateMembershipAndRepair() {
        current = false
        return { kind: 'accepted', changed: false, snapshot: { layout: { entries: [] } } }
      },
    })

    await expect(validate(aggregate, {
      ...scope,
      validTargets: [{ repoRoot: '/repo', branchName: 'main', worktreePath: null }],
      physicalTargets: [],
      expectedRepoEntry: { kind: 'local', id: '/repo' },
      providerSnapshots: [],
      assertCurrent: () => {
        if (!current) throw new Error('error.repo-runtime-stale')
      },
    })).rejects.toThrow('error.repo-runtime-stale')
    expect(aggregate.activeEpochs('/repo')).toEqual([])
  })

  test('does not degrade when restore transaction fails before producing an outcome', async () => {
    const repository = memoryRepository()
    const failure = new Error('settings unavailable')
    const aggregate = aggregateFor(repository, {
      async validateMembershipAndRepair() {
        throw failure
      },
    })

    await expect(validate(aggregate, {
      ...scope,
      validTargets: [],
      physicalTargets: [],
      expectedRepoEntry: { kind: 'local', id: '/repo' },
      providerSnapshots: [],
    })).rejects.toBe(failure)
    expect(aggregate.activeEpochs('/repo')).toEqual([])
  })

  test('uses current provider branch metadata for a live worktree target', async () => {
    const repository = memoryRepository({ entries: [{
      repoRoot: '/repo', branchName: 'old-branch', worktreePath: '/repo/worktree', tabs: [],
    }] })
    const aggregate = aggregateFor(repository)
    const result = await validate(aggregate, {
      ...scope,
      validTargets: [{ repoRoot: '/repo', branchName: 'old-branch', worktreePath: '/repo/worktree' }],
      physicalTargets: [],
      expectedRepoEntry: { kind: 'local', id: '/repo' },
      providerSnapshots: [{
        type: 'terminal',
        revision: 1,
        liveSessions: [{
          sessionId: 'term-currentcurrentcurrent1',
          branch: 'current-branch',
          worktreePath: '/repo/worktree',
        }],
      }],
    })

    expect(result).toMatchObject({
      kind: 'validated',
      snapshot: { entries: [{ branchName: 'current-branch' }] },
    })
  })

  test('uses validated repo projection metadata for a worktree without a live provider', async () => {
    const repository = memoryRepository({ entries: [{
      repoRoot: '/repo', branchName: '', worktreePath: '/repo/worktree', tabs: [workspacePaneStaticTabEntry('history')],
    }] })
    const aggregate = aggregateFor(repository)

    const result = await validate(aggregate, {
      ...scope,
      validTargets: [{ repoRoot: '/repo', branchName: 'feature/current', worktreePath: '/repo/worktree' }],
      physicalTargets: [],
      expectedRepoEntry: { kind: 'local', id: '/repo' },
      providerSnapshots: [],
    })

    expect(result).toMatchObject({
      kind: 'validated',
      snapshot: { entries: [{ branchName: 'feature/current', worktreePath: '/repo/worktree' }] },
    })
  })

  test('returns every active user affected by a durable layout commit', async () => {
    const aggregate = aggregateFor(memoryRepository({ entries: [{
      repoRoot: '/repo', branchName: 'main', worktreePath: null, tabs: [workspacePaneStaticTabEntry('status')],
    }] }))
    await validateTargets(aggregate, [{ repoRoot: '/repo', branchName: 'main', worktreePath: null }])
    const mainTarget = { repoRoot: '/repo', branchName: 'main', worktreePath: null }
    await readSnapshot(aggregate, { ...scope, userId: 'user-b', repoRuntimeId: 'runtime-b' }, [mainTarget], [])

    const result = await update(aggregate, {
      ...scope,
      repoRoot: '/repo',
      branchName: 'main',
      worktreePath: null,
      operation: { type: 'open-static', tabType: 'history' },
      validTargets: [mainTarget],
      providerSnapshots: [],
    })

    expect(result).toEqual({ affectedUserIds: ['user-a', 'user-b'] })
  })
})

interface MemoryRepository extends WorkspacePaneLayoutRepository {
  layout: WorkspacePaneDurableLayout
  compareAndSwap(input: WorkspacePaneLayoutRepositoryCasInput): Promise<
    WorkspacePaneLayoutRepositoryCasOutcome
  >
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
    async validateMembershipAndRepair(input) {
      const current = await repository.load(input.repoRoot)
      const outcome = await repository.compareAndSwap({
        repoRoot: input.repoRoot,
        expected: current.layout,
        replacement: { entries: current.layout.entries.filter((entry) =>
          input.validTargetKeys.includes(workspacePaneTabsTargetIdentityKey(entry))) },
      })
      if (outcome.kind === 'write-failure') return { ...outcome, snapshot: current }
      if (outcome.kind !== 'accepted') throw new Error('test repair transaction failed')
      return outcome
    },
  },
): WorkspacePaneLayoutAggregate {
  return new WorkspacePaneLayoutAggregate({ repository, restoreTransaction })
}

async function validateTargets(
  aggregate: WorkspacePaneLayoutAggregate,
  validTargets: readonly { repoRoot: string; branchName: string; worktreePath: string | null }[],
): Promise<void> {
  const result = await validate(aggregate, {
    ...scope,
    validTargets,
    physicalTargets: [],
    expectedRepoEntry: { kind: 'local', id: '/repo' },
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
  return await aggregate.runExclusive(snapshotScope.repoRoot, async (operation) => await operation.snapshot({
    scope: snapshotScope,
    validTargets,
    providerSnapshots,
  }))
}

async function validate(aggregate: WorkspacePaneLayoutAggregate, input: WorkspacePaneLayoutValidationInput) {
  return await aggregate.runExclusive(input.repoRoot, async (operation) =>
    await operation.validateRepairAndSnapshot(input))
}
