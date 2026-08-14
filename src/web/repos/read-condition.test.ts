import { describe, expect, test, vi } from 'vitest'
import { REPO_MEMBERSHIP_READ_CONFLICT_KEY } from '#/shared/repo-membership-read.ts'
import { combineRepoReadFailures } from '#/web/repos/read-condition.ts'

describe('combineRepoReadFailures', () => {
  test('returns no condition without failures', () => {
    expect(combineRepoReadFailures([])).toBeNull()
  })

  test('preserves a shared message and generalizes distinct messages', () => {
    expect(
      combineRepoReadFailures([
        { message: 'snapshot failed', stale: true, retrying: false },
        { message: 'snapshot failed', stale: true, retrying: false },
      ]),
    ).toEqual({
      kind: 'stale',
      message: 'snapshot failed',
      retrying: false,
      retry: undefined,
    })
    expect(
      combineRepoReadFailures([
        { message: 'snapshot failed', stale: true, retrying: false },
        { message: 'status failed', stale: true, retrying: false },
      ]),
    ).toEqual({
      kind: 'stale',
      message: 'error.failed-read-repo',
      retrying: false,
      retry: undefined,
    })
  })

  test('classifies membership changes only when every failure shares that message', () => {
    expect(
      combineRepoReadFailures([
        { message: REPO_MEMBERSHIP_READ_CONFLICT_KEY, stale: true, retrying: false },
        { message: REPO_MEMBERSHIP_READ_CONFLICT_KEY, stale: false, retrying: false },
      ])?.kind,
    ).toBe('membership-changing')
    expect(
      combineRepoReadFailures([
        { message: REPO_MEMBERSHIP_READ_CONFLICT_KEY, stale: true, retrying: false },
        { message: 'status failed', stale: true, retrying: false },
      ]),
    ).toEqual({
      kind: 'stale',
      message: 'error.failed-read-repo',
      retrying: false,
      retry: undefined,
    })
  })

  test('classifies only an entirely stale failure set as stale', () => {
    expect(
      combineRepoReadFailures([
        { message: 'snapshot failed', stale: true, retrying: false },
        { message: 'status failed', stale: false, retrying: false },
      ])?.kind,
    ).toBe('unavailable')
  })

  test('retries idle sources and reports retrying only when every retryable source is busy', () => {
    const retryFetchingSource = vi.fn()
    const retryIdleSource = vi.fn()
    const condition = combineRepoReadFailures([
      {
        message: 'snapshot failed',
        stale: true,
        retrying: true,
        retry: retryFetchingSource,
      },
      {
        message: 'status failed',
        stale: true,
        retrying: false,
        retry: retryIdleSource,
      },
    ])

    expect(condition?.retrying).toBe(false)
    condition?.retry?.()
    expect(retryFetchingSource).not.toHaveBeenCalled()
    expect(retryIdleSource).toHaveBeenCalledOnce()

    const retryingCondition = combineRepoReadFailures([
      {
        message: 'snapshot failed',
        stale: true,
        retrying: true,
        retry: retryFetchingSource,
      },
      {
        message: 'status failed',
        stale: true,
        retrying: true,
        retry: retryIdleSource,
      },
    ])
    expect(retryingCondition?.retrying).toBe(true)
  })
})
