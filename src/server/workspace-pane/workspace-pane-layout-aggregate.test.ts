// @vitest-environment node

import { describe, expect, test, vi } from 'vitest'
import { WorkspacePaneLayoutAggregate } from '#/server/workspace-pane/workspace-pane-layout-aggregate.ts'
import type {
  WorkspacePaneLayoutRepository,
  WorkspacePaneLayoutRepositoryCasInput,
} from '#/server/workspace-pane/workspace-pane-layout-repository.ts'
import type { WorkspacePaneDurableLayout } from '#/shared/workspace-pane-tabs.ts'
import {
  workspacePaneRuntimeTabEntry,
  workspacePaneStaticTabEntry,
  workspacePaneTabEntryIdentity,
} from '#/shared/workspace-pane.ts'

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
    const aggregate = new WorkspacePaneLayoutAggregate({ repository })

    const snapshot = await aggregate.replace({
      ...scope,
      ...target,
      tabs: [workspacePaneStaticTabEntry('status'), terminal, workspacePaneStaticTabEntry('history')],
      providerSnapshots: providers,
    })

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
    const aggregate = new WorkspacePaneLayoutAggregate({ repository })

    await aggregate.update({
      ...scope,
      ...target,
      operation: { type: 'open-static', tabType: 'history' },
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
    const repository = memoryRepository()
    repository.compareAndSwap = vi.fn(async () => ({
      kind: 'conflict' as const,
      snapshot: { layout: { entries: [] } },
    }))
    const aggregate = new WorkspacePaneLayoutAggregate({ repository })

    await expect(aggregate.replace({
      ...scope,
      ...target,
      tabs: [workspacePaneStaticTabEntry('history')],
      providerSnapshots: [],
    })).rejects.toThrow('error.workspace-tabs-layout-conflict')
    expect(repository.compareAndSwap).toHaveBeenCalledOnce()
  })

  test('commits no overlay or revision when persistence fails', async () => {
    const repository = memoryRepository()
    repository.compareAndSwap = vi.fn(async () => ({
      kind: 'failure' as const,
      error: new Error('disk full'),
    }))
    const aggregate = new WorkspacePaneLayoutAggregate({ repository })

    await expect(aggregate.replace({
      ...scope,
      ...target,
      tabs: [workspacePaneStaticTabEntry('status'), terminal],
      providerSnapshots: providers,
    })).rejects.toThrow('disk full')
    expect(aggregate.overlay.revision(scope)).toBe(0)
    expect(aggregate.overlay.placementHints({
      ...scope,
      target: { kind: 'worktree', repoRoot: '/repo', worktreePath: target.worktreePath },
    })).toEqual([])
  })

  test('uses one monotonic clock across durable, overlay, and provider dependencies', async () => {
    const repository = memoryRepository()
    const aggregate = new WorkspacePaneLayoutAggregate({ repository })
    const first = await aggregate.snapshot(scope, [])
    const unchanged = await aggregate.snapshot(scope, [])
    repository.layout = { entries: [{ repoRoot: '/repo', ...target, tabs: [] }] }
    const durable = await aggregate.snapshot(scope, [])
    const provider = await aggregate.snapshot(scope, providers)

    expect([first.revision, unchanged.revision, durable.revision, provider.revision]).toEqual([0, 0, 1, 2])
    expect(provider.entries[0]?.tabs.map(workspacePaneTabEntryIdentity)).toEqual([
      workspacePaneTabEntryIdentity(terminal),
    ])
  })

  test('does not let overlay metadata synthesize target membership', async () => {
    const aggregate = new WorkspacePaneLayoutAggregate({ repository: memoryRepository() })
    aggregate.overlay.registerTargetMetadata({
      ...scope,
      target: { kind: 'branch', repoRoot: '/repo', branchName: 'metadata-only' },
      branchName: 'metadata-only',
    })

    await expect(aggregate.snapshot(scope, [])).resolves.toMatchObject({ entries: [] })
  })

  test('repairs invalid targets locally while preserving valid siblings', async () => {
    const valid = { repoRoot: '/repo', branchName: 'main', worktreePath: null, tabs: [workspacePaneStaticTabEntry('history')] }
    const invalid = { repoRoot: '/repo', branchName: 'deleted', worktreePath: null, tabs: [workspacePaneStaticTabEntry('status')] }
    const repository = memoryRepository({ entries: [valid, invalid] })
    const aggregate = new WorkspacePaneLayoutAggregate({ repository })

    const result = await aggregate.validateRepairAndSnapshot({
      ...scope,
      validTargets: [{ repoRoot: '/repo', branchName: 'main', worktreePath: null }],
      expectedRepoEntry: { kind: 'local', id: '/repo' },
      providerSnapshots: [],
    })

    expect(repository.layout).toEqual({ entries: [valid] })
    expect(result).toMatchObject({
      kind: 'validated',
      snapshot: { entries: [valid] },
      durableLayoutChanged: true,
    })
  })

  test('does not report a durable change when restore validation is a no-op', async () => {
    const valid = {
      repoRoot: '/repo',
      branchName: 'main',
      worktreePath: null,
      tabs: [workspacePaneStaticTabEntry('history')],
    }
    const repository = memoryRepository({ entries: [valid] })
    const aggregate = new WorkspacePaneLayoutAggregate({ repository })

    const result = await aggregate.validateRepairAndSnapshot({
      ...scope,
      validTargets: [{ repoRoot: '/repo', branchName: 'main', worktreePath: null }],
      expectedRepoEntry: { kind: 'local', id: '/repo' },
      providerSnapshots: [],
    })

    expect(result).toMatchObject({
      kind: 'validated',
      snapshot: { entries: [valid] },
      durableLayoutChanged: false,
    })
  })

  test('admits a target created by a durable mutation after restore validation', async () => {
    const repository = memoryRepository()
    const aggregate = new WorkspacePaneLayoutAggregate({ repository })
    await aggregate.validateRepairAndSnapshot({
      ...scope,
      validTargets: [],
      expectedRepoEntry: { kind: 'local', id: '/repo' },
      providerSnapshots: [],
    })

    const snapshot = await aggregate.update({
      ...scope,
      repoRoot: '/repo',
      branchName: 'feature',
      worktreePath: null,
      operation: { type: 'open-static', tabType: 'history' },
      providerSnapshots: [],
    })

    expect(snapshot.entries).toEqual([{
      repoRoot: '/repo',
      branchName: 'feature',
      worktreePath: null,
      tabs: [workspacePaneStaticTabEntry('status'), workspacePaneStaticTabEntry('history')],
    }])
  })

  test('suppresses invalid targets when repair persistence fails', async () => {
    const repository = memoryRepository({ entries: [{
      repoRoot: '/repo', branchName: 'deleted', worktreePath: null, tabs: [workspacePaneStaticTabEntry('status')],
    }] })
    repository.compareAndSwap = vi.fn(async () => ({
      kind: 'failure' as const,
      error: new Error('disk full'),
    }))
    const aggregate = new WorkspacePaneLayoutAggregate({ repository })

    const result = await aggregate.validateRepairAndSnapshot({
      ...scope,
      validTargets: [],
      expectedRepoEntry: { kind: 'local', id: '/repo' },
      providerSnapshots: [],
    })

    expect(result).toMatchObject({
      kind: 'validated',
      snapshot: { entries: [] },
      durableLayoutChanged: false,
    })
    expect(repository.layout.entries).toHaveLength(1)
    await expect(aggregate.snapshot(scope, [])).resolves.toMatchObject({ entries: [] })
  })

  test('checks membership before committing restore epoch metadata even when no repair is needed', async () => {
    const repository = memoryRepository()
    repository.compareAndSwap = vi.fn(async () => ({
      kind: 'membership-conflict' as const,
      snapshot: { layout: { entries: [] } },
    }))
    const aggregate = new WorkspacePaneLayoutAggregate({ repository })

    await expect(aggregate.validateRepairAndSnapshot({
      ...scope,
      validTargets: [{ repoRoot: '/repo', ...target }],
      expectedRepoEntry: { kind: 'local', id: '/repo' },
      providerSnapshots: [],
    })).resolves.toEqual({ kind: 'membership-conflict' })
    expect(aggregate.overlay.activeEpochs('/repo')).toEqual([])
    expect(aggregate.overlay.epochTargets(scope)).toEqual([])
  })
})

interface MemoryRepository extends WorkspacePaneLayoutRepository {
  layout: WorkspacePaneDurableLayout
  compareAndSwap(input: WorkspacePaneLayoutRepositoryCasInput): Promise<
    Awaited<ReturnType<WorkspacePaneLayoutRepository['compareAndSwap']>>
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
