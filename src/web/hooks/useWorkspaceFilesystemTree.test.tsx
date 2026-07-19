// @vitest-environment jsdom
import { StrictMode, act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useWorkspaceFilesystemTree } from '#/web/hooks/useWorkspaceFilesystemTree.ts'
import type { WorkspaceFilesystemTreeResult } from '#/shared/api-types.ts'
import { canonicalWorkspaceLocator, workspaceLocatorForPath } from '#/shared/workspace-locator.ts'
import { startWorkspaceFilesystemQueryInvalidationSync } from '#/web/workspace-filesystem-query.ts'

const mocks = vi.hoisted(() => ({
  getWorkspaceFilesystemTree: vi.fn(),
}))

vi.mock('#/web/workspace-filesystem-client.ts', () => ({
  getWorkspaceFilesystemTree: mocks.getWorkspaceFilesystemTree,
}))

const listeners = new Set<(event: unknown) => void>()
const WORKSPACE_RUNTIME_ID = 'repo-runtime-lazy-tree-test'

vi.mock('#/web/workspace-filesystem-invalidation-ingress.ts', () => ({
  subscribeWorkspaceFilesystemInvalidation(listener: (event: unknown) => void) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
}))

type HarnessSnapshot = {
  tree: WorkspaceFilesystemTreeResult | null
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
  readonly targetKind?: 'workspace-root' | 'git-worktree'
  readonly expandedKeys?: readonly string[]
  readonly onSnapshot: (snapshot: HarnessSnapshot) => void
}

function Harness({
  repoId,
  workspaceRuntimeId = WORKSPACE_RUNTIME_ID,
  worktreePath,
  targetKind = 'git-worktree',
  expandedKeys,
  onSnapshot,
}: HarnessProps) {
  const target = mockExecutionTarget(repoId, workspaceRuntimeId, worktreePath, targetKind)
  const result = useWorkspaceFilesystemTree({ target, expandedKeys })
  onSnapshot(result)
  return null
}

function mockExecutionTarget(
  repoId: string,
  workspaceRuntimeId: string,
  worktreePath: string,
  targetKind: 'workspace-root' | 'git-worktree' = 'git-worktree',
) {
  const workspaceId = canonicalWorkspaceLocator(`goblin+file://${repoId}`)
  const root = workspaceId ? workspaceLocatorForPath(workspaceId, worktreePath) : null
  if (!workspaceId || !root) throw new Error('invalid mock workspace target')
  return targetKind === 'workspace-root'
    ? ({ kind: 'workspace-root', workspaceId, workspaceRuntimeId } as const)
    : ({ kind: 'git-worktree', workspaceId, workspaceRuntimeId, root } as const)
}

let container: HTMLDivElement | null = null
let root: Root | null = null
let lastSnapshot: HarnessSnapshot | null = null
let queryClient: QueryClient
let stopInvalidationSync: (() => void) | null = null

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  mocks.getWorkspaceFilesystemTree.mockReset()
  listeners.clear()
  stopInvalidationSync = startWorkspaceFilesystemQueryInvalidationSync(queryClient)
  lastSnapshot = null
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root?.unmount())
  stopInvalidationSync?.()
  stopInvalidationSync = null
  queryClient.clear()
  container?.remove()
  root = null
  container = null
  lastSnapshot = null
  listeners.clear()
  mocks.getWorkspaceFilesystemTree.mockReset()
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

describe('useWorkspaceFilesystemTree', () => {
  test('hydrates the initial aggregate from cached root data without an empty-tree flash', async () => {
    const snapshots: HarnessSnapshot[] = []
    queryClient.setQueryData<WorkspaceFilesystemTreeResult>(
      [
        'workspace-filesystem-children',
        'goblin+file:///repo-a',
        WORKSPACE_RUNTIME_ID,
        'git-worktree',
        'goblin+file:///repo-a/main',
        '/repo-a/main',
        '',
      ],
      {
        nodes: [
          { id: 'README.md', path: 'README.md', name: 'README.md', parentId: null, kind: 'file', status: 'clean' },
        ],
        truncated: false,
      },
    )
    mocks.getWorkspaceFilesystemTree.mockResolvedValue({ nodes: [], truncated: false })

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
    queryClient.setQueryData<WorkspaceFilesystemTreeResult>(
      [
        'workspace-filesystem-children',
        'goblin+file:///repo-a',
        WORKSPACE_RUNTIME_ID,
        'git-worktree',
        'goblin+file:///repo-a/main',
        '/repo-a/main',
        '',
      ],
      {
        nodes: [{ id: 'src', path: 'src', name: 'src', parentId: null, kind: 'directory', status: 'clean' }],
        truncated: false,
      },
    )
    queryClient.setQueryData<WorkspaceFilesystemTreeResult>(
      [
        'workspace-filesystem-children',
        'goblin+file:///repo-a',
        WORKSPACE_RUNTIME_ID,
        'git-worktree',
        'goblin+file:///repo-a/main',
        '/repo-a/main',
        'src',
      ],
      {
        nodes: [{ id: 'src/web', path: 'src/web', name: 'web', parentId: 'src', kind: 'directory', status: 'clean' }],
        truncated: false,
      },
    )
    queryClient.setQueryData<WorkspaceFilesystemTreeResult>(
      [
        'workspace-filesystem-children',
        'goblin+file:///repo-a',
        WORKSPACE_RUNTIME_ID,
        'git-worktree',
        'goblin+file:///repo-a/main',
        '/repo-a/main',
        'src/web',
      ],
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
    mocks.getWorkspaceFilesystemTree.mockResolvedValue({ nodes: [], truncated: false })

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
    const deferred = makeDeferred<WorkspaceFilesystemTreeResult>()
    mocks.getWorkspaceFilesystemTree.mockReturnValueOnce(deferred.promise)

    await render({
      repoId: '/repo-a',
      worktreePath: '/repo-a/main',
      onSnapshot: (snapshot) => {
        lastSnapshot = snapshot
      },
    })

    expect(mocks.getWorkspaceFilesystemTree).toHaveBeenCalledWith(
      mockExecutionTarget('/repo-a', WORKSPACE_RUNTIME_ID, '/repo-a/main'),
      {},
    )
    expect(lastSnapshot?.loading).toBe(true)
    expect(lastSnapshot?.error).toBeNull()
  })

  test('resolves to the fetched tree and clears loading on success', async () => {
    const result: WorkspaceFilesystemTreeResult = {
      nodes: [{ id: 'README.md', path: 'README.md', name: 'README.md', parentId: null, kind: 'file', status: 'clean' }],
      truncated: false,
    }
    mocks.getWorkspaceFilesystemTree.mockResolvedValueOnce(result)

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
    const result: WorkspaceFilesystemTreeResult = {
      nodes: [{ id: 'README.md', path: 'README.md', name: 'README.md', parentId: null, kind: 'file', status: 'clean' }],
      truncated: false,
    }
    mocks.getWorkspaceFilesystemTree.mockResolvedValue(result)

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

    expect(mocks.getWorkspaceFilesystemTree).toHaveBeenCalledOnce()
    expect(lastSnapshot?.tree).toEqual(result)
    expect(lastSnapshot?.loading).toBe(false)
  })

  test('treats an authoritative empty tree as success', async () => {
    mocks.getWorkspaceFilesystemTree.mockResolvedValueOnce({ nodes: [], truncated: false })

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
    mocks.getWorkspaceFilesystemTree.mockRejectedValueOnce(new Error('boom'))

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
    const first = makeDeferred<WorkspaceFilesystemTreeResult>()
    const second = makeDeferred<WorkspaceFilesystemTreeResult>()
    mocks.getWorkspaceFilesystemTree.mockReturnValueOnce(first.promise)
    mocks.getWorkspaceFilesystemTree.mockReturnValueOnce(second.promise)

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

    expect(mocks.getWorkspaceFilesystemTree).toHaveBeenCalledTimes(2)
    expect(mocks.getWorkspaceFilesystemTree.mock.calls[1]?.[0]).toEqual(
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
    const deferred = makeDeferred<WorkspaceFilesystemTreeResult>()
    mocks.getWorkspaceFilesystemTree.mockReturnValueOnce(deferred.promise)

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
    expect(mocks.getWorkspaceFilesystemTree).toHaveBeenCalledOnce()
  })

  test('refetches when a filesystem invalidation arrives for the current execution target', async () => {
    mocks.getWorkspaceFilesystemTree.mockResolvedValue({ nodes: [], truncated: false })

    await render({
      repoId: '/repo-a',
      worktreePath: '/repo-a/main',
      onSnapshot: (snapshot) => {
        lastSnapshot = snapshot
      },
    })
    await flush()

    expect(mocks.getWorkspaceFilesystemTree).toHaveBeenCalledTimes(1)

    await act(async () => {
      for (const listener of listeners) {
        listener({
          type: 'workspace-filesystem-invalidated',
          target: mockExecutionTarget('/repo-a', WORKSPACE_RUNTIME_ID, '/repo-a/main'),
        })
      }
      await Promise.resolve()
    })

    expect(mocks.getWorkspaceFilesystemTree).toHaveBeenCalledTimes(2)
  })

  test('ignores invalidation events for a different repoId', async () => {
    mocks.getWorkspaceFilesystemTree.mockResolvedValue({ nodes: [], truncated: false })

    await render({
      repoId: '/repo-a',
      worktreePath: '/repo-a/main',
      onSnapshot: (snapshot) => {
        lastSnapshot = snapshot
      },
    })
    await flush()

    expect(mocks.getWorkspaceFilesystemTree).toHaveBeenCalledTimes(1)

    await act(async () => {
      for (const listener of listeners) {
        listener({
          type: 'workspace-filesystem-invalidated',
          target: mockExecutionTarget('/repo-other', WORKSPACE_RUNTIME_ID, '/repo-other/main'),
        })
      }
      await Promise.resolve()
    })

    expect(mocks.getWorkspaceFilesystemTree).toHaveBeenCalledTimes(1)
  })

  test('manual refresh() re-runs the fetch', async () => {
    mocks.getWorkspaceFilesystemTree.mockResolvedValue({ nodes: [], truncated: false })

    await render({
      repoId: '/repo-a',
      worktreePath: '/repo-a/main',
      onSnapshot: (snapshot) => {
        lastSnapshot = snapshot
      },
    })
    await flush()

    expect(mocks.getWorkspaceFilesystemTree).toHaveBeenCalledTimes(1)

    await act(async () => {
      lastSnapshot?.refresh()
      await Promise.resolve()
    })
    expect(mocks.getWorkspaceFilesystemTree).toHaveBeenCalledTimes(2)
  })

  test('loads and merges direct children for an expanded directory', async () => {
    mocks.getWorkspaceFilesystemTree
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

    expect(mocks.getWorkspaceFilesystemTree).toHaveBeenLastCalledWith(
      mockExecutionTarget('/repo-a', WORKSPACE_RUNTIME_ID, '/repo-a/main'),
      expect.objectContaining({ prefix: 'src', signal: expect.any(AbortSignal) }),
    )
    expect(lastSnapshot?.tree?.nodes.map((node) => node.id).sort()).toEqual(['src', 'src/index.ts'])
  })

  test('keeps child loading state when expanded keys hydrate cached prefixes', async () => {
    const child = makeDeferred<WorkspaceFilesystemTreeResult>()
    mocks.getWorkspaceFilesystemTree
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
    mocks.getWorkspaceFilesystemTree
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

    expect(mocks.getWorkspaceFilesystemTree).toHaveBeenCalledTimes(2)
    expect(mocks.getWorkspaceFilesystemTree.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({ prefix: 'src', signal: expect.any(AbortSignal) }),
    )
    expect(lastSnapshot?.tree?.nodes.map((node) => node.id).sort()).toEqual(['src', 'src/index.ts'])
  })

  test('records restored expanded directory load failures without replacing the root tree error', async () => {
    mocks.getWorkspaceFilesystemTree
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

    expect(mocks.getWorkspaceFilesystemTree).toHaveBeenCalledTimes(2)
    expect(lastSnapshot?.error).toBeNull()
    expect(lastSnapshot?.errorKeys.has('src')).toBe(true)
    expect(lastSnapshot?.loadingKeys.has('src')).toBe(false)
    expect(lastSnapshot?.tree?.nodes.map((node) => node.id)).toEqual(['src'])
  })

  test('invalidating after a successful read refreshes the cached tree', async () => {
    mocks.getWorkspaceFilesystemTree
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
        listener({
          type: 'workspace-filesystem-invalidated',
          target: mockExecutionTarget('/repo-a', WORKSPACE_RUNTIME_ID, '/repo-a/main'),
        })
      }
    })
    await flush()

    expect(mocks.getWorkspaceFilesystemTree).toHaveBeenCalledTimes(2)
    expect(lastSnapshot?.loading).toBe(false)
    expect(lastSnapshot?.tree?.nodes[0]?.id).toBe('second.ts')
  })

  test('invalidating keeps the current tree visible and reloads restored expanded children', async () => {
    mocks.getWorkspaceFilesystemTree
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
        listener({
          type: 'workspace-filesystem-invalidated',
          target: mockExecutionTarget('/repo-a', WORKSPACE_RUNTIME_ID, '/repo-a/main'),
        })
      }
      expect(lastSnapshot?.tree?.nodes.map((node) => node.id).sort()).toEqual(['src', 'src/old.ts'])
    })
    await flush()

    expect(mocks.getWorkspaceFilesystemTree.mock.calls.map(([, options]) => options.prefix ?? 'root')).toEqual([
      'root',
      'src',
      'root',
      'src',
    ])
    expect(lastSnapshot?.tree?.nodes.map((node) => node.id).sort()).toEqual(['src', 'src/new.ts'])
  })

  test('manual refresh() while a request is in flight reuses the in-flight query', async () => {
    const first = makeDeferred<WorkspaceFilesystemTreeResult>()
    mocks.getWorkspaceFilesystemTree.mockReturnValueOnce(first.promise)

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

    expect(mocks.getWorkspaceFilesystemTree).toHaveBeenCalledTimes(1)

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

  test('coalesces invalidation during an in-flight read and discards the pre-invalidation result', async () => {
    const first = makeDeferred<WorkspaceFilesystemTreeResult>()
    const current = {
      nodes: [
        {
          id: 'current.ts',
          path: 'current.ts',
          name: 'current.ts',
          parentId: null,
          kind: 'file',
          status: 'clean' as const,
        },
      ],
      truncated: false,
    }
    mocks.getWorkspaceFilesystemTree.mockReturnValueOnce(first.promise).mockResolvedValueOnce(current)

    await render({
      repoId: '/repo-a',
      worktreePath: '/repo-a/main',
      onSnapshot: (snapshot) => {
        lastSnapshot = snapshot
      },
    })
    await act(async () => {
      for (const listener of listeners) {
        listener({
          type: 'workspace-filesystem-invalidated',
          target: mockExecutionTarget('/repo-a', WORKSPACE_RUNTIME_ID, '/repo-a/main'),
        })
      }
      await Promise.resolve()
    })
    expect(mocks.getWorkspaceFilesystemTree).toHaveBeenCalledOnce()

    await act(async () => {
      first.resolve({
        nodes: [{ id: 'stale.ts', path: 'stale.ts', name: 'stale.ts', parentId: null, kind: 'file', status: 'clean' }],
        truncated: false,
      })
    })
    await flush()

    expect(mocks.getWorkspaceFilesystemTree).toHaveBeenCalledTimes(2)
    expect(lastSnapshot?.tree).toEqual(current)
  })

  test('shares one invalidation ingress and one refetch across observers of the same target', async () => {
    mocks.getWorkspaceFilesystemTree.mockResolvedValueOnce({ nodes: [], truncated: false }).mockResolvedValueOnce({
      nodes: [
        { id: 'current.ts', path: 'current.ts', name: 'current.ts', parentId: null, kind: 'file', status: 'clean' },
      ],
      truncated: false,
    })

    await act(async () => {
      root!.render(
        <QueryClientProvider client={queryClient}>
          <Harness repoId="/repo-a" worktreePath="/repo-a/main" onSnapshot={() => {}} />
          <Harness repoId="/repo-a" worktreePath="/repo-a/main" onSnapshot={() => {}} />
        </QueryClientProvider>,
      )
    })
    await flush()
    expect(listeners.size).toBe(1)
    expect(mocks.getWorkspaceFilesystemTree).toHaveBeenCalledOnce()

    await act(async () => {
      for (const listener of listeners) {
        listener({
          type: 'workspace-filesystem-invalidated',
          target: mockExecutionTarget('/repo-a', WORKSPACE_RUNTIME_ID, '/repo-a/main'),
        })
      }
    })
    await flush()

    expect(mocks.getWorkspaceFilesystemTree).toHaveBeenCalledTimes(2)
  })

  test('keeps cached data invalidatable while every filesystem observer is unmounted', async () => {
    mocks.getWorkspaceFilesystemTree.mockResolvedValueOnce({ nodes: [], truncated: false }).mockResolvedValueOnce({
      nodes: [
        { id: 'current.ts', path: 'current.ts', name: 'current.ts', parentId: null, kind: 'file', status: 'clean' },
      ],
      truncated: false,
    })
    await render({ repoId: '/repo-a', worktreePath: '/repo-a/main', onSnapshot: () => {} })
    await flush()

    act(() => root?.unmount())
    for (const listener of listeners) {
      listener({
        type: 'workspace-filesystem-invalidated',
        target: mockExecutionTarget('/repo-a', WORKSPACE_RUNTIME_ID, '/repo-a/main'),
      })
    }
    root = createRoot(container!)
    await render({ repoId: '/repo-a', worktreePath: '/repo-a/main', onSnapshot: () => {} })
    await flush()

    expect(mocks.getWorkspaceFilesystemTree).toHaveBeenCalledTimes(2)
  })

  test('keeps workspace-root and Git worktree caches separate at the same filesystem path', async () => {
    mocks.getWorkspaceFilesystemTree.mockResolvedValueOnce({ nodes: [], truncated: false }).mockResolvedValueOnce({
      nodes: [
        { id: 'tracked.ts', path: 'tracked.ts', name: 'tracked.ts', parentId: null, kind: 'file', status: 'clean' },
      ],
      truncated: false,
    })

    await render({
      repoId: '/repo-a',
      worktreePath: '/repo-a',
      targetKind: 'workspace-root',
      onSnapshot: () => {},
    })
    await flush()
    await setProps({
      repoId: '/repo-a',
      worktreePath: '/repo-a',
      targetKind: 'git-worktree',
      onSnapshot: () => {},
    })
    await flush()

    expect(mocks.getWorkspaceFilesystemTree).toHaveBeenCalledTimes(2)
    expect(mocks.getWorkspaceFilesystemTree.mock.calls.map(([target]) => target.kind)).toEqual([
      'workspace-root',
      'git-worktree',
    ])
  })
})
