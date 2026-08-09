// @vitest-environment jsdom
import { defineComponent } from 'vue'
import type { VNode } from 'vue'
import { flushTestUpdates, renderInJsdom } from '#/test-utils/render.tsx'
import type { JsdomRenderResult } from '#/test-utils/render.tsx'
import { QueryClient } from '@tanstack/vue-query'
import { VueQueryClientScope } from '#/web/test-utils/VueQueryClientScope.tsx'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { waitForNextMacrotask } from '#/test-utils/microtasks.ts'
import { useWorkspaceFilesystemTree } from '#/web/hooks/useWorkspaceFilesystemTree.ts'
import type { WorkspaceFilesystemNode, WorkspaceFilesystemTreeResult } from '#/shared/api-types.ts'
import { canonicalWorkspaceLocator, workspaceLocatorForPath } from '#/shared/workspace-locator.ts'
import {
  workspacePaneFilesystemExecutionTargetKey,
  type WorkspacePaneFilesystemExecutionTarget,
} from '#/shared/workspace-runtime.ts'
import {
  startWorkspaceFilesystemQueryInvalidationSync,
  workspaceFilesystemTreeChildrenQueryKey,
} from '#/web/workspace-filesystem-query.ts'

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
  isInitialLoading: boolean
  isReading: boolean
  error: string | null
  loadingKeys: ReadonlySet<string>
  expandedDirectoryReadsSettled: boolean
  loadChildren: (prefix: string) => Promise<void>
  refresh: () => void
}

interface HarnessProps {
  readonly workspaceRootPath: string
  readonly workspaceRuntimeId?: string
  readonly worktreePath: string
  readonly targetKind?: 'workspace-root' | 'git-worktree'
  readonly expandedKeys?: readonly string[]
  readonly onSnapshot: (snapshot: HarnessSnapshot) => void
}

const Harness = defineComponent<HarnessProps>({
  name: 'WorkspaceFilesystemTreeHarness',
  props: ['workspaceRootPath', 'workspaceRuntimeId', 'worktreePath', 'targetKind', 'expandedKeys', 'onSnapshot'],

  setup(props) {
    return () => {
      const target = mockExecutionTarget(
        props.workspaceRootPath,
        props.workspaceRuntimeId ?? WORKSPACE_RUNTIME_ID,
        props.worktreePath,
        props.targetKind ?? 'git-worktree',
      )
      return (
        <ExecutionTargetHarness
          key={workspacePaneFilesystemExecutionTargetKey(target)}
          target={target}
          expandedKeys={props.expandedKeys}
          onSnapshot={props.onSnapshot}
        />
      )
    }
  },
})

interface ExecutionTargetHarnessProps {
  readonly target: WorkspacePaneFilesystemExecutionTarget
  readonly expandedKeys?: readonly string[]
  readonly onSnapshot: (snapshot: HarnessSnapshot) => void
}

const ExecutionTargetHarness = defineComponent<ExecutionTargetHarnessProps>({
  name: 'ExecutionTargetHarness',
  props: ['target', 'expandedKeys', 'onSnapshot'],
  setup(props) {
    const result = useWorkspaceFilesystemTree({ target: props.target, expandedKeys: () => props.expandedKeys ?? [] })
    props.onSnapshot(result)
    return () => null
  },
})

function mockExecutionTarget(
  workspaceRootPath: string,
  workspaceRuntimeId: string,
  worktreePath: string,
  targetKind: 'workspace-root' | 'git-worktree' = 'git-worktree',
) {
  const workspaceId = canonicalWorkspaceLocator(`goblin+file://${workspaceRootPath}`)
  const root = workspaceId ? workspaceLocatorForPath(workspaceId, worktreePath) : null
  if (!workspaceId || !root) throw new Error('invalid mock workspace target')
  return targetKind === 'workspace-root'
    ? ({ kind: 'workspace-root', workspaceId, workspaceRuntimeId } as const)
    : ({ kind: 'git-worktree', workspaceId, workspaceRuntimeId, root } as const)
}

function directoryNode(id: string, parentId: string | null = null): WorkspaceFilesystemNode {
  return { id, path: id, name: id.split('/').at(-1) ?? id, parentId, kind: 'directory', status: 'clean' }
}

function fileNode(id: string, parentId: string | null = null): WorkspaceFilesystemNode {
  return { id, path: id, name: id.split('/').at(-1) ?? id, parentId, kind: 'file', status: 'clean' }
}

function filesystemTree(...nodes: WorkspaceFilesystemNode[]): WorkspaceFilesystemTreeResult {
  return { nodes, truncated: false }
}

function filesystemReadCount(prefix = ''): number {
  return mocks.getWorkspaceFilesystemTree.mock.calls.filter(([, options]) => (options.prefix ?? '') === prefix).length
}

function mainExecutionTarget(): WorkspacePaneFilesystemExecutionTarget {
  return mockExecutionTarget('/repo-a', WORKSPACE_RUNTIME_ID, '/repo-a/main')
}

function mainHarnessProps(overrides: Partial<HarnessProps> = {}): HarnessProps {
  return {
    workspaceRootPath: '/repo-a',
    worktreePath: '/repo-a/main',
    onSnapshot: (snapshot) => {
      lastSnapshot = snapshot
    },
    ...overrides,
  }
}

async function emitFilesystemInvalidation(target = mainExecutionTarget()): Promise<void> {
  await flushTestUpdates(async () => {
    for (const listener of listeners) listener({ type: 'workspace-filesystem-invalidated', target })
    await Promise.resolve()
  })
}

let rendered: JsdomRenderResult | null = null
let lastSnapshot: HarnessSnapshot | null = null
let queryClient: QueryClient
let stopInvalidationSync: (() => void) | null = null

beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  mocks.getWorkspaceFilesystemTree.mockReset()
  listeners.clear()
  stopInvalidationSync = startWorkspaceFilesystemQueryInvalidationSync(queryClient)
  lastSnapshot = null
})

afterEach(() => {
  unmountRenderedTree()
  stopInvalidationSync?.()
  stopInvalidationSync = null
  queryClient.clear()
  lastSnapshot = null
  listeners.clear()
  mocks.getWorkspaceFilesystemTree.mockReset()
})

function render(props: HarnessProps): Promise<void> {
  return renderElement(<Harness {...props} />)
}

function setProps(props: HarnessProps): Promise<void> {
  return flushTestUpdates(async () => {
    if (!rendered) throw new Error('expected rendered filesystem tree harness')
    await rendered.rerender(
      <VueQueryClientScope client={queryClient}>
        <Harness {...props} />
      </VueQueryClientScope>,
    )
  })
}

function renderElement(element: VNode): Promise<void> {
  return flushTestUpdates(async () => {
    rendered = renderInJsdom(<VueQueryClientScope client={queryClient}>{element}</VueQueryClientScope>)
  })
}

function unmountRenderedTree(): void {
  if (!rendered) return
  rendered.unmount()
  rendered = null
}

async function flush() {
  await flushTestUpdates(async () => {
    await Promise.resolve()
    await waitForNextMacrotask()
  })
}

describe('useWorkspaceFilesystemTree', () => {
  test('hydrates the initial aggregate from cached root data without an empty-tree flash', async () => {
    const snapshots: HarnessSnapshot[] = []
    queryClient.setQueryData<WorkspaceFilesystemTreeResult>(
      workspaceFilesystemTreeChildrenQueryKey(mainExecutionTarget(), ''),
      {
        nodes: [
          { id: 'README.md', path: 'README.md', name: 'README.md', parentId: null, kind: 'file', status: 'clean' },
        ],
        truncated: false,
      },
    )
    mocks.getWorkspaceFilesystemTree.mockResolvedValue({ nodes: [], truncated: false })

    await render(
      mainHarnessProps({
        onSnapshot: (snapshot) => {
          snapshots.push(snapshot)
          lastSnapshot = snapshot
        },
      }),
    )

    expect(snapshots[0]?.tree?.nodes.map((node) => node.id)).toEqual(['README.md'])
  })

  test('hydrates cached restored children and ancestors into the initial aggregate', async () => {
    const snapshots: HarnessSnapshot[] = []
    queryClient.setQueryData<WorkspaceFilesystemTreeResult>(
      workspaceFilesystemTreeChildrenQueryKey(mainExecutionTarget(), ''),
      {
        nodes: [{ id: 'src', path: 'src', name: 'src', parentId: null, kind: 'directory', status: 'clean' }],
        truncated: false,
      },
    )
    queryClient.setQueryData<WorkspaceFilesystemTreeResult>(
      workspaceFilesystemTreeChildrenQueryKey(mainExecutionTarget(), 'src'),
      {
        nodes: [{ id: 'src/web', path: 'src/web', name: 'web', parentId: 'src', kind: 'directory', status: 'clean' }],
        truncated: false,
      },
    )
    queryClient.setQueryData<WorkspaceFilesystemTreeResult>(
      workspaceFilesystemTreeChildrenQueryKey(mainExecutionTarget(), 'src/web'),
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

    await render(
      mainHarnessProps({
        expandedKeys: ['src', 'src/web'],
        onSnapshot: (snapshot) => {
          snapshots.push(snapshot)
          lastSnapshot = snapshot
        },
      }),
    )

    expect(snapshots[0]?.tree?.nodes.map((node) => node.id).sort()).toEqual([
      'src',
      'src/web',
      'src/web/FiletreeView.tsx',
    ])
  })

  test('does not restore hidden descendants until their ancestors are expanded', async () => {
    const target = mockExecutionTarget('/repo-a', WORKSPACE_RUNTIME_ID, '/repo-a/main')
    const root = filesystemTree(directoryNode('src'))
    const sourceChildren = filesystemTree(directoryNode('src/web', 'src'))
    queryClient.setQueryData(workspaceFilesystemTreeChildrenQueryKey(target, ''), root)
    queryClient.setQueryData(workspaceFilesystemTreeChildrenQueryKey(target, 'src'), sourceChildren)
    queryClient.setQueryData(
      workspaceFilesystemTreeChildrenQueryKey(target, 'src/web'),
      filesystemTree(fileNode('src/web/old.ts', 'src/web')),
    )
    mocks.getWorkspaceFilesystemTree.mockImplementation((_target, options) => {
      if (options.prefix === 'src') return Promise.resolve(sourceChildren)
      if (options.prefix === 'src/web') return Promise.resolve(filesystemTree(fileNode('src/web/new.ts', 'src/web')))
      return Promise.resolve(root)
    })
    const props = (expandedKeys: readonly string[]): HarnessProps => ({
      workspaceRootPath: '/repo-a',
      worktreePath: '/repo-a/main',
      expandedKeys,
      onSnapshot: (snapshot) => {
        lastSnapshot = snapshot
      },
    })

    await render(props(['src/web']))
    await flush()

    expect(filesystemReadCount()).toBe(1)
    expect(filesystemReadCount('src')).toBe(0)
    expect(filesystemReadCount('src/web')).toBe(0)

    await setProps(props(['src', 'src/web']))
    await flush()

    expect(filesystemReadCount('src')).toBe(1)
    expect(filesystemReadCount('src/web')).toBe(1)
    expect(lastSnapshot?.tree?.nodes.map((node) => node.id).sort()).toEqual(['src', 'src/web', 'src/web/new.ts'])
  })

  test('does not project an in-flight child failure after its ancestor is collapsed', async () => {
    const webChildren = Promise.withResolvers<WorkspaceFilesystemTreeResult>()
    let webRecovered = false
    let rootRefreshFailure = false
    mocks.getWorkspaceFilesystemTree.mockImplementation((_target, options) => {
      if (options.prefix === 'src') return Promise.resolve(filesystemTree(directoryNode('src/web', 'src')))
      if (options.prefix === 'src/web') {
        return webRecovered
          ? Promise.resolve(filesystemTree(fileNode('src/web/recovered.ts', 'src/web')))
          : webChildren.promise
      }
      if (rootRefreshFailure) return Promise.reject(new Error('root refresh failed'))
      return Promise.resolve(filesystemTree(directoryNode('src')))
    })
    const props = (expandedKeys: readonly string[]): HarnessProps => ({
      workspaceRootPath: '/repo-a',
      worktreePath: '/repo-a/main',
      expandedKeys,
      onSnapshot: (snapshot) => {
        lastSnapshot = snapshot
      },
    })

    await render(props(['src', 'src/web']))
    await flush()
    expect(filesystemReadCount('src/web')).toBe(1)

    await setProps(props(['src/web']))
    expect(lastSnapshot?.loadingKeys.size).toBe(0)
    expect(lastSnapshot?.isReading).toBe(false)
    expect(lastSnapshot?.expandedDirectoryReadsSettled).toBe(true)

    rootRefreshFailure = true
    await flushTestUpdates(async () => {
      lastSnapshot?.refresh()
    })
    await flush()
    expect(lastSnapshot?.error).toBe('root refresh failed')
    expect(lastSnapshot?.isReading).toBe(false)

    rootRefreshFailure = false
    await flushTestUpdates(async () => {
      lastSnapshot?.refresh()
    })
    await flush()
    expect(lastSnapshot?.error).toBeNull()

    await flushTestUpdates(async () => {
      webChildren.reject(new Error('hidden child failed'))
      await Promise.resolve()
    })
    await flush()

    expect(lastSnapshot?.error).toBeNull()
    expect(lastSnapshot?.expandedDirectoryReadsSettled).toBe(true)

    await setProps(props(['src', 'src/web']))
    await flush()
    expect(lastSnapshot?.error).toBe('filetree.error')
    expect(lastSnapshot?.expandedDirectoryReadsSettled).toBe(true)

    webRecovered = true
    await flushTestUpdates(async () => {
      lastSnapshot?.refresh()
    })
    await flush()

    expect(filesystemReadCount('src/web')).toBe(2)
    expect(lastSnapshot?.error).toBeNull()
    expect(lastSnapshot?.tree?.nodes.map((node) => node.id).sort()).toEqual(['src', 'src/web', 'src/web/recovered.ts'])
  })

  test('loads the initial tree', async () => {
    const deferred = Promise.withResolvers<WorkspaceFilesystemTreeResult>()
    mocks.getWorkspaceFilesystemTree.mockReturnValueOnce(deferred.promise)

    await render(mainHarnessProps())

    expect(mocks.getWorkspaceFilesystemTree).toHaveBeenCalledWith(mainExecutionTarget(), {})
    expect(lastSnapshot?.isInitialLoading).toBe(true)
    expect(lastSnapshot?.error).toBeNull()
    const result: WorkspaceFilesystemTreeResult = {
      nodes: [{ id: 'README.md', path: 'README.md', name: 'README.md', parentId: null, kind: 'file', status: 'clean' }],
      truncated: false,
    }

    await flushTestUpdates(async () => {
      deferred.resolve(result)
      await deferred.promise
    })
    await flush()

    expect(lastSnapshot?.tree).toEqual(result)
    expect(lastSnapshot?.isInitialLoading).toBe(false)
    expect(lastSnapshot?.error).toBeNull()
  })

  test('revalidates cached restored children once for one mounted observer', async () => {
    const target = mockExecutionTarget('/repo-a', WORKSPACE_RUNTIME_ID, '/repo-a/main')
    const root = filesystemTree(directoryNode('src'))
    queryClient.setQueryData(workspaceFilesystemTreeChildrenQueryKey(target, ''), root)
    queryClient.setQueryData(
      workspaceFilesystemTreeChildrenQueryKey(target, 'src'),
      filesystemTree(fileNode('src/old.ts', 'src')),
    )
    mocks.getWorkspaceFilesystemTree.mockImplementation((_target, options) =>
      Promise.resolve(options.prefix === 'src' ? filesystemTree(fileNode('src/new.ts', 'src')) : root),
    )

    await renderElement(
      <Harness
        workspaceRootPath="/repo-a"
        worktreePath="/repo-a/main"
        expandedKeys={['src']}
        onSnapshot={(snapshot) => {
          lastSnapshot = snapshot
        }}
      />,
    )
    await flush()

    expect(filesystemReadCount()).toBe(1)
    expect(filesystemReadCount('src')).toBe(1)
    expect(lastSnapshot?.tree?.nodes.map((node) => node.id).sort()).toEqual(['src', 'src/new.ts'])
  })

  test('revalidates the root and restored expanded directories when the tree mounts again', async () => {
    const root = filesystemTree(directoryNode('src'))
    let children = filesystemTree(fileNode('src/old.ts', 'src'))
    mocks.getWorkspaceFilesystemTree.mockImplementation((_target, options) =>
      Promise.resolve(options.prefix === 'src' ? children : root),
    )

    const props: HarnessProps = {
      workspaceRootPath: '/repo-a',
      worktreePath: '/repo-a/main',
      expandedKeys: ['src'],
      onSnapshot: (snapshot) => {
        lastSnapshot = snapshot
      },
    }
    await render(props)
    await flush()
    expect(filesystemReadCount()).toBe(1)
    expect(filesystemReadCount('src')).toBe(1)

    unmountRenderedTree()
    children = filesystemTree(fileNode('src/new.ts', 'src'))

    await render(props)
    await flush()

    expect(filesystemReadCount()).toBe(2)
    expect(filesystemReadCount('src')).toBe(2)
    expect(lastSnapshot?.tree?.nodes.map((node) => node.id).sort()).toEqual(['src', 'src/new.ts'])
  })

  test('joins the query-owned root read when the tree remounts before it settles', async () => {
    const rootRead = Promise.withResolvers<WorkspaceFilesystemTreeResult>()
    const root = filesystemTree(fileNode('README.md'))
    mocks.getWorkspaceFilesystemTree.mockReturnValue(rootRead.promise)
    const props = mainHarnessProps()

    await render(props)
    expect(filesystemReadCount()).toBe(1)

    unmountRenderedTree()
    await render(props)
    expect(filesystemReadCount()).toBe(1)

    await flushTestUpdates(async () => {
      rootRead.resolve(root)
      await rootRead.promise
    })
    await flush()

    expect(filesystemReadCount()).toBe(1)
    expect(lastSnapshot?.tree).toEqual(root)
  })

  test('treats an authoritative empty tree as success', async () => {
    mocks.getWorkspaceFilesystemTree.mockResolvedValueOnce({ nodes: [], truncated: false })

    await render(mainHarnessProps())
    await flush()

    expect(lastSnapshot?.tree).toEqual({ nodes: [], truncated: false })
    expect(lastSnapshot?.error).toBeNull()
    expect(lastSnapshot?.isInitialLoading).toBe(false)
  })

  test('reports an error when the client rejects with a real failure', async () => {
    mocks.getWorkspaceFilesystemTree.mockRejectedValueOnce(new Error('boom'))

    await render(mainHarnessProps())
    await flush()

    expect(lastSnapshot?.error).toBe('boom')
    expect(lastSnapshot?.isInitialLoading).toBe(false)
  })

  test('starts the new target read without letting the previous cache read clobber it', async () => {
    const first = Promise.withResolvers<WorkspaceFilesystemTreeResult>()
    const second = Promise.withResolvers<WorkspaceFilesystemTreeResult>()
    mocks.getWorkspaceFilesystemTree.mockReturnValueOnce(first.promise)
    mocks.getWorkspaceFilesystemTree.mockReturnValueOnce(second.promise)

    await render(mainHarnessProps())

    await setProps({
      workspaceRootPath: '/repo-a',
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
    await flushTestUpdates(async () => {
      first.resolve({ nodes: [], truncated: false })
      await Promise.resolve()
    })
    expect(lastSnapshot?.tree).toBeNull()

    // Resolving the second promise applies the new state.
    await flushTestUpdates(async () => {
      second.resolve({
        nodes: [{ id: 'src', path: 'src', name: 'src', parentId: null, kind: 'directory', status: 'clean' }],
        truncated: false,
      })
    })
    await flush()
    expect(lastSnapshot?.tree?.nodes).toHaveLength(1)
  })

  test('ignores invalidation events for a different workspace root', async () => {
    mocks.getWorkspaceFilesystemTree.mockResolvedValue({ nodes: [], truncated: false })

    await render(mainHarnessProps())
    await flush()

    expect(mocks.getWorkspaceFilesystemTree).toHaveBeenCalledTimes(1)

    await emitFilesystemInvalidation(mockExecutionTarget('/repo-other', WORKSPACE_RUNTIME_ID, '/repo-other/main'))

    expect(mocks.getWorkspaceFilesystemTree).toHaveBeenCalledTimes(1)
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

    await render(mainHarnessProps())
    await flush()

    await flushTestUpdates(async () => {
      await lastSnapshot?.loadChildren('src')
    })
    await flush()

    expect(mocks.getWorkspaceFilesystemTree).toHaveBeenLastCalledWith(
      mockExecutionTarget('/repo-a', WORKSPACE_RUNTIME_ID, '/repo-a/main'),
      expect.objectContaining({ prefix: 'src', signal: expect.any(AbortSignal) }),
    )
    expect(lastSnapshot?.tree?.nodes.map((node) => node.id).sort()).toEqual(['src', 'src/index.ts'])
  })

  test('projects child loading only while its directory is reachable', async () => {
    const child = Promise.withResolvers<WorkspaceFilesystemTreeResult>()
    mocks.getWorkspaceFilesystemTree
      .mockResolvedValueOnce({
        nodes: [{ id: 'src', path: 'src', name: 'src', parentId: null, kind: 'directory', status: 'clean' }],
        truncated: false,
      })
      .mockReturnValueOnce(child.promise)

    await render(mainHarnessProps())
    await flush()

    let childLoad: Promise<void> | undefined
    await flushTestUpdates(async () => {
      childLoad = lastSnapshot?.loadChildren('src')
      await Promise.resolve()
    })
    expect(lastSnapshot?.loadingKeys.has('src')).toBe(false)
    expect(lastSnapshot?.isReading).toBe(false)

    await setProps({
      workspaceRootPath: '/repo-a',
      worktreePath: '/repo-a/main',
      expandedKeys: ['src'],
      onSnapshot: (snapshot) => {
        lastSnapshot = snapshot
      },
    })
    await flush()
    expect(lastSnapshot?.loadingKeys.has('src')).toBe(true)

    await flushTestUpdates(async () => {
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
    expect(lastSnapshot?.isReading).toBe(false)
    expect(lastSnapshot?.tree?.nodes.map((node) => node.id).sort()).toEqual(['src', 'src/index.ts'])
  })

  test('waits for restored ancestors before loading nested expanded directories', async () => {
    const sourceChildren = Promise.withResolvers<WorkspaceFilesystemTreeResult>()
    const webChildren = Promise.withResolvers<WorkspaceFilesystemTreeResult>()
    mocks.getWorkspaceFilesystemTree.mockImplementation((_target, options) => {
      if (options.prefix === 'src') return sourceChildren.promise
      if (options.prefix === 'src/web') return webChildren.promise
      return Promise.resolve(filesystemTree(directoryNode('src')))
    })

    await render(mainHarnessProps({ expandedKeys: ['src', 'src/web'] }))
    await flush()

    expect(filesystemReadCount('src')).toBe(1)
    expect(filesystemReadCount('src/web')).toBe(0)
    expect(lastSnapshot?.expandedDirectoryReadsSettled).toBe(false)

    webChildren.resolve(filesystemTree(fileNode('src/web/index.ts', 'src/web')))
    await flushTestUpdates(async () => {
      sourceChildren.resolve(filesystemTree(directoryNode('src/web', 'src')))
      await sourceChildren.promise
    })
    await flush()

    expect(filesystemReadCount('src/web')).toBe(1)
    expect(lastSnapshot?.expandedDirectoryReadsSettled).toBe(true)
    expect(lastSnapshot?.tree?.nodes.map((node) => node.id).sort()).toEqual(['src', 'src/web', 'src/web/index.ts'])
  })

  test('settles descendants when an ancestor read fails', async () => {
    mocks.getWorkspaceFilesystemTree.mockImplementation((_target, options) => {
      if (options.prefix === 'src') return Promise.reject(new Error('source read failed'))
      return Promise.resolve(filesystemTree(directoryNode('src')))
    })

    await render(mainHarnessProps({ expandedKeys: ['src', 'src/web'] }))
    await flush()

    expect(filesystemReadCount('src')).toBe(1)
    expect(filesystemReadCount('src/web')).toBe(0)
    expect(lastSnapshot?.error).toBe('filetree.error')
    expect(lastSnapshot?.isReading).toBe(false)
    expect(lastSnapshot?.expandedDirectoryReadsSettled).toBe(true)
  })

  test('settles a missing restored directory after unchanged and failed root refreshes', async () => {
    const root = filesystemTree()
    let rootRefreshFailure = false
    mocks.getWorkspaceFilesystemTree.mockImplementation(() =>
      rootRefreshFailure ? Promise.reject(new Error('root refresh failed')) : Promise.resolve(root),
    )

    await render(mainHarnessProps({ expandedKeys: ['missing'] }))
    await flush()
    expect(lastSnapshot?.expandedDirectoryReadsSettled).toBe(true)

    await flushTestUpdates(async () => {
      lastSnapshot?.refresh()
    })
    await flush()
    expect(lastSnapshot?.expandedDirectoryReadsSettled).toBe(true)

    rootRefreshFailure = true
    await flushTestUpdates(async () => {
      lastSnapshot?.refresh()
    })
    await flush()
    expect(lastSnapshot?.error).toBe('root refresh failed')
    expect(lastSnapshot?.expandedDirectoryReadsSettled).toBe(true)
  })

  test('does not restore late children after their directory is authoritatively removed', async () => {
    const lateChildren = Promise.withResolvers<WorkspaceFilesystemTreeResult>()
    let removed = false
    mocks.getWorkspaceFilesystemTree.mockImplementation((_target, options) => {
      if (options.prefix === 'src') {
        return removed ? lateChildren.promise : Promise.resolve(filesystemTree(fileNode('src/old.ts', 'src')))
      }
      return Promise.resolve(removed ? filesystemTree() : filesystemTree(directoryNode('src')))
    })
    const props: HarnessProps = {
      workspaceRootPath: '/repo-a',
      worktreePath: '/repo-a/main',
      expandedKeys: ['src'],
      onSnapshot: (snapshot) => {
        lastSnapshot = snapshot
      },
    }

    await render(props)
    await flush()
    expect(lastSnapshot?.tree?.nodes.map((node) => node.id).sort()).toEqual(['src', 'src/old.ts'])

    removed = true
    await flushTestUpdates(async () => {
      lastSnapshot?.refresh()
      await Promise.resolve()
    })
    await flush()
    expect(lastSnapshot?.tree?.nodes).toEqual([])

    await flushTestUpdates(async () => {
      lateChildren.resolve(filesystemTree(fileNode('src/late.ts', 'src')))
      await lateChildren.promise
    })
    await flush()
    expect(lastSnapshot?.tree?.nodes).toEqual([])
    expect(lastSnapshot?.error).toBeNull()

    unmountRenderedTree()
    await render(props)
    await flush()

    expect(lastSnapshot?.tree?.nodes).toEqual([])
    expect(lastSnapshot?.error).toBeNull()
    expect(filesystemReadCount('src')).toBe(2)
  })

  test('preserves accepted children after revalidation fails and replaces them on explicit retry', async () => {
    const root = filesystemTree(directoryNode('src'))
    const acceptedChildren = filesystemTree(fileNode('src/old.ts', 'src'))
    const recoveredChildren = filesystemTree(fileNode('src/new.ts', 'src'))
    let phase: 'accepted' | 'failing' | 'recovered' = 'accepted'
    mocks.getWorkspaceFilesystemTree.mockImplementation((_target, options) => {
      if (options.prefix !== 'src') return Promise.resolve(root)
      if (phase === 'failing') return Promise.reject(new Error('child failed'))
      return Promise.resolve(phase === 'accepted' ? acceptedChildren : recoveredChildren)
    })
    const props: HarnessProps = {
      workspaceRootPath: '/repo-a',
      worktreePath: '/repo-a/main',
      expandedKeys: ['src'],
      onSnapshot: (snapshot) => {
        lastSnapshot = snapshot
      },
    }
    await render(props)
    await flush()

    unmountRenderedTree()
    phase = 'failing'
    await render(props)
    await flush()

    expect(lastSnapshot?.tree?.nodes.map((node) => node.id).sort()).toEqual(['src', 'src/old.ts'])
    expect(lastSnapshot?.error).toBe('filetree.error')
    expect(lastSnapshot?.expandedDirectoryReadsSettled).toBe(true)

    phase = 'recovered'
    await flushTestUpdates(async () => {
      lastSnapshot?.refresh()
    })
    await flush()

    expect(lastSnapshot?.tree?.nodes.map((node) => node.id).sort()).toEqual(['src', 'src/new.ts'])
    expect(lastSnapshot?.error).toBeNull()
    expect(lastSnapshot?.expandedDirectoryReadsSettled).toBe(true)
  })

  test('keeps the accepted root available when its refresh fails', async () => {
    const accepted = filesystemTree(fileNode('README.md'))
    let failing = false
    mocks.getWorkspaceFilesystemTree.mockImplementation(() =>
      failing ? Promise.reject(new Error('refresh failed')) : Promise.resolve(accepted),
    )
    await render(mainHarnessProps())
    await flush()

    failing = true
    await flushTestUpdates(async () => {
      lastSnapshot?.refresh()
    })
    await flush()

    expect(lastSnapshot?.tree).toEqual(accepted)
    expect(lastSnapshot?.error).toBe('refresh failed')
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

    await render(mainHarnessProps())
    await flush()
    expect(lastSnapshot?.isInitialLoading).toBe(false)
    expect(lastSnapshot?.tree?.nodes[0]?.id).toBe('first.ts')

    await emitFilesystemInvalidation()
    await flush()

    expect(mocks.getWorkspaceFilesystemTree).toHaveBeenCalledTimes(2)
    expect(lastSnapshot?.isInitialLoading).toBe(false)
    expect(lastSnapshot?.tree?.nodes[0]?.id).toBe('second.ts')
  })

  test('invalidating keeps the current tree visible and reloads restored expanded children', async () => {
    const root = filesystemTree(directoryNode('src'))
    const oldChildren = filesystemTree(fileNode('src/old.ts', 'src'))
    const newChildren = filesystemTree(fileNode('src/new.ts', 'src'))
    const refreshedRoot = Promise.withResolvers<WorkspaceFilesystemTreeResult>()
    const refreshedChildren = Promise.withResolvers<WorkspaceFilesystemTreeResult>()
    let refreshing = false
    mocks.getWorkspaceFilesystemTree.mockImplementation((_target, options) => {
      if (!refreshing) return Promise.resolve(options.prefix === 'src' ? oldChildren : root)
      return options.prefix === 'src' ? refreshedChildren.promise : refreshedRoot.promise
    })

    await render(mainHarnessProps({ expandedKeys: ['src'] }))
    await flush()
    expect(lastSnapshot?.tree?.nodes.map((node) => node.id).sort()).toEqual(['src', 'src/old.ts'])

    refreshing = true
    await emitFilesystemInvalidation()
    await flush()

    expect(filesystemReadCount()).toBe(2)
    expect(filesystemReadCount('src')).toBe(2)
    expect(lastSnapshot?.isReading).toBe(true)
    expect(lastSnapshot?.tree?.nodes.map((node) => node.id).sort()).toEqual(['src', 'src/old.ts'])

    await flushTestUpdates(async () => {
      refreshedRoot.resolve(root)
      refreshedChildren.resolve(newChildren)
      await Promise.all([refreshedRoot.promise, refreshedChildren.promise])
    })
    await flush()

    expect(lastSnapshot?.isReading).toBe(false)
    expect(lastSnapshot?.tree?.nodes.map((node) => node.id).sort()).toEqual(['src', 'src/new.ts'])
  })

  test('manual refresh() while a request is in flight reuses the in-flight query', async () => {
    const first = Promise.withResolvers<WorkspaceFilesystemTreeResult>()
    mocks.getWorkspaceFilesystemTree.mockReturnValueOnce(first.promise)

    await render(mainHarnessProps())

    await flushTestUpdates(async () => {
      lastSnapshot?.refresh()
      await Promise.resolve()
    })

    expect(mocks.getWorkspaceFilesystemTree).toHaveBeenCalledTimes(1)

    await flushTestUpdates(async () => {
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
    const first = Promise.withResolvers<WorkspaceFilesystemTreeResult>()
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

    await render(mainHarnessProps())
    await emitFilesystemInvalidation()
    expect(mocks.getWorkspaceFilesystemTree).toHaveBeenCalledOnce()

    await flushTestUpdates(async () => {
      first.resolve({
        nodes: [{ id: 'stale.ts', path: 'stale.ts', name: 'stale.ts', parentId: null, kind: 'file', status: 'clean' }],
        truncated: false,
      })
    })
    await flush()

    expect(mocks.getWorkspaceFilesystemTree).toHaveBeenCalledTimes(2)
    expect(lastSnapshot?.tree).toEqual(current)
  })

  test('reloads settled expanded children when invalidation arrives during the root read', async () => {
    const target = mockExecutionTarget('/repo-a', WORKSPACE_RUNTIME_ID, '/repo-a/main')
    const root = filesystemTree(directoryNode('src'))
    queryClient.setQueryData(workspaceFilesystemTreeChildrenQueryKey(target, ''), root)
    queryClient.setQueryData(
      workspaceFilesystemTreeChildrenQueryKey(target, 'src'),
      filesystemTree(fileNode('src/cached.ts', 'src')),
    )
    const firstRootRead = Promise.withResolvers<WorkspaceFilesystemTreeResult>()
    let rootReadCount = 0
    let childReadCount = 0
    mocks.getWorkspaceFilesystemTree.mockImplementation((_target, options) => {
      if (options.prefix === 'src') {
        childReadCount += 1
        return Promise.resolve(filesystemTree(fileNode(childReadCount === 1 ? 'src/old.ts' : 'src/current.ts', 'src')))
      }
      rootReadCount += 1
      return rootReadCount === 1 ? firstRootRead.promise : Promise.resolve(root)
    })

    await render(mainHarnessProps({ expandedKeys: ['src'] }))
    await flush()
    expect(lastSnapshot?.tree?.nodes.map((node) => node.id).sort()).toEqual(['src', 'src/old.ts'])

    await emitFilesystemInvalidation(target)
    await flushTestUpdates(async () => {
      firstRootRead.resolve(root)
      await firstRootRead.promise
    })
    await flush()

    expect(filesystemReadCount()).toBe(2)
    expect(filesystemReadCount('src')).toBe(2)
    expect(lastSnapshot?.tree?.nodes.map((node) => node.id).sort()).toEqual(['src', 'src/current.ts'])
  })

  test('shares one invalidation ingress and one refetch across observers of the same target', async () => {
    mocks.getWorkspaceFilesystemTree.mockResolvedValueOnce({ nodes: [], truncated: false }).mockResolvedValueOnce({
      nodes: [
        { id: 'current.ts', path: 'current.ts', name: 'current.ts', parentId: null, kind: 'file', status: 'clean' },
      ],
      truncated: false,
    })

    await renderElement(
      <>
        <Harness workspaceRootPath="/repo-a" worktreePath="/repo-a/main" onSnapshot={() => {}} />
        <Harness workspaceRootPath="/repo-a" worktreePath="/repo-a/main" onSnapshot={() => {}} />
      </>,
    )
    await flush()
    expect(listeners.size).toBe(1)
    expect(mocks.getWorkspaceFilesystemTree).toHaveBeenCalledOnce()

    await emitFilesystemInvalidation()
    await flush()

    expect(mocks.getWorkspaceFilesystemTree).toHaveBeenCalledTimes(2)
  })

  test('revalidates expanded children for an existing observer when a later observer refreshes the shared root', async () => {
    const snapshots: Record<'first' | 'second', HarnessSnapshot | null> = { first: null, second: null }
    let childReadCount = 0
    mocks.getWorkspaceFilesystemTree.mockImplementation((_target, options) => {
      if (options.prefix !== 'src') return Promise.resolve(filesystemTree(directoryNode('src')))
      childReadCount += 1
      return Promise.resolve(filesystemTree(fileNode(childReadCount === 1 ? 'src/old.ts' : 'src/new.ts', 'src')))
    })
    const observer = (name: 'first' | 'second') => (
      <Harness
        key={name}
        workspaceRootPath="/repo-a"
        worktreePath="/repo-a/main"
        expandedKeys={['src']}
        onSnapshot={(snapshot) => {
          snapshots[name] = snapshot
        }}
      />
    )

    await renderElement(observer('first'))
    await flush()
    expect(snapshots.first?.tree?.nodes.map((node) => node.id).sort()).toEqual(['src', 'src/old.ts'])

    await flushTestUpdates(async () => {
      if (!rendered) throw new Error('expected rendered filesystem tree harness')
      await rendered.rerender(
        <VueQueryClientScope client={queryClient}>
          {observer('first')}
          {observer('second')}
        </VueQueryClientScope>,
      )
    })
    await flush()

    expect(filesystemReadCount()).toBe(2)
    expect(filesystemReadCount('src')).toBe(2)
    expect(snapshots.first?.tree?.nodes.map((node) => node.id).sort()).toEqual(['src', 'src/new.ts'])
    expect(snapshots.second?.tree?.nodes.map((node) => node.id).sort()).toEqual(['src', 'src/new.ts'])
  })

  test('keeps cached data invalidatable while every filesystem observer is unmounted', async () => {
    mocks.getWorkspaceFilesystemTree.mockResolvedValueOnce({ nodes: [], truncated: false }).mockResolvedValueOnce({
      nodes: [
        { id: 'current.ts', path: 'current.ts', name: 'current.ts', parentId: null, kind: 'file', status: 'clean' },
      ],
      truncated: false,
    })
    await render(mainHarnessProps({ onSnapshot: () => {} }))
    await flush()

    unmountRenderedTree()
    await emitFilesystemInvalidation()
    await render(mainHarnessProps({ onSnapshot: () => {} }))
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

    await render(
      mainHarnessProps({
        worktreePath: '/repo-a',
        targetKind: 'workspace-root',
        onSnapshot: () => {},
      }),
    )
    await flush()
    await setProps(
      mainHarnessProps({
        worktreePath: '/repo-a',
        targetKind: 'git-worktree',
        onSnapshot: () => {},
      }),
    )
    await flush()

    expect(mocks.getWorkspaceFilesystemTree).toHaveBeenCalledTimes(2)
    expect(mocks.getWorkspaceFilesystemTree.mock.calls.map(([target]) => target.kind)).toEqual([
      'workspace-root',
      'git-worktree',
    ])
  })
})
