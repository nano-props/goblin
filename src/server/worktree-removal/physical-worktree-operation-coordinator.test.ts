import { describe, expect, test } from 'vitest'
import { createPhysicalWorktreeOperationCoordinator } from '#/server/worktree-removal/physical-worktree-operation-coordinator.ts'
import {
  issueTestPhysicalWorktreeExecutionCapability,
  testPhysicalWorktreeIdentity,
} from '#/server/test-utils/physical-worktree-identity.ts'
import { physicalWorktreeAdmissionLease } from '#/server/worktree-removal/physical-worktree-capability.ts'

describe('physical worktree operation coordinator', () => {
  test('admits one queue for multiple captures of the same stable identity', async () => {
    const identity = testPhysicalWorktreeIdentity('/repo/worktree')
    const oldCapability = issueTestPhysicalWorktreeExecutionCapability({
      identity,
    })
    const currentCapability = issueTestPhysicalWorktreeExecutionCapability({
      identity,
    })
    const coordinator = createPhysicalWorktreeOperationCoordinator()
    let executions = 0

    await expect(
      coordinator.runAdmissionBatch(
        [
          {
            identity,
            currentCapability,
            indexedLeases: [physicalWorktreeAdmissionLease(oldCapability)],
          },
        ],
        async () => {
          executions += 1
          return 'ok'
        },
      ),
    ).resolves.toEqual({ admitted: true, value: 'ok' })
    expect(executions).toBe(1)
  })

  test('reserves every batch identity against removal before waiting for queues', async () => {
    const held = issueTestPhysicalWorktreeExecutionCapability({ identity: testPhysicalWorktreeIdentity('/repo/a') })
    const second = issueTestPhysicalWorktreeExecutionCapability({ identity: testPhysicalWorktreeIdentity('/repo/b') })
    const coordinator = createPhysicalWorktreeOperationCoordinator()
    const gate = Promise.withResolvers<void>()
    const activeStarted = Promise.withResolvers<void>()
    const active = coordinator.runOperation(held, async () => {
      activeStarted.resolve()
      await gate.promise
    })
    await activeStarted.promise
    const batch = coordinator.runAdmissionBatch(
      [
        { identity: held.identity, currentCapability: held, indexedLeases: [] },
        { identity: second.identity, currentCapability: second, indexedLeases: [] },
      ],
      async () => 'batch',
    )

    await expect(coordinator.runRemoval(second, async () => 'removed')).resolves.toEqual({ admitted: false })
    gate.resolve()
    await active
    await expect(batch).resolves.toEqual({ admitted: true, value: 'batch' })
  })

  test('rejects duplicate stable identity records instead of choosing a capability by order', async () => {
    const identity = testPhysicalWorktreeIdentity('/repo/worktree')
    const capability = issueTestPhysicalWorktreeExecutionCapability({ identity })
    const coordinator = createPhysicalWorktreeOperationCoordinator()
    const record = { identity, currentCapability: capability, indexedLeases: [] }

    await expect(coordinator.runAdmissionBatch([record, record], async () => undefined)).rejects.toThrow(
      'error.duplicate-worktree-admission-record',
    )
  })

  test('rejects an empty record before reserving its identity', async () => {
    const identity = testPhysicalWorktreeIdentity('/repo/worktree')
    const coordinator = createPhysicalWorktreeOperationCoordinator()
    await expect(
      coordinator.runAdmissionBatch(
        [
          {
            identity,
            currentCapability: null,
            indexedLeases: [],
          },
        ],
        async () => undefined,
      ),
    ).rejects.toThrow('error.invalid-worktree-admission-record')
    const capability = issueTestPhysicalWorktreeExecutionCapability({ identity })
    await expect(coordinator.runRemoval(capability, async () => 'removed')).resolves.toMatchObject({ admitted: true })
  })

  test('uses a live indexed lease when another capture is already aborted', async () => {
    const identity = testPhysicalWorktreeIdentity('/repo/worktree')
    const aborted = new AbortController()
    aborted.abort()
    const old = issueTestPhysicalWorktreeExecutionCapability({ identity, runtimeSignal: aborted.signal })
    const live = issueTestPhysicalWorktreeExecutionCapability({ identity })
    const coordinator = createPhysicalWorktreeOperationCoordinator()

    await expect(
      coordinator.runAdmissionBatch(
        [
          {
            identity,
            currentCapability: null,
            indexedLeases: [physicalWorktreeAdmissionLease(old), physicalWorktreeAdmissionLease(live)],
          },
        ],
        async () => 'ok',
      ),
    ).resolves.toEqual({ admitted: true, value: 'ok' })
  })

  test('does not execute the batch task after an outer lease aborts while waiting', async () => {
    const signalA = new AbortController()
    const a = issueTestPhysicalWorktreeExecutionCapability({
      identity: testPhysicalWorktreeIdentity('/repo/a'),
      runtimeSignal: signalA.signal,
    })
    const b = issueTestPhysicalWorktreeExecutionCapability({ identity: testPhysicalWorktreeIdentity('/repo/b') })
    const coordinator = createPhysicalWorktreeOperationCoordinator()
    const gate = Promise.withResolvers<void>()
    const heldStarted = Promise.withResolvers<void>()
    const held = coordinator.runOperation(b, async () => {
      heldStarted.resolve()
      await gate.promise
    })
    await heldStarted.promise
    let ran = false
    const batch = coordinator.runAdmissionBatch(
      [
        { identity: a.identity, currentCapability: a, indexedLeases: [] },
        { identity: b.identity, currentCapability: b, indexedLeases: [] },
      ],
      async () => {
        ran = true
      },
    )
    await expect(coordinator.runRemoval(a, async () => 'removed')).resolves.toEqual({ admitted: false })
    signalA.abort()
    gate.resolve()
    await expect(batch).rejects.toBeDefined()
    expect(ran).toBe(false)
    await held
    const replacement = issueTestPhysicalWorktreeExecutionCapability({ identity: a.identity })
    await expect(coordinator.runRemoval(replacement, async () => 'removed')).resolves.toMatchObject({ admitted: true })
  })

  test('runtime close cancels a queued operation without running it', async () => {
    const identity = testPhysicalWorktreeIdentity('/repo/worktree')
    const held = issueTestPhysicalWorktreeExecutionCapability({ identity })
    const runtime = new AbortController()
    const queued = issueTestPhysicalWorktreeExecutionCapability({ identity, runtimeSignal: runtime.signal })
    const coordinator = createPhysicalWorktreeOperationCoordinator()
    const gate = Promise.withResolvers<void>()
    const active = coordinator.runOperation(held, async () => await gate.promise)
    await Promise.resolve()
    let ran = false
    const operation = coordinator.runOperation(queued, async () => {
      ran = true
    })

    runtime.abort(new Error('error.workspace-runtime-stale'))
    await expect(operation).rejects.toThrow('error.workspace-runtime-stale')
    expect(ran).toBe(false)
    gate.resolve()
    await active
  })

  test('runtime close cancels a queued removal without running it', async () => {
    const identity = testPhysicalWorktreeIdentity('/repo/worktree')
    const held = issueTestPhysicalWorktreeExecutionCapability({ identity })
    const runtime = new AbortController()
    const removalCapability = issueTestPhysicalWorktreeExecutionCapability({
      identity,
      runtimeSignal: runtime.signal,
    })
    const coordinator = createPhysicalWorktreeOperationCoordinator()
    const gate = Promise.withResolvers<void>()
    const active = coordinator.runOperation(held, async () => await gate.promise)
    await Promise.resolve()
    let ran = false
    const removal = coordinator.runRemoval(removalCapability, async () => {
      ran = true
    })

    runtime.abort(new Error('error.workspace-runtime-stale'))
    await expect(removal).rejects.toThrow('error.workspace-runtime-stale')
    expect(ran).toBe(false)
    gate.resolve()
    await active
  })
})
