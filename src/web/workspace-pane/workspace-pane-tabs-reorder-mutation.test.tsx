// @vitest-environment jsdom

import { resetWorkspacesStore, seedRepoWithReadModelForTest, createRepoBranch } from '#/web/test-utils/repo-store.ts'
import { flushTestUpdates } from '#/test-utils/render.tsx'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { QueryClient } from '@tanstack/vue-query'
import { defineComponent } from 'vue'
import { VueQueryClientScope } from '#/web/test-utils/VueQueryClientScope.tsx'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { flushMicrotasks } from '#/test-utils/microtasks.ts'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { setClientBridgeForTests } from '#/web/client-bridge.ts'
import { installWorkspacePaneTabsTestBridge } from '#/web/test-utils/workspace-pane-bridge.ts'
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
import { resetWorkspacePaneActionQueueForTest } from '#/web/workspace-pane/workspace-pane-action-queue.ts'
import { ClientRealtimeRequestError } from '#/web/realtime/client-realtime-request-error.ts'

const feedbackMocks = vi.hoisted(() => ({ error: vi.fn(), warning: vi.fn() }))

vi.mock('vue-sonner', () => ({ toast: feedbackMocks }))

const REPO_ROOT = workspaceIdForTest('goblin+file:///tmp/workspace-pane-tabs-reorder-mutation-repo')
const WORKSPACE_RUNTIME_ID = 'repo-runtime-test'
const NEXT_WORKSPACE_RUNTIME_ID = 'repo-runtime-next'
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
  feedbackMocks.error.mockClear()
  feedbackMocks.warning.mockClear()
  resetWorkspacePaneActionQueueForTest()
  resetWorkspacesStore()
  seedWorkspacePaneTabsRepo(WORKSPACE_RUNTIME_ID)
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  controls = null
})

afterEach(() => {
  resetWorkspacePaneActionQueueForTest()
  queryClient.clear()
  resetWorkspacesStore()
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

    await flushTestUpdates(() => currentControls().reorderTabs(reorderedTabs))
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

    await flushTestUpdates(() => currentControls().reorderTabs(firstTabs))
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    await flushTestUpdates(() => currentControls().reorderTabs(secondTabs))
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

  test.each([
    {
      label: 'a rejected reorder',
      failure: new Error('server unavailable'),
      feedback: 'error' as const,
      messageKey: 'error.workspace-operation-failed',
      toastId: 'workspace-pane-tabs-reorder-failed',
    },
    {
      label: 'an indeterminate transport outcome',
      failure: new ClientRealtimeRequestError('response was lost', {
        kind: 'timeout',
        delivery: 'indeterminate',
        outageId: 1,
      }),
      feedback: 'warning' as const,
      messageKey: 'error.workspace-tabs-outcome-uncertain',
      toastId: 'workspace-pane-tabs-outcome-uncertain',
    },
  ])('surfaces $label without mutating or rolling back the canonical cache', async (input) => {
    const onSettled = vi.fn()
    installWorkspacePaneTabsTestBridge({
      updateWorkspaceTabs: async () => {
        throw input.failure
      },
    })
    const sourceTabs = [terminalEntry('term-111111111111111111111'), staticEntry('status')]
    seedWorkspacePaneTabs(sourceTabs)
    renderMutationHook({ canonicalTabs: sourceTabs })

    await flushTestUpdates(() => currentControls().reorderTabs([...sourceTabs].reverse(), onSettled))

    await vi.waitFor(() => expect(onSettled).toHaveBeenCalledOnce())
    expect(readWorkspacePaneTabs()).toEqual(sourceTabs)
    expect(feedbackMocks[input.feedback]).toHaveBeenCalledWith(input.messageKey, { id: input.toastId })
  })

  test('does not send a no-op reorder', async () => {
    const updateWorkspaceTabs = vi.fn(async () => [] as WorkspacePaneTabEntry[])
    installWorkspacePaneTabsTestBridge({ updateWorkspaceTabs })
    const sourceTabs = [terminalEntry('term-111111111111111111111'), staticEntry('status')]
    renderMutationHook({ canonicalTabs: sourceTabs })

    await flushTestUpdates(() => currentControls().reorderTabs([...sourceTabs]))

    expect(updateWorkspaceTabs).not.toHaveBeenCalled()
  })

  test('uses the latest workspace runtime after the hook target changes', async () => {
    const updateWorkspaceTabs = vi.fn(async () => [staticEntry('status')])
    installWorkspacePaneTabsTestBridge({ updateWorkspaceTabs })
    const sourceTabs = [terminalEntry('term-111111111111111111111'), staticEntry('status')]
    const reorderedTabs = [staticEntry('status'), terminalEntry('term-111111111111111111111')]
    seedWorkspacePaneTabs(sourceTabs, NEXT_WORKSPACE_RUNTIME_ID)
    const renderResult = renderMutationHook({ canonicalTabs: sourceTabs })
    seedWorkspacePaneTabsRepo(NEXT_WORKSPACE_RUNTIME_ID)

    await renderResult.rerender(
      <VueQueryClientScope client={queryClient}>
        <HookHost
          input={{
            kind: 'git-worktree' as const,
            workspaceId: REPO_ROOT,
            workspaceRuntimeId: NEXT_WORKSPACE_RUNTIME_ID,
            worktreePath: WORKTREE_PATH,
            canonicalTabs: sourceTabs,
          }}
        />
      </VueQueryClientScope>,
    )
    await flushTestUpdates(() => currentControls().reorderTabs(reorderedTabs))

    await vi.waitFor(() =>
      expect(updateWorkspaceTabs).toHaveBeenCalledWith({
        workspaceId: REPO_ROOT,
        workspaceRuntimeId: NEXT_WORKSPACE_RUNTIME_ID,
        target: {
          kind: 'git-worktree' as const,
          workspaceId: REPO_ROOT,
          workspaceRuntimeId: NEXT_WORKSPACE_RUNTIME_ID,
          root: 'goblin+file:///tmp/workspace-pane-tabs-reorder-mutation-worktree',
        },
        operation: {
          type: 'reorder',
          tabIdentities: ['workspace-pane:status', 'terminal:term-111111111111111111111'],
        },
      }),
    )
  })

  test('preserves the workspace-root target through the reorder transaction', async () => {
    const updateWorkspaceTabs = vi.fn(async () => [staticEntry('files'), staticEntry('status')])
    installWorkspacePaneTabsTestBridge({ updateWorkspaceTabs })
    const sourceTabs = [staticEntry('status'), staticEntry('files')]
    setWorkspacePaneTabsForTargetQueryData(
      {
        kind: 'workspace-root',
        workspaceId: REPO_ROOT,
        workspaceRuntimeId: WORKSPACE_RUNTIME_ID,

        tabs: sourceTabs,
      },
      queryClient,
    )
    renderMutationHook({ kind: 'workspace-root', canonicalTabs: sourceTabs })

    await flushTestUpdates(() => currentControls().reorderTabs([...sourceTabs].reverse()))

    await vi.waitFor(() =>
      expect(updateWorkspaceTabs).toHaveBeenCalledWith({
        workspaceId: REPO_ROOT,
        workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
        target: {
          kind: 'workspace-root',
          workspaceId: REPO_ROOT,
          workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
        },
        operation: {
          type: 'reorder',
          tabIdentities: ['workspace-pane:files', 'workspace-pane:status'],
        },
      }),
    )
  })
})

function renderMutationHook(
  input: {
    kind?: 'git-worktree' | 'workspace-root'
    canonicalTabs?: WorkspacePaneTabEntry[]
  } = {},
) {
  const target =
    input.kind === 'workspace-root'
      ? { kind: 'workspace-root' as const, workspaceId: REPO_ROOT }
      : {
          kind: 'git-worktree' as const,
          workspaceId: REPO_ROOT,
          worktreePath: WORKTREE_PATH,
        }
  return renderInJsdom(
    <VueQueryClientScope client={queryClient}>
      <HookHost
        input={{
          ...target,
          workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
          canonicalTabs: input.canonicalTabs ?? [],
        }}
      />
    </VueQueryClientScope>,
  )
}

const HookHost = defineComponent<{ input: WorkspacePaneTabsReorderMutationInput }>({
  name: 'WorkspacePaneTabsReorderMutationTestHost',
  props: ['input'],
  setup(props) {
    controls = useWorkspacePaneTabsReorderMutation(() => props.input)
    return () => null
  },
})

function currentControls(): WorkspacePaneTabsReorderMutationResult {
  if (!controls) throw new Error('missing workspace pane tabs mutation controls')
  return controls
}

function readWorkspacePaneTabs(workspaceRuntimeId: string = WORKSPACE_RUNTIME_ID): WorkspacePaneTabEntry[] {
  return readWorkspacePaneTabsForTarget(
    {
      kind: 'git-worktree',
      workspaceId: REPO_ROOT,
      workspaceRuntimeId,
      worktreePath: WORKTREE_PATH,
    },
    queryClient,
  )
}

function seedWorkspacePaneTabs(tabs: WorkspacePaneTabEntry[], workspaceRuntimeId: string = WORKSPACE_RUNTIME_ID): void {
  setWorkspacePaneTabsForTargetQueryData(
    { workspaceId: REPO_ROOT, workspaceRuntimeId, branchName: BRANCH_NAME, worktreePath: WORKTREE_PATH, tabs },
    queryClient,
  )
}

function seedWorkspacePaneTabsRepo(workspaceRuntimeId: string): void {
  seedRepoWithReadModelForTest({
    id: REPO_ROOT,
    workspaceRuntimeId,
    branches: [createRepoBranch(BRANCH_NAME, { worktree: { path: WORKTREE_PATH, isPrimary: false, isLocked: false } })],
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
