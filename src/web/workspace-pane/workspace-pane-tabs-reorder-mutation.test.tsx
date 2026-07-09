// @vitest-environment jsdom

import { act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { flushMicrotasks, renderInJsdom } from '#/test-utils/render.tsx'
import { setClientBridgeForTests } from '#/web/client-bridge.ts'
import {
  createRepoBranch,
  installWorkspacePaneTabsTestBridge,
  resetReposStore,
  seedRepoWithReadModelForTest,
} from '#/web/test-utils/bridge.ts'
import {
  readWorkspacePaneTabsForTarget,
  refreshWorkspacePaneTabsQueryData,
  setWorkspacePaneTabsForTargetQueryData,
  workspacePaneTabsQueryOptions,
} from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import {
  type WorkspacePaneTabsReorderMutationInput,
  type WorkspacePaneTabsReorderMutationResult,
  useWorkspacePaneTabsReorderMutation,
} from '#/web/workspace-pane/workspace-pane-tabs-reorder-mutation.ts'
import { workspacePaneStaticTabEntry, workspacePaneRuntimeTabEntry } from '#/shared/workspace-pane.ts'
import type { WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
import type { WorkspacePaneTabsEntry, WorkspacePaneTabsUpdateInput } from '#/shared/workspace-pane-tabs.ts'

const REPO_ROOT = '/tmp/workspace-pane-tabs-reorder-mutation-repo'
const REPO_RUNTIME_ID = 'repo-runtime-test'
const NEXT_REPO_RUNTIME_ID = 'repo-runtime-next'
const BRANCH_NAME = 'feature/worktree'
const WORKTREE_PATH = '/tmp/workspace-pane-tabs-reorder-mutation-worktree'

interface DeferredUpdateWorkspaceTabsRequest {
  input: WorkspacePaneTabsUpdateInput
  resolve: (tabs: WorkspacePaneTabEntry[]) => void
  reject: (err: unknown) => void
}

let queryClient: QueryClient
let controls: WorkspacePaneTabsReorderMutationResult | null = null

beforeEach(() => {
  resetReposStore()
  seedWorkspacePaneTabsRepo(REPO_RUNTIME_ID)
  queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  controls = null
})

afterEach(() => {
  queryClient.clear()
  resetReposStore()
  setClientBridgeForTests(null)
  controls = null
})

describe('useWorkspacePaneTabsReorderMutation', () => {
  test('optimistically writes query cache and then applies canonical server tabs', async () => {
    let resolveServerTabs!: (tabs: WorkspacePaneTabEntry[]) => void
    const serverTabs = new Promise<WorkspacePaneTabEntry[]>((resolve) => {
      resolveServerTabs = resolve
    })
    installWorkspacePaneTabsTestBridge({
      updateWorkspaceTabs: async () => await serverTabs,
    })
    const sourceTabs = [terminalEntry('term-111111111111111111111'), staticEntry('status')]
    const reorderedTabs = [staticEntry('status'), terminalEntry('term-111111111111111111111')]
    const canonicalServerTabs = [terminalEntry('term-111111111111111111111'), staticEntry('status')]
    seedWorkspacePaneTabs(sourceTabs)
    renderMutationHook({ canonicalTabs: sourceTabs })

    act(() => {
      currentControls().reorderTabs(reorderedTabs)
    })

    await vi.waitFor(() => {
      expect(readWorkspacePaneTabs()).toEqual(reorderedTabs)
    })

    resolveServerTabs(canonicalServerTabs)

    await vi.waitFor(() => {
      expect(readWorkspacePaneTabs()).toEqual(canonicalServerTabs)
    })
  })

  test('cancels list queries that start while reorder is in flight before writing server tabs', async () => {
    let resolveServerTabs!: (tabs: WorkspacePaneTabEntry[]) => void
    const serverTabs = new Promise<WorkspacePaneTabEntry[]>((resolve) => {
      resolveServerTabs = resolve
    })
    let resolveListTabs!: (tabs: WorkspacePaneTabsEntry[]) => void
    const listTabs = new Promise<WorkspacePaneTabsEntry[]>((resolve) => {
      resolveListTabs = resolve
    })
    let markUpdateStarted!: () => void
    const updateStarted = new Promise<void>((resolve) => {
      markUpdateStarted = resolve
    })
    installWorkspacePaneTabsTestBridge({
      listWorkspaceTabs: async () => await listTabs,
      updateWorkspaceTabs: async () => {
        markUpdateStarted()
        return await serverTabs
      },
    })
    const sourceTabs = [terminalEntry('term-111111111111111111111'), staticEntry('status')]
    const reorderedTabs = [staticEntry('status'), terminalEntry('term-111111111111111111111')]
    const canonicalServerTabs = [terminalEntry('term-111111111111111111111'), staticEntry('history')]
    seedWorkspacePaneTabs(sourceTabs)
    renderMutationHook({ canonicalTabs: sourceTabs })

    act(() => {
      currentControls().reorderTabs(reorderedTabs)
    })
    await updateStarted
    const fetch = queryClient.fetchQuery(workspacePaneTabsQueryOptions(REPO_ROOT, REPO_RUNTIME_ID)).catch(() => null)

    resolveServerTabs(canonicalServerTabs)
    await vi.waitFor(() => {
      expect(readWorkspacePaneTabs()).toEqual(canonicalServerTabs)
    })
    resolveListTabs([
      {
        repoRoot: REPO_ROOT,
        branchName: BRANCH_NAME,
        worktreePath: WORKTREE_PATH,
        tabs: [staticEntry('status')],
      },
    ])
    await fetch

    expect(readWorkspacePaneTabs()).toEqual(canonicalServerTabs)
  })

  test('applies successful reorder response after an intervening stale refresh writes old tabs', async () => {
    const requests: DeferredUpdateWorkspaceTabsRequest[] = []
    let resolveListTabs!: (tabs: WorkspacePaneTabsEntry[]) => void
    installWorkspacePaneTabsTestBridge({
      listWorkspaceTabs: async () =>
        await new Promise<WorkspacePaneTabsEntry[]>((resolve) => {
          resolveListTabs = resolve
        }),
      updateWorkspaceTabs: async (input) =>
        await new Promise<WorkspacePaneTabEntry[]>((resolve, reject) => {
          requests.push({ input, resolve, reject })
        }),
    })
    const sourceTabs = [terminalEntry('term-111111111111111111111'), staticEntry('status')]
    const reorderedTabs = [staticEntry('status'), terminalEntry('term-111111111111111111111')]
    const canonicalServerTabs = [staticEntry('status'), terminalEntry('term-111111111111111111111'), staticEntry('history')]
    seedWorkspacePaneTabs(sourceTabs)
    renderMutationHook({ canonicalTabs: sourceTabs })

    act(() => {
      currentControls().reorderTabs(reorderedTabs)
    })
    await vi.waitFor(() => {
      expect(readWorkspacePaneTabs()).toEqual(reorderedTabs)
      expect(requests).toHaveLength(1)
    })

    const refresh = refreshWorkspacePaneTabsQueryData(REPO_ROOT, REPO_RUNTIME_ID, queryClient)
    await Promise.resolve()
    resolveListTabs([entry(sourceTabs)])
    await refresh
    expect(readWorkspacePaneTabs()).toEqual(sourceTabs)

    await act(async () => {
      requests[0]!.resolve(canonicalServerTabs)
      await flushMicrotasks()
    })

    await vi.waitFor(() => {
      expect(readWorkspacePaneTabs()).toEqual(canonicalServerTabs)
    })
  })

  test('applies consecutive optimistic reorders without a client queue', async () => {
    const sourceTabs = [terminalEntry('term-111111111111111111111'), staticEntry('status'), staticEntry('history')]
    const requests = installDeferredUpdateWorkspaceTabs()
    const firstReorderTabs = [staticEntry('status'), terminalEntry('term-111111111111111111111'), staticEntry('history')]
    const secondDraggedTabs = [terminalEntry('term-111111111111111111111'), staticEntry('status')]
    const expectedSecondCommitTabs = [terminalEntry('term-111111111111111111111'), staticEntry('status'), staticEntry('history')]
    seedWorkspacePaneTabs(sourceTabs)
    renderMutationHook({ canonicalTabs: sourceTabs })

    act(() => {
      currentControls().reorderTabs(firstReorderTabs)
    })
    await vi.waitFor(() => {
      expect(readWorkspacePaneTabs()).toEqual(firstReorderTabs)
      expect(requests).toHaveLength(1)
    })

    act(() => {
      currentControls().reorderTabs(secondDraggedTabs)
    })
    await vi.waitFor(() => {
      expect(requests).toHaveLength(2)
    })
    expect(requests[1]!.input.operation).toEqual({
      type: 'reorder',
      tabIdentities: ['terminal:term-111111111111111111111', 'workspace-pane:status'],
    })
    expect(readWorkspacePaneTabs()).toEqual(expectedSecondCommitTabs)

    await act(async () => {
      requests[0]!.resolve(firstReorderTabs)
      await flushMicrotasks()
    })
    expect(readWorkspacePaneTabs()).toEqual(expectedSecondCommitTabs)

    await act(async () => {
      requests[1]!.resolve(expectedSecondCommitTabs)
      await flushMicrotasks()
    })
    await vi.waitFor(() => {
      expect(readWorkspacePaneTabs()).toEqual(expectedSecondCommitTabs)
    })
  })

  test('keeps a newer optimistic reorder when an earlier reorder fails', async () => {
    const onReorderRejected = vi.fn()
    const sourceTabs = [terminalEntry('term-111111111111111111111'), staticEntry('status'), staticEntry('history')]
    const requests = installDeferredUpdateWorkspaceTabs()
    const firstReorderTabs = [staticEntry('status'), terminalEntry('term-111111111111111111111'), staticEntry('history')]
    const secondReorderTabs = [staticEntry('history'), staticEntry('status'), terminalEntry('term-111111111111111111111')]
    seedWorkspacePaneTabs(sourceTabs)
    renderMutationHook({ canonicalTabs: sourceTabs, onReorderRejected })

    act(() => {
      currentControls().reorderTabs(firstReorderTabs)
    })
    await vi.waitFor(() => {
      expect(readWorkspacePaneTabs()).toEqual(firstReorderTabs)
      expect(requests).toHaveLength(1)
    })

    act(() => {
      currentControls().reorderTabs(secondReorderTabs)
    })
    await vi.waitFor(() => {
      expect(requests).toHaveLength(2)
    })
    expect(readWorkspacePaneTabs()).toEqual(secondReorderTabs)

    await act(async () => {
      requests[0]!.reject(new Error('first reorder failed'))
      await flushMicrotasks()
    })
    expect(readWorkspacePaneTabs()).toEqual(secondReorderTabs)
    expect(onReorderRejected).toHaveBeenCalledTimes(1)

    await act(async () => {
      requests[1]!.resolve(secondReorderTabs)
      await flushMicrotasks()
    })
    await vi.waitFor(() => {
      expect(readWorkspacePaneTabs()).toEqual(secondReorderTabs)
    })
  })

  test('rolls query cache back and reports failure when the server rejects reorder', async () => {
    const onReorderRejected = vi.fn()
    installWorkspacePaneTabsTestBridge({
      updateWorkspaceTabs: async () => {
        throw new Error('server unavailable')
      },
    })
    const sourceTabs = [terminalEntry('term-111111111111111111111'), staticEntry('status')]
    const reorderedTabs = [staticEntry('status'), terminalEntry('term-111111111111111111111')]
    seedWorkspacePaneTabs(sourceTabs)
    renderMutationHook({ canonicalTabs: sourceTabs, onReorderRejected })

    act(() => {
      currentControls().reorderTabs(reorderedTabs)
    })

    await vi.waitFor(() => {
      expect(readWorkspacePaneTabs()).toEqual(sourceTabs)
      expect(onReorderRejected).toHaveBeenCalledTimes(1)
    })
  })

  test('does not roll cache back over a newer same-target projection after server reject', async () => {
    const requests = installDeferredUpdateWorkspaceTabs()
    const sourceTabs = [terminalEntry('term-111111111111111111111'), staticEntry('status')]
    const reorderedTabs = [staticEntry('status'), terminalEntry('term-111111111111111111111')]
    const newerProjectionTabs = [staticEntry('history'), terminalEntry('term-222222222222222222222')]
    seedWorkspacePaneTabs(sourceTabs)
    renderMutationHook({ canonicalTabs: sourceTabs })

    act(() => {
      currentControls().reorderTabs(reorderedTabs)
    })
    await vi.waitFor(() => {
      expect(readWorkspacePaneTabs()).toEqual(reorderedTabs)
      expect(requests).toHaveLength(1)
    })

    setWorkspacePaneTabsForTargetQueryData(
      {
        repoRoot: REPO_ROOT,
        repoRuntimeId: REPO_RUNTIME_ID,
        branchName: BRANCH_NAME,
        worktreePath: WORKTREE_PATH,
        tabs: newerProjectionTabs,
      },
      queryClient,
    )

    await act(async () => {
      requests[0]!.reject(new Error('server unavailable'))
      await flushMicrotasks()
    })

    await vi.waitFor(() => {
      expect(readWorkspacePaneTabs()).toEqual(newerProjectionTabs)
    })
  })

  test('rolls back only the failed branch when another branch updates while reorder is pending', async () => {
    const requests = installDeferredUpdateWorkspaceTabs()
    const sourceTabs = [terminalEntry('term-111111111111111111111'), staticEntry('status')]
    const reorderedTabs = [staticEntry('status'), terminalEntry('term-111111111111111111111')]
    const otherBranchName = 'feature/other'
    seedWorkspacePaneTabs(sourceTabs)
    setWorkspacePaneTabsForTargetQueryData(
      {
        repoRoot: REPO_ROOT,
        repoRuntimeId: REPO_RUNTIME_ID,
        branchName: otherBranchName,
        worktreePath: null,
        tabs: [staticEntry('status')],
      },
      queryClient,
    )
    renderMutationHook({ canonicalTabs: sourceTabs })

    act(() => {
      currentControls().reorderTabs(reorderedTabs)
    })
    await vi.waitFor(() => {
      expect(requests).toHaveLength(1)
    })
    setWorkspacePaneTabsForTargetQueryData(
      {
        repoRoot: REPO_ROOT,
        repoRuntimeId: REPO_RUNTIME_ID,
        branchName: otherBranchName,
        worktreePath: null,
        tabs: [staticEntry('history')],
      },
      queryClient,
    )

    await act(async () => {
      requests[0]!.reject(new Error('server unavailable'))
      await flushMicrotasks()
    })

    await vi.waitFor(() => {
      expect(readWorkspacePaneTabs()).toEqual(sourceTabs)
      expect(
        readWorkspacePaneTabsForTarget(
          {
            repoRoot: REPO_ROOT,
            repoRuntimeId: REPO_RUNTIME_ID,
            branchName: otherBranchName,
            worktreePath: null,
          },
          queryClient,
        ),
      ).toEqual([staticEntry('history')])
    })
  })

  test('does not commit no-op reorder', () => {
    const updateWorkspaceTabs = vi.fn(async () => [])
    installWorkspacePaneTabsTestBridge({ updateWorkspaceTabs })
    const sourceTabs = [terminalEntry('term-111111111111111111111'), staticEntry('status')]
    renderMutationHook({ canonicalTabs: sourceTabs })

    act(() => {
      currentControls().reorderTabs([...sourceTabs])
    })

    expect(updateWorkspaceTabs).not.toHaveBeenCalled()
  })

  test('uses the latest repo runtime when the repo runtime changes', async () => {
    const updateWorkspaceTabs = vi.fn(async (_input: WorkspacePaneTabsUpdateInput) => [
      staticEntry('status'),
      terminalEntry('term-111111111111111111111'),
    ])
    installWorkspacePaneTabsTestBridge({ updateWorkspaceTabs })
    const sourceTabs = [terminalEntry('term-111111111111111111111'), staticEntry('status')]
    const reorderedTabs = [staticEntry('status'), terminalEntry('term-111111111111111111111')]
    seedWorkspacePaneTabs(sourceTabs, NEXT_REPO_RUNTIME_ID)
    const renderResult = renderMutationHook({ canonicalTabs: sourceTabs })

    renderResult.rerender(
      <QueryClientProvider client={queryClient}>
        <HookHost
          input={{
            repoRoot: REPO_ROOT,
            repoRuntimeId: NEXT_REPO_RUNTIME_ID,
            branchName: BRANCH_NAME,
            worktreePath: WORKTREE_PATH,
            canonicalTabs: sourceTabs,
          }}
        />
      </QueryClientProvider>,
    )

    act(() => {
      currentControls().reorderTabs(reorderedTabs)
    })

    await vi.waitFor(() => {
      expect(updateWorkspaceTabs).toHaveBeenCalledWith({
        repoRoot: REPO_ROOT,
        repoRuntimeId: NEXT_REPO_RUNTIME_ID,
        branchName: BRANCH_NAME,
        worktreePath: WORKTREE_PATH,
        operation: {
          type: 'reorder',
          tabIdentities: ['workspace-pane:status', 'terminal:term-111111111111111111111'],
        },
      })
    })
    expect(readWorkspacePaneTabs(NEXT_REPO_RUNTIME_ID)).toEqual([staticEntry('status'), terminalEntry('term-111111111111111111111')])
  })
})

function renderMutationHook(input: Partial<WorkspacePaneTabsReorderMutationInput> = {}) {
  return renderInJsdom(
    <QueryClientProvider client={queryClient}>
      <HookHost
        input={{
          repoRoot: REPO_ROOT,
          repoRuntimeId: REPO_RUNTIME_ID,
          branchName: BRANCH_NAME,
          worktreePath: WORKTREE_PATH,
          canonicalTabs: [],
          ...input,
        }}
      />
    </QueryClientProvider>,
  )
}

function HookHost({ input }: { input: WorkspacePaneTabsReorderMutationInput }) {
  controls = useWorkspacePaneTabsReorderMutation(input)
  return null
}

function currentControls(): WorkspacePaneTabsReorderMutationResult {
  if (!controls) throw new Error('missing workspace pane tabs mutation controls')
  return controls
}

function readWorkspacePaneTabs(repoRuntimeId: string = REPO_RUNTIME_ID): WorkspacePaneTabEntry[] {
  return readWorkspacePaneTabsForTarget(
    {
      repoRoot: REPO_ROOT,
      repoRuntimeId,
      branchName: BRANCH_NAME,
      worktreePath: WORKTREE_PATH,
    },
    queryClient,
  )
}

function seedWorkspacePaneTabs(tabs: WorkspacePaneTabEntry[], repoRuntimeId: string = REPO_RUNTIME_ID): void {
  setWorkspacePaneTabsForTargetQueryData(
    {
      repoRoot: REPO_ROOT,
      repoRuntimeId,
      branchName: BRANCH_NAME,
      worktreePath: WORKTREE_PATH,
      tabs,
    },
    queryClient,
  )
}

function entry(tabs: WorkspacePaneTabEntry[]): WorkspacePaneTabsEntry {
  return {
    repoRoot: REPO_ROOT,
    branchName: BRANCH_NAME,
    worktreePath: WORKTREE_PATH,
    tabs,
  }
}

function seedWorkspacePaneTabsRepo(repoRuntimeId: string): void {
  seedRepoWithReadModelForTest({
    id: REPO_ROOT,
    repoRuntimeId: repoRuntimeId,
    branches: [createRepoBranch(BRANCH_NAME, { worktree: { path: WORKTREE_PATH } })],
    currentBranchName: BRANCH_NAME,
  })
}

function installDeferredUpdateWorkspaceTabs(): DeferredUpdateWorkspaceTabsRequest[] {
  const requests: DeferredUpdateWorkspaceTabsRequest[] = []
  installWorkspacePaneTabsTestBridge({
    updateWorkspaceTabs: async (input) =>
      await new Promise<WorkspacePaneTabEntry[]>((resolve, reject) => {
        requests.push({ input, resolve, reject })
      }),
  })
  return requests
}

function terminalEntry(sessionId: string): WorkspacePaneTabEntry {
  return workspacePaneRuntimeTabEntry('terminal', sessionId)
}

function staticEntry(type: Parameters<typeof workspacePaneStaticTabEntry>[0]): WorkspacePaneTabEntry {
  return workspacePaneStaticTabEntry(type)
}
