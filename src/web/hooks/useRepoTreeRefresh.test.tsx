// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useRepoTreeRefresh } from '#/web/hooks/useRepoTreeRefresh.ts'
import type { RepoTreeResult } from '#/shared/api-types.ts'

const mocks = vi.hoisted(() => ({
  getRepositoryTree: vi.fn(),
}))

vi.mock('#/web/filetree-client.ts', () => ({
  getRepositoryTree: mocks.getRepositoryTree,
}))

const listeners = new Set<(event: unknown) => void>()

vi.mock('#/web/repo-query-invalidation-ingress.ts', () => ({
  subscribeRepoQueryInvalidation(listener: (event: unknown) => void) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
}))

type HarnessSnapshot = {
  tree: RepoTreeResult | null
  loading: boolean
  error: string | null
  stale: boolean
  refresh: () => void
}

interface HarnessProps {
  readonly repoId: string
  readonly worktreePath: string
  readonly onSnapshot: (snapshot: HarnessSnapshot) => void
}

function Harness({ repoId, worktreePath, onSnapshot }: HarnessProps) {
  const result = useRepoTreeRefresh({ repoId, worktreePath })
  onSnapshot(result)
  return null
}

let container: HTMLDivElement | null = null
let root: Root | null = null
let lastSnapshot: HarnessSnapshot | null = null

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  mocks.getRepositoryTree.mockReset()
  listeners.clear()
  lastSnapshot = null
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
  lastSnapshot = null
  listeners.clear()
  mocks.getRepositoryTree.mockReset()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false
})

function render(props: HarnessProps): Promise<void> {
  return act(async () => {
    root!.render(<Harness {...props} />)
  })
}

function setProps(props: HarnessProps): Promise<void> {
  return act(async () => {
    root!.render(<Harness {...props} />)
  })
}

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
}

function makeDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

async function flush() {
  await act(async () => {
    await Promise.resolve()
  })
}

describe('useRepoTreeRefresh', () => {
  test('kicks an initial fetch on mount and exposes loading=true', async () => {
    const deferred = makeDeferred<RepoTreeResult>()
    mocks.getRepositoryTree.mockReturnValueOnce(deferred.promise)

    await render({
      repoId: '/repo-a',
      worktreePath: '/repo-a/main',
      onSnapshot: (snapshot) => {
        lastSnapshot = snapshot
      },
    })

    expect(mocks.getRepositoryTree).toHaveBeenCalledWith(
      '/repo-a',
      '/repo-a/main',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    expect(lastSnapshot?.loading).toBe(true)
    expect(lastSnapshot?.error).toBeNull()
    expect(lastSnapshot?.stale).toBe(false)
  })

  test('resolves to the fetched tree and clears loading on success', async () => {
    const result: RepoTreeResult = {
      nodes: [{ id: 'README.md', path: 'README.md', name: 'README.md', parentId: null, kind: 'file', status: 'clean' }],
      truncated: false,
    }
    mocks.getRepositoryTree.mockResolvedValueOnce(result)

    await render({
      repoId: '/repo-a',
      worktreePath: '/repo-a/main',
      onSnapshot: (snapshot) => {
        lastSnapshot = snapshot
      },
    })
    await flush()

    expect(lastSnapshot?.tree).toEqual(result)
    expect(lastSnapshot?.loading).toBe(false)
    expect(lastSnapshot?.error).toBeNull()
    expect(lastSnapshot?.stale).toBe(false)
  })

  test('treats a soft-fail empty envelope as success (no error, no throw)', async () => {
    mocks.getRepositoryTree.mockResolvedValueOnce({ nodes: [], truncated: false })

    await render({
      repoId: '/repo-a',
      worktreePath: '/repo-a/main',
      onSnapshot: (snapshot) => {
        lastSnapshot = snapshot
      },
    })
    await flush()

    expect(lastSnapshot?.tree).toEqual({ nodes: [], truncated: false })
    expect(lastSnapshot?.error).toBeNull()
    expect(lastSnapshot?.loading).toBe(false)
  })

  test('reports an error when the client rejects with a real failure', async () => {
    mocks.getRepositoryTree.mockRejectedValueOnce(new Error('boom'))

    await render({
      repoId: '/repo-a',
      worktreePath: '/repo-a/main',
      onSnapshot: (snapshot) => {
        lastSnapshot = snapshot
      },
    })
    await flush()

    expect(lastSnapshot?.error).toBe('boom')
    expect(lastSnapshot?.loading).toBe(false)
  })

  test('refetches and aborts the previous request when the worktree path changes', async () => {
    const first = makeDeferred<RepoTreeResult>()
    const second = makeDeferred<RepoTreeResult>()
    mocks.getRepositoryTree.mockReturnValueOnce(first.promise)
    mocks.getRepositoryTree.mockReturnValueOnce(second.promise)

    await render({
      repoId: '/repo-a',
      worktreePath: '/repo-a/main',
      onSnapshot: (snapshot) => {
        lastSnapshot = snapshot
      },
    })

    const firstSignal = mocks.getRepositoryTree.mock.calls[0]?.[2]?.signal as AbortSignal
    expect(firstSignal.aborted).toBe(false)

    await setProps({
      repoId: '/repo-a',
      worktreePath: '/repo-a/feature',
      onSnapshot: (snapshot) => {
        lastSnapshot = snapshot
      },
    })

    // After the input change, the prior controller should be aborted.
    expect(firstSignal.aborted).toBe(true)
    expect(mocks.getRepositoryTree).toHaveBeenCalledTimes(2)
    expect(mocks.getRepositoryTree.mock.calls[1]?.[1]).toBe('/repo-a/feature')

    // Resolving the first (now-stale) promise must not clobber the
    // hook's state.
    await act(async () => {
      first.resolve({ nodes: [], truncated: false })
      await Promise.resolve()
    })
    expect(lastSnapshot?.tree).toBeNull()

    // Resolving the second promise applies the new state.
    await act(async () => {
      second.resolve({
        nodes: [
          { id: 'src', path: 'src', name: 'src', parentId: null, kind: 'directory', status: 'clean' },
        ],
        truncated: false,
      })
      await Promise.resolve()
    })
    expect(lastSnapshot?.tree?.nodes).toHaveLength(1)
  })

  test('aborts the in-flight request when the consumer unmounts', async () => {
    const deferred = makeDeferred<RepoTreeResult>()
    mocks.getRepositoryTree.mockReturnValueOnce(deferred.promise)

    await render({
      repoId: '/repo-a',
      worktreePath: '/repo-a/main',
      onSnapshot: (snapshot) => {
        lastSnapshot = snapshot
      },
    })
    const signal = mocks.getRepositoryTree.mock.calls[0]?.[2]?.signal as AbortSignal

    act(() => root?.unmount())
    expect(signal.aborted).toBe(true)
  })

  test('refetches when a repo-snapshot invalidation arrives for the active repo', async () => {
    mocks.getRepositoryTree.mockResolvedValue({ nodes: [], truncated: false })

    await render({
      repoId: '/repo-a',
      worktreePath: '/repo-a/main',
      onSnapshot: (snapshot) => {
        lastSnapshot = snapshot
      },
    })
    await flush()

    expect(mocks.getRepositoryTree).toHaveBeenCalledTimes(1)

    await act(async () => {
      for (const listener of listeners) {
        listener({ type: 'repo-query-invalidated', repoId: '/repo-a', query: 'repo-snapshot' })
      }
      await Promise.resolve()
    })

    expect(mocks.getRepositoryTree).toHaveBeenCalledTimes(2)
  })

  test('ignores invalidation events for a different repoId', async () => {
    mocks.getRepositoryTree.mockResolvedValue({ nodes: [], truncated: false })

    await render({
      repoId: '/repo-a',
      worktreePath: '/repo-a/main',
      onSnapshot: (snapshot) => {
        lastSnapshot = snapshot
      },
    })
    await flush()

    expect(mocks.getRepositoryTree).toHaveBeenCalledTimes(1)

    await act(async () => {
      for (const listener of listeners) {
        listener({ type: 'repo-query-invalidated', repoId: '/repo-other', query: 'repo-snapshot' })
      }
      await Promise.resolve()
    })

    expect(mocks.getRepositoryTree).toHaveBeenCalledTimes(1)
  })

  test('manual refresh() re-runs the fetch', async () => {
    mocks.getRepositoryTree.mockResolvedValue({ nodes: [], truncated: false })

    await render({
      repoId: '/repo-a',
      worktreePath: '/repo-a/main',
      onSnapshot: (snapshot) => {
        lastSnapshot = snapshot
      },
    })
    await flush()

    expect(mocks.getRepositoryTree).toHaveBeenCalledTimes(1)

    await act(async () => {
      lastSnapshot?.refresh()
      await Promise.resolve()
    })
    expect(mocks.getRepositoryTree).toHaveBeenCalledTimes(2)
  })

  test('marks the tree as stale while a refetch triggered by invalidation is in flight', async () => {
    const first = makeDeferred<RepoTreeResult>()
    const second = makeDeferred<RepoTreeResult>()
    mocks.getRepositoryTree.mockReturnValueOnce(first.promise)
    mocks.getRepositoryTree.mockReturnValueOnce(second.promise)

    await render({
      repoId: '/repo-a',
      worktreePath: '/repo-a/main',
      onSnapshot: (snapshot) => {
        lastSnapshot = snapshot
      },
    })

    await act(async () => {
      first.resolve({
        nodes: [
          { id: 'first.ts', path: 'first.ts', name: 'first.ts', parentId: null, kind: 'file', status: 'clean' },
        ],
        truncated: false,
      })
      await Promise.resolve()
    })
    expect(lastSnapshot?.stale).toBe(false)

    await act(async () => {
      for (const listener of listeners) {
        listener({ type: 'repo-query-invalidated', repoId: '/repo-a', query: 'repo-snapshot' })
      }
      // The invalidation handler enqueues a fresh fetch but does
      // not await the promise -- we need a microtask flush to
      // observe the loading=true transition.
      await Promise.resolve()
    })
    // While the second request is pending, the previous tree is
    // visibly stale. (loading flips to true; stale flips to true.)
    expect(lastSnapshot?.stale).toBe(true)
    expect(lastSnapshot?.loading).toBe(true)
    // The first tree is still served -- we do not clear it on
    // invalidation, only mark it stale.
    expect(lastSnapshot?.tree?.nodes[0]?.id).toBe('first.ts')

    await act(async () => {
      second.resolve({ nodes: [], truncated: false })
      await Promise.resolve()
    })
    expect(lastSnapshot?.stale).toBe(false)
    expect(lastSnapshot?.loading).toBe(false)
  })

  test('two rapid invalidations: stale flag resets between fetches and prior request is aborted', async () => {
    // Regression for the stale-flag bleed across worktree switches
    // (and across rapid same-input invalidations). The flag must be
    // cleared at fetch entry, not just on resolution, so the second
    // refetch does not inherit "stale" from the first.
    const first = makeDeferred<RepoTreeResult>()
    const second = makeDeferred<RepoTreeResult>()
    const third = makeDeferred<RepoTreeResult>()
    mocks.getRepositoryTree
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
      .mockReturnValueOnce(third.promise)

    await render({
      repoId: '/repo-a',
      worktreePath: '/repo-a/main',
      onSnapshot: (snapshot) => {
        lastSnapshot = snapshot
      },
    })

    // Resolve the mount fetch to land the hook in a known good state.
    await act(async () => {
      first.resolve({
        nodes: [
          { id: 'first.ts', path: 'first.ts', name: 'first.ts', parentId: null, kind: 'file', status: 'clean' },
        ],
        truncated: false,
      })
      await Promise.resolve()
    })
    expect(lastSnapshot?.stale).toBe(false)
    expect(lastSnapshot?.loading).toBe(false)

    const firstSignal = mocks.getRepositoryTree.mock.calls[0]?.[2]?.signal as AbortSignal

    // First invalidation kicks a refetch; stale should become true
    // until the second fetch resolves.
    await act(async () => {
      for (const listener of listeners) {
        listener({ type: 'repo-query-invalidated', repoId: '/repo-a', query: 'repo-snapshot' })
      }
      await Promise.resolve()
    })
    expect(lastSnapshot?.stale).toBe(true)
    expect(lastSnapshot?.loading).toBe(true)

    const secondSignal = mocks.getRepositoryTree.mock.calls[1]?.[2]?.signal as AbortSignal
    expect(secondSignal).not.toBe(firstSignal)
    expect(secondSignal.aborted).toBe(false)

    // Second invalidation fires while the first refetch is still
    // pending. The hook must abort the in-flight second request and
    // start a third one. Inputs did not change, so the input-change
    // effect does not re-fire — the stale flag, last set true by
    // the first invalidation, stays true until the third fetch
    // resolves.
    await act(async () => {
      for (const listener of listeners) {
        listener({ type: 'repo-query-invalidated', repoId: '/repo-a', query: 'repo-snapshot' })
      }
      await Promise.resolve()
    })

    expect(secondSignal.aborted).toBe(true)
    expect(mocks.getRepositoryTree).toHaveBeenCalledTimes(3)
    expect(lastSnapshot?.loading).toBe(true)
    expect(lastSnapshot?.stale).toBe(true)

    // Resolving the orphaned second request must not clobber state.
    await act(async () => {
      second.resolve({ nodes: [], truncated: false })
      await Promise.resolve()
    })
    expect(lastSnapshot?.loading).toBe(true)

    // Resolving the third request lands the final tree.
    await act(async () => {
      third.resolve({
        nodes: [
          { id: 'third.ts', path: 'third.ts', name: 'third.ts', parentId: null, kind: 'file', status: 'clean' },
        ],
        truncated: false,
      })
      await Promise.resolve()
    })
    expect(lastSnapshot?.stale).toBe(false)
    expect(lastSnapshot?.loading).toBe(false)
    expect(lastSnapshot?.tree?.nodes[0]?.id).toBe('third.ts')
  })

  test('manual refresh() while a request is in flight aborts the prior request', async () => {
    // Regression: refresh() must abort any in-flight request, so the
    // consumer never sees stale data applied on top of a newer one.
    const first = makeDeferred<RepoTreeResult>()
    const second = makeDeferred<RepoTreeResult>()
    mocks.getRepositoryTree.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)

    await render({
      repoId: '/repo-a',
      worktreePath: '/repo-a/main',
      onSnapshot: (snapshot) => {
        lastSnapshot = snapshot
      },
    })

    const firstSignal = mocks.getRepositoryTree.mock.calls[0]?.[2]?.signal as AbortSignal
    expect(firstSignal.aborted).toBe(false)

    await act(async () => {
      lastSnapshot?.refresh()
      await Promise.resolve()
    })

    const secondSignal = mocks.getRepositoryTree.mock.calls[1]?.[2]?.signal as AbortSignal
    expect(firstSignal.aborted).toBe(true)
    expect(secondSignal.aborted).toBe(false)
    expect(mocks.getRepositoryTree).toHaveBeenCalledTimes(2)

    // The orphaned first resolution must not change state.
    await act(async () => {
      first.resolve({
        nodes: [
          {
            id: 'first.ts',
            path: 'first.ts',
            name: 'first.ts',
            parentId: null,
            kind: 'file',
            status: 'clean',
          },
        ],
        truncated: false,
      })
      await Promise.resolve()
    })
    expect(lastSnapshot?.tree).toBeNull()

    await act(async () => {
      second.resolve({ nodes: [], truncated: false })
      await Promise.resolve()
    })
    expect(lastSnapshot?.tree).toEqual({ nodes: [], truncated: false })
  })
})
