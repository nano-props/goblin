// @vitest-environment jsdom
import { StrictMode, act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useLazyRepoTree } from '#/web/hooks/useLazyRepoTree.ts'
import type { RepoTreeResult } from '#/shared/api-types.ts'
import { canonicalWorkspaceLocator, workspaceLocatorForPath } from '#/shared/workspace-locator.ts'

const mocks = vi.hoisted(() => ({
  getRepositoryTree: vi.fn(),
}))

vi.mock('#/web/filetree-client.ts', () => ({
  getRepositoryTree: mocks.getRepositoryTree,
}))

const listeners = new Set<(event: unknown) => void>()
const WORKSPACE_RUNTIME_ID = 'repo-runtime-lazy-tree-test'

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
  loadingKeys: ReadonlySet<string>
  errorKeys: ReadonlySet<string>
  loadChildren: (prefix: string) => Promise<void>
  refresh: () => void
}

interface HarnessProps {
  readonly repoId: string
  readonly workspaceRuntimeId?: string
  readonly worktreePath: string
  readonly expandedKeys?: readonly string[]
  readonly onSnapshot: (snapshot: HarnessSnapshot) => void
}

function Harness({
  repoId,
  workspaceRuntimeId = WORKSPACE_RUNTIME_ID,
  worktreePath,
  expandedKeys,
  onSnapshot,
}: HarnessProps) {
  const target = mockExecutionTarget(repoId, workspaceRuntimeId, worktreePath)
  const result = useLazyRepoTree({ target, expandedKeys })
  onSnapshot(result)
  return null
}

function mockExecutionTarget(repoId: string, workspaceRuntimeId: string, worktreePath: string) {
  const workspaceId = canonicalWorkspaceLocator(`goblin+file://${repoId}`)
  const root = workspaceId ? workspaceLocatorForPath(workspaceId, worktreePath) : null
  if (!workspaceId || !root) throw new Error('invalid mock workspace target')
  return { kind: 'git-worktree' as const, workspaceId, workspaceRuntimeId: workspaceRuntimeId, root }
}

let container: HTMLDivElement | null = null
let root: Root | null = null
let lastSnapshot: HarnessSnapshot | null = null
let queryClient: QueryClient

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  mocks.getRepositoryTree.mockReset()
  listeners.clear()
  lastSnapshot = null
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root?.unmount())
  queryClient.clear()
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
    root!.render(
      <QueryClientProvider client={queryClient}>
        <Harness {...props} />
      </QueryClientProvider>,
    )
  })
}

function setProps(props: HarnessProps): Promise<void> {
  return act(async () => {
    root!.render(
      <QueryClientProvider client={queryClient}>
        <Harness {...props} />
      </QueryClientProvider>,
    )
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
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

describe('useLazyRepoTree', () => {
  test('hydrates the initial aggregate from cached root data without an empty-tree flash', async () => {
    const snapshots: HarnessSnapshot[] = []
    queryClient.setQueryData<RepoTreeResult>(
      ['repo-tree-children', 'goblin+file:///repo-a', WORKSPACE_RUNTIME_ID, '/repo-a/main', ''],
      {
        nodes: [
          { id: 'README.md', path: 'README.md', name: 'README.md', parentId: null, kind: 'file', status: 'clean' },
        ],
        truncated: false,
      },
    )
    mocks.getRepositoryTree.mockResolvedValue({ nodes: [], truncated: false })

    await render({
      repoId: '/repo-a',
      worktreePath: '/repo-a/main',
      onSnapshot: (snapshot) => {
        snapshots.push(snapshot)
        lastSnapshot = snapshot
      },
    })

    expect(snapshots[0]?.tree?.nodes.map((node) => node.id)).toEqual(['README.md'])
  })

  test('hydrates cached restored children and ancestors into the initial aggregate', async () => {
    const snapshots: HarnessSnapshot[] = []
    queryClient.setQueryData<RepoTreeResult>(
      ['repo-tree-children', 'goblin+file:///repo-a', WORKSPACE_RUNTIME_ID, '/repo-a/main', ''],
      {
        nodes: [{ id: 'src', path: 'src', name: 'src', parentId: null, kind: 'directory', status: 'clean' }],
        truncated: false,
      },
    )
    queryClient.setQueryData<RepoTreeResult>(
      ['repo-tree-children', 'goblin+file:///repo-a', WORKSPACE_RUNTIME_ID, '/repo-a/main', 'src'],
      {
        nodes: [{ id: 'src/web', path: 'src/web', name: 'web', parentId: 'src', kind: 'directory', status: 'clean' }],
        truncated: false,
      },
    )
    queryClient.setQueryData<RepoTreeResult>(
      ['repo-tree-children', 'goblin+file:///repo-a', WORKSPACE_RUNTIME_ID, '/repo-a/main', 'src/web'],
      {
        nodes: [
          {
            id: 'src/web/FiletreeView.tsx',
            path: 'src/web/FiletreeView.tsx',
            name: 'FiletreeView.tsx',
            parentId: 'src/web',
            kind: 'file',
            status: 'clean',
          },
        ],
        truncated: false,
      },
    )
    mocks.getRepositoryTree.mockResolvedValue({ nodes: [], truncated: false })

    await render({
      repoId: '/repo-a',
      worktreePath: '/repo-a/main',
      expandedKeys: ['src/web'],
      onSnapshot: (snapshot) => {
        snapshots.push(snapshot)
        lastSnapshot = snapshot
      },
    })

    expect(snapshots[0]?.tree?.nodes.map((node) => node.id).sort()).toEqual([
      'src',
      'src/web',
      'src/web/FiletreeView.tsx',
    ])
  })

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
      mockExecutionTarget('/repo-a', WORKSPACE_RUNTIME_ID, '/repo-a/main'),
      {},
    )
    expect(lastSnapshot?.loading).toBe(true)
    expect(lastSnapshot?.error).toBeNull()
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
  })

  test('applies the latest result after StrictMode re-runs mount effects', async () => {
    const result: RepoTreeResult = {
      nodes: [{ id: 'README.md', path: 'README.md', name: 'README.md', parentId: null, kind: 'file', status: 'clean' }],
      truncated: false,
    }
    mocks.getRepositoryTree.mockResolvedValue(result)

    await act(async () => {
      root!.render(
        <QueryClientProvider client={queryClient}>
          <StrictMode>
            <Harness
              repoId="/repo-a"
              worktreePath="/repo-a/main"
              onSnapshot={(snapshot) => {
                lastSnapshot = snapshot
              }}
            />
          </StrictMode>
        </QueryClientProvider>,
      )
    })
    await flush()

    expect(mocks.getRepositoryTree).toHaveBeenCalledOnce()
    expect(lastSnapshot?.tree).toEqual(result)
    expect(lastSnapshot?.loading).toBe(false)
  })

  test('treats an authoritative empty tree as success', async () => {
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

  test('starts the new target read without letting the previous cache read clobber it', async () => {
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

    await setProps({
      repoId: '/repo-a',
      worktreePath: '/repo-a/feature',
      onSnapshot: (snapshot) => {
        lastSnapshot = snapshot
      },
    })

    expect(mocks.getRepositoryTree).toHaveBeenCalledTimes(2)
    expect(mocks.getRepositoryTree.mock.calls[1]?.[0]).toEqual(
      mockExecutionTarget('/repo-a', WORKSPACE_RUNTIME_ID, '/repo-a/feature'),
    )

    // Resolving the first superseded promise must not clobber the
    // hook's state.
    await act(async () => {
      first.resolve({ nodes: [], truncated: false })
      await Promise.resolve()
    })
    expect(lastSnapshot?.tree).toBeNull()

    // Resolving the second promise applies the new state.
    await act(async () => {
      second.resolve({
        nodes: [{ id: 'src', path: 'src', name: 'src', parentId: null, kind: 'directory', status: 'clean' }],
        truncated: false,
      })
    })
    await flush()
    expect(lastSnapshot?.tree?.nodes).toHaveLength(1)
  })

  test('lets the query-owned root read settle after the consumer unmounts', async () => {
    const deferred = makeDeferred<RepoTreeResult>()
    mocks.getRepositoryTree.mockReturnValueOnce(deferred.promise)

    await render({
      repoId: '/repo-a',
      worktreePath: '/repo-a/main',
      onSnapshot: (snapshot) => {
        lastSnapshot = snapshot
      },
    })
    act(() => root?.unmount())
    await act(async () => {
      deferred.resolve({ nodes: [], truncated: false })
      await deferred.promise
    })
    expect(mocks.getRepositoryTree).toHaveBeenCalledOnce()
  })

  test('refetches when a repo-snapshot invalidation arrives for the current repo', async () => {
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
        listener({ type: 'repo-query-invalidated', repoId: 'goblin+file:///repo-a', query: 'repo-snapshot' })
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

  test('loads and merges direct children for an expanded directory', async () => {
    mocks.getRepositoryTree
      .mockResolvedValueOnce({
        nodes: [{ id: 'src', path: 'src', name: 'src', parentId: null, kind: 'directory', status: 'clean' }],
        truncated: false,
      })
      .mockResolvedValueOnce({
        nodes: [
          {
            id: 'src/index.ts',
            path: 'src/index.ts',
            name: 'index.ts',
            parentId: 'src',
            kind: 'file',
            status: 'clean',
          },
        ],
        truncated: false,
      })

    await render({
      repoId: '/repo-a',
      worktreePath: '/repo-a/main',
      onSnapshot: (snapshot) => {
        lastSnapshot = snapshot
      },
    })
    await flush()

    await act(async () => {
      await lastSnapshot?.loadChildren('src')
    })
    await flush()

    expect(mocks.getRepositoryTree).toHaveBeenLastCalledWith(
      mockExecutionTarget('/repo-a', WORKSPACE_RUNTIME_ID, '/repo-a/main'),
      expect.objectContaining({ prefix: 'src', signal: expect.any(AbortSignal) }),
    )
    expect(lastSnapshot?.tree?.nodes.map((node) => node.id).sort()).toEqual(['src', 'src/index.ts'])
  })

  test('keeps child loading state when expanded keys hydrate cached prefixes', async () => {
    const child = makeDeferred<RepoTreeResult>()
    mocks.getRepositoryTree
      .mockResolvedValueOnce({
        nodes: [{ id: 'src', path: 'src', name: 'src', parentId: null, kind: 'directory', status: 'clean' }],
        truncated: false,
      })
      .mockReturnValueOnce(child.promise)

    await render({
      repoId: '/repo-a',
      worktreePath: '/repo-a/main',
      onSnapshot: (snapshot) => {
        lastSnapshot = snapshot
      },
    })
    await flush()

    let childLoad: Promise<void> | undefined
    await act(async () => {
      childLoad = lastSnapshot?.loadChildren('src')
      await Promise.resolve()
    })
    expect(lastSnapshot?.loadingKeys.has('src')).toBe(true)

    await setProps({
      repoId: '/repo-a',
      worktreePath: '/repo-a/main',
      expandedKeys: ['src'],
      onSnapshot: (snapshot) => {
        lastSnapshot = snapshot
      },
    })
    await flush()
    expect(lastSnapshot?.loadingKeys.has('src')).toBe(true)

    await act(async () => {
      child.resolve({
        nodes: [
          {
            id: 'src/index.ts',
            path: 'src/index.ts',
            name: 'index.ts',
            parentId: 'src',
            kind: 'file',
            status: 'clean',
          },
        ],
        truncated: false,
      })
      await childLoad
    })
    await flush()
    expect(lastSnapshot?.loadingKeys.has('src')).toBe(false)
    expect(lastSnapshot?.tree?.nodes.map((node) => node.id).sort()).toEqual(['src', 'src/index.ts'])
  })

  test('auto-loads restored expanded directory keys after the root read', async () => {
    mocks.getRepositoryTree
      .mockResolvedValueOnce({
        nodes: [{ id: 'src', path: 'src', name: 'src', parentId: null, kind: 'directory', status: 'clean' }],
        truncated: false,
      })
      .mockResolvedValueOnce({
        nodes: [
          {
            id: 'src/index.ts',
            path: 'src/index.ts',
            name: 'index.ts',
            parentId: 'src',
            kind: 'file',
            status: 'clean',
          },
        ],
        truncated: false,
      })

    await render({
      repoId: '/repo-a',
      worktreePath: '/repo-a/main',
      expandedKeys: ['src'],
      onSnapshot: (snapshot) => {
        lastSnapshot = snapshot
      },
    })
    await flush()

    expect(mocks.getRepositoryTree).toHaveBeenCalledTimes(2)
    expect(mocks.getRepositoryTree.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({ prefix: 'src', signal: expect.any(AbortSignal) }),
    )
    expect(lastSnapshot?.tree?.nodes.map((node) => node.id).sort()).toEqual(['src', 'src/index.ts'])
  })

  test('records restored expanded directory load failures without replacing the root tree error', async () => {
    mocks.getRepositoryTree
      .mockResolvedValueOnce({
        nodes: [{ id: 'src', path: 'src', name: 'src', parentId: null, kind: 'directory', status: 'clean' }],
        truncated: false,
      })
      .mockRejectedValueOnce(new Error('child boom'))

    await render({
      repoId: '/repo-a',
      worktreePath: '/repo-a/main',
      expandedKeys: ['src'],
      onSnapshot: (snapshot) => {
        lastSnapshot = snapshot
      },
    })
    await flush()

    expect(mocks.getRepositoryTree).toHaveBeenCalledTimes(2)
    expect(lastSnapshot?.error).toBeNull()
    expect(lastSnapshot?.errorKeys.has('src')).toBe(true)
    expect(lastSnapshot?.loadingKeys.has('src')).toBe(false)
    expect(lastSnapshot?.tree?.nodes.map((node) => node.id)).toEqual(['src'])
  })

  test('invalidating after a successful read refreshes the cached tree', async () => {
    mocks.getRepositoryTree
      .mockResolvedValueOnce({
        nodes: [{ id: 'first.ts', path: 'first.ts', name: 'first.ts', parentId: null, kind: 'file', status: 'clean' }],
        truncated: false,
      })
      .mockResolvedValueOnce({
        nodes: [
          { id: 'second.ts', path: 'second.ts', name: 'second.ts', parentId: null, kind: 'file', status: 'clean' },
        ],
        truncated: false,
      })

    await render({
      repoId: '/repo-a',
      worktreePath: '/repo-a/main',
      onSnapshot: (snapshot) => {
        lastSnapshot = snapshot
      },
    })
    await flush()
    expect(lastSnapshot?.loading).toBe(false)
    expect(lastSnapshot?.tree?.nodes[0]?.id).toBe('first.ts')

    await act(async () => {
      for (const listener of listeners) {
        listener({ type: 'repo-query-invalidated', repoId: 'goblin+file:///repo-a', query: 'repo-snapshot' })
      }
    })
    await flush()

    expect(mocks.getRepositoryTree).toHaveBeenCalledTimes(2)
    expect(lastSnapshot?.loading).toBe(false)
    expect(lastSnapshot?.tree?.nodes[0]?.id).toBe('second.ts')
  })

  test('invalidating keeps the current tree visible and reloads restored expanded children', async () => {
    mocks.getRepositoryTree
      .mockResolvedValueOnce({
        nodes: [{ id: 'src', path: 'src', name: 'src', parentId: null, kind: 'directory', status: 'clean' }],
        truncated: false,
      })
      .mockResolvedValueOnce({
        nodes: [
          { id: 'src/old.ts', path: 'src/old.ts', name: 'old.ts', parentId: 'src', kind: 'file', status: 'clean' },
        ],
        truncated: false,
      })
      .mockResolvedValueOnce({
        nodes: [{ id: 'src', path: 'src', name: 'src', parentId: null, kind: 'directory', status: 'clean' }],
        truncated: false,
      })
      .mockResolvedValueOnce({
        nodes: [
          { id: 'src/new.ts', path: 'src/new.ts', name: 'new.ts', parentId: 'src', kind: 'file', status: 'clean' },
        ],
        truncated: false,
      })

    await render({
      repoId: '/repo-a',
      worktreePath: '/repo-a/main',
      expandedKeys: ['src'],
      onSnapshot: (snapshot) => {
        lastSnapshot = snapshot
      },
    })
    await flush()
    expect(lastSnapshot?.tree?.nodes.map((node) => node.id).sort()).toEqual(['src', 'src/old.ts'])

    await act(async () => {
      for (const listener of listeners) {
        listener({ type: 'repo-query-invalidated', repoId: 'goblin+file:///repo-a', query: 'repo-snapshot' })
      }
      expect(lastSnapshot?.tree?.nodes.map((node) => node.id).sort()).toEqual(['src', 'src/old.ts'])
    })
    await flush()

    expect(mocks.getRepositoryTree).toHaveBeenCalledTimes(4)
    expect(lastSnapshot?.tree?.nodes.map((node) => node.id).sort()).toEqual(['src', 'src/new.ts'])
  })

  test('manual refresh() while a request is in flight reuses the in-flight query', async () => {
    const first = makeDeferred<RepoTreeResult>()
    mocks.getRepositoryTree.mockReturnValueOnce(first.promise)

    await render({
      repoId: '/repo-a',
      worktreePath: '/repo-a/main',
      onSnapshot: (snapshot) => {
        lastSnapshot = snapshot
      },
    })

    await act(async () => {
      lastSnapshot?.refresh()
      await Promise.resolve()
    })

    expect(mocks.getRepositoryTree).toHaveBeenCalledTimes(1)

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
    })
    await flush()
    expect(lastSnapshot?.tree?.nodes[0]?.id).toBe('first.ts')
  })
})
