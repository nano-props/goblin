// @vitest-environment jsdom

import { act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { flushMicrotasks, renderInJsdom } from '#/test-utils/render.tsx'
import { setClientBridgeForTests } from '#/web/client-bridge.ts'
import { installWorkspacePaneTabsTestBridge, resetReposStore } from '#/web/test-utils/bridge.ts'
import {
  readWorkspacePaneTabsForTarget,
  setWorkspacePaneTabsForTargetQueryData,
  workspacePaneTabsQueryOptions,
} from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import {
  type WorkspacePaneTabsReorderMutationInput,
  type WorkspacePaneTabsReorderMutationResult,
  useWorkspacePaneTabsReorderMutation,
} from '#/web/workspace-pane/workspace-pane-tabs-reorder-mutation.ts'
import { workspacePaneStaticTabEntry, workspacePaneTerminalTabEntry } from '#/shared/workspace-pane.ts'
import type { WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
import type { TerminalUpdateWorkspaceTabsInput, WorkspacePaneTabsEntry } from '#/shared/terminal-types.ts'
import { clearWorkspacePaneTabsOperationQueuesForTests } from '#/web/workspace-pane/workspace-pane-tabs-operation-queue.ts'

const REPO_ROOT = '/tmp/workspace-pane-tabs-reorder-mutation-repo'
const REPO_INSTANCE_ID = 'repo-instance-test'
const BRANCH_NAME = 'feature/worktree'
const WORKTREE_PATH = '/tmp/workspace-pane-tabs-reorder-mutation-worktree'

interface DeferredUpdateWorkspaceTabsRequest {
  input: TerminalUpdateWorkspaceTabsInput
  resolve: (tabs: WorkspacePaneTabEntry[]) => void
  reject: (err: unknown) => void
}

let queryClient: QueryClient
let controls: WorkspacePaneTabsReorderMutationResult | null = null

beforeEach(() => {
  clearWorkspacePaneTabsOperationQueuesForTests()
  resetReposStore()
  queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  controls = null
})

afterEach(() => {
  clearWorkspacePaneTabsOperationQueuesForTests()
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
    const sourceTabs = [terminalEntry('session-1'), staticEntry('status')]
    const reorderedTabs = [staticEntry('status'), terminalEntry('session-1')]
    const canonicalServerTabs = [terminalEntry('session-1'), staticEntry('status')]
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
    const sourceTabs = [terminalEntry('session-1'), staticEntry('status')]
    const reorderedTabs = [staticEntry('status'), terminalEntry('session-1')]
    const canonicalServerTabs = [terminalEntry('session-1'), staticEntry('history')]
    seedWorkspacePaneTabs(sourceTabs)
    renderMutationHook({ canonicalTabs: sourceTabs })

    act(() => {
      currentControls().reorderTabs(reorderedTabs)
    })
    await updateStarted
    const fetch = queryClient.fetchQuery(workspacePaneTabsQueryOptions(REPO_ROOT, REPO_INSTANCE_ID)).catch(() => null)

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

  test('queues reorders and recomputes the next reorder from current cached tabs', async () => {
    const sourceTabs = [terminalEntry('session-1'), staticEntry('status'), staticEntry('history')]
    const requests = installDeferredUpdateWorkspaceTabs()
    const firstReorderTabs = [staticEntry('status'), terminalEntry('session-1'), staticEntry('history')]
    const secondDraggedTabs = [terminalEntry('session-1'), staticEntry('status')]
    const expectedSecondCommitTabs = [terminalEntry('session-1'), staticEntry('status'), staticEntry('history')]
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
    expect(readWorkspacePaneTabs()).toEqual(firstReorderTabs)

    await act(async () => {
      requests[0]!.resolve(firstReorderTabs)
      await flushMicrotasks()
    })
    await vi.waitFor(() => {
      expect(requests).toHaveLength(2)
    })
    expect(requests[1]!.input.operation).toEqual({
      type: 'reorder',
      tabIdentities: ['terminal:session-1', 'workspace-pane:status'],
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

  test('continues to the next queued reorder after an earlier reorder fails', async () => {
    const onReorderRejected = vi.fn()
    const sourceTabs = [terminalEntry('session-1'), staticEntry('status'), staticEntry('history')]
    const requests = installDeferredUpdateWorkspaceTabs()
    const firstReorderTabs = [staticEntry('status'), terminalEntry('session-1'), staticEntry('history')]
    const secondReorderTabs = [staticEntry('history'), staticEntry('status'), terminalEntry('session-1')]
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
    expect(readWorkspacePaneTabs()).toEqual(firstReorderTabs)

    await act(async () => {
      requests[0]!.reject(new Error('first reorder failed'))
      await flushMicrotasks()
    })
    await vi.waitFor(() => {
      expect(requests).toHaveLength(2)
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
    const sourceTabs = [terminalEntry('session-1'), staticEntry('status')]
    const reorderedTabs = [staticEntry('status'), terminalEntry('session-1')]
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

  test('rolls back only the failed branch when another branch updates while reorder is pending', async () => {
    const requests = installDeferredUpdateWorkspaceTabs()
    const sourceTabs = [terminalEntry('session-1'), staticEntry('status')]
    const reorderedTabs = [staticEntry('status'), terminalEntry('session-1')]
    const otherBranchName = 'feature/other'
    seedWorkspacePaneTabs(sourceTabs)
    setWorkspacePaneTabsForTargetQueryData(
      {
        repoRoot: REPO_ROOT,
        repoInstanceId: REPO_INSTANCE_ID,
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
        repoInstanceId: REPO_INSTANCE_ID,
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
            repoInstanceId: REPO_INSTANCE_ID,
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
    const sourceTabs = [terminalEntry('session-1'), staticEntry('status')]
    renderMutationHook({ canonicalTabs: sourceTabs })

    act(() => {
      currentControls().reorderTabs([...sourceTabs])
    })

    expect(updateWorkspaceTabs).not.toHaveBeenCalled()
  })
})

function renderMutationHook(input: Partial<WorkspacePaneTabsReorderMutationInput> = {}) {
  return renderInJsdom(
    <QueryClientProvider client={queryClient}>
      <HookHost
        input={{
          repoRoot: REPO_ROOT,
          repoInstanceId: REPO_INSTANCE_ID,
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

function readWorkspacePaneTabs(): WorkspacePaneTabEntry[] {
  return readWorkspacePaneTabsForTarget(
    {
      repoRoot: REPO_ROOT,
      repoInstanceId: REPO_INSTANCE_ID,
      branchName: BRANCH_NAME,
      worktreePath: WORKTREE_PATH,
    },
    queryClient,
  )
}

function seedWorkspacePaneTabs(tabs: WorkspacePaneTabEntry[]): void {
  setWorkspacePaneTabsForTargetQueryData(
    {
      repoRoot: REPO_ROOT,
      repoInstanceId: REPO_INSTANCE_ID,
      branchName: BRANCH_NAME,
      worktreePath: WORKTREE_PATH,
      tabs,
    },
    queryClient,
  )
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
  return workspacePaneTerminalTabEntry(sessionId)
}

function staticEntry(type: Parameters<typeof workspacePaneStaticTabEntry>[0]): WorkspacePaneTabEntry {
  return workspacePaneStaticTabEntry(type)
}
