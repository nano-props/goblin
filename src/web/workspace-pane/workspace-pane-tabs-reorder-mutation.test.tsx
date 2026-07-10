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
import { readWorkspacePaneTabsForTarget } from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import { setWorkspacePaneTabsForTargetQueryData } from '#/web/test-utils/workspace-pane-tabs.ts'
import {
  type WorkspacePaneTabsReorderMutationInput,
  type WorkspacePaneTabsReorderMutationResult,
  useWorkspacePaneTabsReorderMutation,
} from '#/web/workspace-pane/workspace-pane-tabs-reorder-mutation.ts'
import { workspacePaneRuntimeTabEntry, workspacePaneStaticTabEntry } from '#/shared/workspace-pane.ts'
import type { WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
import type { WorkspacePaneTabsUpdateInput } from '#/shared/workspace-pane-tabs.ts'
import { resetWorkspacePaneTabCoordinatorForTest } from '#/web/workspace-pane/workspace-pane-tab-coordinator.ts'

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
  resetWorkspacePaneTabCoordinatorForTest()
  resetReposStore()
  seedWorkspacePaneTabsRepo(REPO_RUNTIME_ID)
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  controls = null
})

afterEach(() => {
  resetWorkspacePaneTabCoordinatorForTest()
  queryClient.clear()
  resetReposStore()
  setClientBridgeForTests(null)
  controls = null
})

describe('useWorkspacePaneTabsReorderMutation', () => {
  test('waits for the server and then applies its canonical snapshot without an optimistic write', async () => {
    const serverTabs = Promise.withResolvers<WorkspacePaneTabEntry[]>()
    installWorkspacePaneTabsTestBridge({ updateWorkspaceTabs: async () => await serverTabs.promise })
    const sourceTabs = [terminalEntry('term-111111111111111111111'), staticEntry('status')]
    const reorderedTabs = [staticEntry('status'), terminalEntry('term-111111111111111111111')]
    const canonicalServerTabs = [staticEntry('history'), terminalEntry('term-111111111111111111111')]
    seedWorkspacePaneTabs(sourceTabs)
    renderMutationHook({ canonicalTabs: sourceTabs })

    act(() => currentControls().reorderTabs(reorderedTabs))
    await flushMicrotasks()
    expect(readWorkspacePaneTabs()).toEqual(sourceTabs)

    serverTabs.resolve(canonicalServerTabs)
    await vi.waitFor(() => expect(readWorkspacePaneTabs()).toEqual(canonicalServerTabs))
  })

  test('serializes consecutive server reorders through the workspace-pane coordinator', async () => {
    const requests = installDeferredUpdateWorkspaceTabs()
    const sourceTabs = [terminalEntry('term-111111111111111111111'), staticEntry('status'), staticEntry('history')]
    const firstTabs = [staticEntry('status'), terminalEntry('term-111111111111111111111'), staticEntry('history')]
    const secondTabs = [staticEntry('history'), staticEntry('status'), terminalEntry('term-111111111111111111111')]
    seedWorkspacePaneTabs(sourceTabs)
    renderMutationHook({ canonicalTabs: sourceTabs })

    act(() => currentControls().reorderTabs(firstTabs))
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    act(() => currentControls().reorderTabs(secondTabs))
    await flushMicrotasks()
    expect(requests).toHaveLength(1)
    expect(readWorkspacePaneTabs()).toEqual(sourceTabs)

    requests[0]!.resolve(firstTabs)
    await vi.waitFor(() => expect(requests).toHaveLength(2))
    expect(readWorkspacePaneTabs()).toEqual(firstTabs)
    expect(requests[1]!.input.operation).toEqual({
      type: 'reorder',
      tabIdentities: ['workspace-pane:history', 'workspace-pane:status', 'terminal:term-111111111111111111111'],
    })

    requests[1]!.resolve(secondTabs)
    await vi.waitFor(() => expect(readWorkspacePaneTabs()).toEqual(secondTabs))
  })

  test('reports failure without mutating or rolling back the canonical cache', async () => {
    const onReorderRejected = vi.fn()
    installWorkspacePaneTabsTestBridge({
      updateWorkspaceTabs: async () => {
        throw new Error('server unavailable')
      },
    })
    const sourceTabs = [terminalEntry('term-111111111111111111111'), staticEntry('status')]
    seedWorkspacePaneTabs(sourceTabs)
    renderMutationHook({ canonicalTabs: sourceTabs, onReorderRejected })

    act(() => currentControls().reorderTabs([...sourceTabs].reverse()))

    await vi.waitFor(() => expect(onReorderRejected).toHaveBeenCalledOnce())
    expect(readWorkspacePaneTabs()).toEqual(sourceTabs)
  })

  test('does not send a no-op reorder', () => {
    const updateWorkspaceTabs = vi.fn(async () => [] as WorkspacePaneTabEntry[])
    installWorkspacePaneTabsTestBridge({ updateWorkspaceTabs })
    const sourceTabs = [terminalEntry('term-111111111111111111111'), staticEntry('status')]
    renderMutationHook({ canonicalTabs: sourceTabs })

    act(() => currentControls().reorderTabs([...sourceTabs]))

    expect(updateWorkspaceTabs).not.toHaveBeenCalled()
  })

  test('uses the latest repo runtime after the hook target changes', async () => {
    const updateWorkspaceTabs = vi.fn(async () => [staticEntry('status')])
    installWorkspacePaneTabsTestBridge({ updateWorkspaceTabs })
    const sourceTabs = [terminalEntry('term-111111111111111111111'), staticEntry('status')]
    const reorderedTabs = [staticEntry('status'), terminalEntry('term-111111111111111111111')]
    seedWorkspacePaneTabs(sourceTabs, NEXT_REPO_RUNTIME_ID)
    const renderResult = renderMutationHook({ canonicalTabs: sourceTabs })
    seedWorkspacePaneTabsRepo(NEXT_REPO_RUNTIME_ID)

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
    act(() => currentControls().reorderTabs(reorderedTabs))

    await vi.waitFor(() =>
      expect(updateWorkspaceTabs).toHaveBeenCalledWith({
        repoRoot: REPO_ROOT,
        repoRuntimeId: NEXT_REPO_RUNTIME_ID,
        branchName: BRANCH_NAME,
        worktreePath: WORKTREE_PATH,
        operation: {
          type: 'reorder',
          tabIdentities: ['workspace-pane:status', 'terminal:term-111111111111111111111'],
        },
      }),
    )
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
    { repoRoot: REPO_ROOT, repoRuntimeId, branchName: BRANCH_NAME, worktreePath: WORKTREE_PATH },
    queryClient,
  )
}

function seedWorkspacePaneTabs(tabs: WorkspacePaneTabEntry[], repoRuntimeId: string = REPO_RUNTIME_ID): void {
  setWorkspacePaneTabsForTargetQueryData(
    { repoRoot: REPO_ROOT, repoRuntimeId, branchName: BRANCH_NAME, worktreePath: WORKTREE_PATH, tabs },
    queryClient,
  )
}

function seedWorkspacePaneTabsRepo(repoRuntimeId: string): void {
  seedRepoWithReadModelForTest({
    id: REPO_ROOT,
    repoRuntimeId,
    branches: [createRepoBranch(BRANCH_NAME, { worktree: { path: WORKTREE_PATH } })],
    currentBranchName: BRANCH_NAME,
  })
}

function installDeferredUpdateWorkspaceTabs(): DeferredUpdateWorkspaceTabsRequest[] {
  const requests: DeferredUpdateWorkspaceTabsRequest[] = []
  installWorkspacePaneTabsTestBridge({
    updateWorkspaceTabs: async (input) =>
      await new Promise<WorkspacePaneTabEntry[]>((resolve, reject) => requests.push({ input, resolve, reject })),
  })
  return requests
}

function terminalEntry(sessionId: string): WorkspacePaneTabEntry {
  return workspacePaneRuntimeTabEntry('terminal', sessionId)
}

function staticEntry(type: Parameters<typeof workspacePaneStaticTabEntry>[0]): WorkspacePaneTabEntry {
  return workspacePaneStaticTabEntry(type)
}
