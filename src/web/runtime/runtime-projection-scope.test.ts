import { afterEach, describe, expect, test, vi } from 'vitest'
import { createRuntimeProjectionScopeRegistry, RuntimeProjectionScope } from '#/web/runtime/runtime-projection-scope.ts'
import { canonicalWorkspaceLocator } from '#/shared/workspace-locator.ts'

const WORKSPACE_ID = canonicalWorkspaceLocator('goblin+file:///workspace')
const SECOND_WORKSPACE_ID = canonicalWorkspaceLocator('goblin+file:///workspace-2')
if (!WORKSPACE_ID || !SECOND_WORKSPACE_ID) throw new Error('invalid workspace locator fixture')
const TARGET = { workspaceId: WORKSPACE_ID, workspaceRuntimeId: 'repo-runtime-1' }

describe('RuntimeProjectionScope', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  test('coalesces overlapping lane invalidations into one follow-up operation', async () => {
    const first = Promise.withResolvers<string>()
    const second = Promise.withResolvers<string>()
    const publish = vi.fn()
    const reject = vi.fn()
    const scope = new RuntimeProjectionScope(TARGET, () => true)

    const runFirst = vi.fn(async () => await first.promise)
    const runSecond = vi.fn(async () => await second.promise)
    scope.runLatest('recovery', runFirst, publish, reject)
    scope.runLatest('recovery', runSecond, publish, reject)
    second.resolve('new')
    await Promise.resolve()
    await Promise.resolve()
    expect(runFirst).toHaveBeenCalledOnce()
    expect(runSecond).not.toHaveBeenCalled()
    expect(publish).not.toHaveBeenCalled()

    first.resolve('old')
    await vi.waitFor(() => expect(publish).toHaveBeenCalledOnce())

    expect(runSecond).toHaveBeenCalledOnce()
    expect(publish).toHaveBeenCalledWith('new')
    expect(reject).not.toHaveBeenCalled()
  })

  test('dispose aborts operations, cancels timers, releases subscriptions, and blocks late results', async () => {
    vi.useFakeTimers()
    const deferred = Promise.withResolvers<string>()
    const publish = vi.fn()
    const reject = vi.fn()
    const timer = vi.fn()
    const unsubscribe = vi.fn()
    const scope = new RuntimeProjectionScope(TARGET, () => true)
    let taskSignal: AbortSignal | null = null
    scope.track(unsubscribe)
    scope.setTimer('refresh', timer, 10)
    scope.runLatest(
      'recovery',
      async (signal) => {
        taskSignal = signal
        return await deferred.promise
      },
      publish,
      reject,
    )

    scope.dispose()
    deferred.resolve('late')
    await vi.runAllTimersAsync()
    await Promise.resolve()

    expect((taskSignal as AbortSignal | null)?.aborted).toBe(true)
    expect(unsubscribe).toHaveBeenCalledOnce()
    expect(timer).not.toHaveBeenCalled()
    expect(publish).not.toHaveBeenCalled()
    expect(reject).not.toHaveBeenCalled()
    expect(scope.commit(vi.fn())).toBe(false)
  })

  test('coalesces timers by lane', async () => {
    vi.useFakeTimers()
    const first = vi.fn()
    const second = vi.fn()
    const scope = new RuntimeProjectionScope(TARGET, () => true)

    scope.setTimer('refresh', first, 10)
    scope.setTimer('refresh', second, 10)
    await vi.runAllTimersAsync()

    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledOnce()
  })
})

describe('RuntimeProjectionScopeRegistry', () => {
  test('runtime replacement disposes the old target and suppresses late success and failure', async () => {
    let currentRuntimeId = TARGET.workspaceRuntimeId
    const registry = createRuntimeProjectionScopeRegistry((target) => target.workspaceRuntimeId === currentRuntimeId)
    const oldScope = registry.scopeFor(TARGET)
    const lateSuccess = Promise.withResolvers<string>()
    const lateFailure = Promise.withResolvers<string>()
    const publish = vi.fn()
    const reject = vi.fn()
    oldScope.runLatest('success', async () => await lateSuccess.promise, publish, reject)
    oldScope.runLatest('failure', async () => await lateFailure.promise, publish, reject)

    currentRuntimeId = 'repo-runtime-2'
    const replacement = registry.scopeFor({ workspaceId: TARGET.workspaceId, workspaceRuntimeId: currentRuntimeId })
    lateSuccess.resolve('stale')
    lateFailure.reject(new Error('stale failure'))
    await Promise.resolve()
    await Promise.resolve()

    expect(oldScope.isActive()).toBe(false)
    expect(publish).not.toHaveBeenCalled()
    expect(reject).not.toHaveBeenCalled()
    expect(replacement.isActive()).toBe(true)
    registry.dispose()
  })

  test('registry disposal releases provider subscriptions and every child scope', () => {
    const unsubscribe = vi.fn()
    const registry = createRuntimeProjectionScopeRegistry(() => true)
    const first = registry.scopeFor(TARGET)
    const second = registry.scopeFor({ workspaceId: SECOND_WORKSPACE_ID, workspaceRuntimeId: 'repo-runtime-2' })
    registry.track(unsubscribe)

    registry.dispose()

    expect(unsubscribe).toHaveBeenCalledOnce()
    expect(first.isActive()).toBe(false)
    expect(second.isActive()).toBe(false)
  })
})
