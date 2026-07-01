// @vitest-environment jsdom

import { act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { flushMicrotasks, renderInJsdom } from '#/test-utils/render.tsx'
import { setClientBridgeForTests } from '#/web/client-bridge.ts'
import {
  installWorkspacePaneTabsTestBridge,
  resetReposStore,
} from '#/web/test-utils/bridge.ts'
import {
  readWorkspacePaneTabsForBranch,
  setWorkspacePaneTabsForBranchQueryData,
} from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import {
  type WorkspacePaneTabsReorderMutationInput,
  type WorkspacePaneTabsReorderMutationResult,
  useWorkspacePaneTabsReorderMutation,
} from '#/web/workspace-pane/workspace-pane-tabs-reorder-mutation.ts'
import { workspacePaneStaticTabEntry, workspacePaneTerminalTabEntry } from '#/shared/workspace-pane.ts'
import type { WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
import type { TerminalReplaceWorkspaceTabsInput } from '#/shared/terminal-types.ts'

const REPO_ROOT = '/tmp/workspace-pane-tabs-reorder-mutation-repo'
const BRANCH_NAME = 'feature/worktree'
const WORKTREE_PATH = '/tmp/workspace-pane-tabs-reorder-mutation-worktree'

interface DeferredReplaceWorkspaceTabsRequest {
  input: TerminalReplaceWorkspaceTabsInput
  resolve: (tabs: WorkspacePaneTabEntry[]) => void
  reject: (err: unknown) => void
}

let queryClient: QueryClient
let controls: WorkspacePaneTabsReorderMutationResult | null = null

beforeEach(() => {
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
      replaceWorkspaceTabs: async () => await serverTabs,
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
      expect(readWorkspacePaneTabsForBranch(REPO_ROOT, BRANCH_NAME, queryClient)).toEqual(reorderedTabs)
    })

    resolveServerTabs(canonicalServerTabs)

    await vi.waitFor(() => {
      expect(readWorkspacePaneTabsForBranch(REPO_ROOT, BRANCH_NAME, queryClient)).toEqual(canonicalServerTabs)
    })
  })

  test('does not let an older server response overwrite a newer optimistic reorder', async () => {
    const requests = installDeferredReplaceWorkspaceTabs()
    const sourceTabs = [terminalEntry('session-1'), staticEntry('status'), staticEntry('history')]
    const firstReorderTabs = [staticEntry('status'), terminalEntry('session-1'), staticEntry('history')]
    const secondReorderTabs = [staticEntry('history'), staticEntry('status'), terminalEntry('session-1')]
    seedWorkspacePaneTabs(sourceTabs)
    renderMutationHook({ canonicalTabs: sourceTabs })

    act(() => {
      currentControls().reorderTabs(firstReorderTabs)
    })
    await vi.waitFor(() => {
      expect(readWorkspacePaneTabsForBranch(REPO_ROOT, BRANCH_NAME, queryClient)).toEqual(firstReorderTabs)
      expect(requests).toHaveLength(1)
    })

    act(() => {
      currentControls().reorderTabs(secondReorderTabs)
    })
    await vi.waitFor(() => {
      expect(readWorkspacePaneTabsForBranch(REPO_ROOT, BRANCH_NAME, queryClient)).toEqual(secondReorderTabs)
    })

    await act(async () => {
      requests[0]!.resolve(firstReorderTabs)
      await flushMicrotasks()
    })
    await vi.waitFor(() => {
      expect(requests).toHaveLength(2)
    })
    expect(readWorkspacePaneTabsForBranch(REPO_ROOT, BRANCH_NAME, queryClient)).toEqual(secondReorderTabs)

    await act(async () => {
      requests[1]!.resolve(secondReorderTabs)
      await flushMicrotasks()
    })
    await vi.waitFor(() => {
      expect(readWorkspacePaneTabsForBranch(REPO_ROOT, BRANCH_NAME, queryClient)).toEqual(secondReorderTabs)
    })
  })

  test('does not roll back a newer optimistic reorder when an older reorder fails', async () => {
    const onReorderRejected = vi.fn()
    const requests = installDeferredReplaceWorkspaceTabs()
    const sourceTabs = [terminalEntry('session-1'), staticEntry('status'), staticEntry('history')]
    const firstReorderTabs = [staticEntry('status'), terminalEntry('session-1'), staticEntry('history')]
    const secondReorderTabs = [staticEntry('history'), staticEntry('status'), terminalEntry('session-1')]
    seedWorkspacePaneTabs(sourceTabs)
    renderMutationHook({ canonicalTabs: sourceTabs, onReorderRejected })

    act(() => {
      currentControls().reorderTabs(firstReorderTabs)
    })
    await vi.waitFor(() => {
      expect(readWorkspacePaneTabsForBranch(REPO_ROOT, BRANCH_NAME, queryClient)).toEqual(firstReorderTabs)
      expect(requests).toHaveLength(1)
    })

    act(() => {
      currentControls().reorderTabs(secondReorderTabs)
    })
    await vi.waitFor(() => {
      expect(readWorkspacePaneTabsForBranch(REPO_ROOT, BRANCH_NAME, queryClient)).toEqual(secondReorderTabs)
    })

    await act(async () => {
      requests[0]!.reject(new Error('first reorder failed'))
      await flushMicrotasks()
    })
    await vi.waitFor(() => {
      expect(requests).toHaveLength(2)
    })
    expect(readWorkspacePaneTabsForBranch(REPO_ROOT, BRANCH_NAME, queryClient)).toEqual(secondReorderTabs)
    expect(onReorderRejected).not.toHaveBeenCalled()

    await act(async () => {
      requests[1]!.resolve(secondReorderTabs)
      await flushMicrotasks()
    })
    await vi.waitFor(() => {
      expect(readWorkspacePaneTabsForBranch(REPO_ROOT, BRANCH_NAME, queryClient)).toEqual(secondReorderTabs)
    })
  })

  test('rolls query cache back and reports failure when the server rejects reorder', async () => {
    const onReorderRejected = vi.fn()
    installWorkspacePaneTabsTestBridge({
      replaceWorkspaceTabs: async () => {
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
      expect(readWorkspacePaneTabsForBranch(REPO_ROOT, BRANCH_NAME, queryClient)).toEqual(sourceTabs)
      expect(onReorderRejected).toHaveBeenCalledTimes(1)
    })
  })

  test('clears optimistic query data when a failed reorder has no previous cache', async () => {
    const onReorderRejected = vi.fn()
    installWorkspacePaneTabsTestBridge({
      replaceWorkspaceTabs: async () => {
        throw new Error('server unavailable')
      },
    })
    const sourceTabs = [staticEntry('status')]
    const reorderedTabs = [staticEntry('status'), terminalEntry('session-1')]
    renderMutationHook({ canonicalTabs: sourceTabs, onReorderRejected })

    act(() => {
      currentControls().reorderTabs(reorderedTabs)
    })

    await vi.waitFor(() => {
      expect(readWorkspacePaneTabsForBranch(REPO_ROOT, BRANCH_NAME, queryClient)).toEqual(sourceTabs)
      expect(onReorderRejected).toHaveBeenCalledTimes(1)
    })
  })

  test('does not commit no-op reorder', () => {
    const replaceWorkspaceTabs = vi.fn(async (input: TerminalReplaceWorkspaceTabsInput) => [...input.tabs])
    installWorkspacePaneTabsTestBridge({ replaceWorkspaceTabs })
    const sourceTabs = [terminalEntry('session-1'), staticEntry('status')]
    renderMutationHook({ canonicalTabs: sourceTabs })

    act(() => {
      currentControls().reorderTabs([...sourceTabs])
    })

    expect(replaceWorkspaceTabs).not.toHaveBeenCalled()
  })
})

function renderMutationHook(input: Partial<WorkspacePaneTabsReorderMutationInput> = {}) {
  return renderInJsdom(
    <QueryClientProvider client={queryClient}>
      <HookHost
        input={{
          repoRoot: REPO_ROOT,
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

function seedWorkspacePaneTabs(tabs: WorkspacePaneTabEntry[]): void {
  setWorkspacePaneTabsForBranchQueryData(
    {
      repoRoot: REPO_ROOT,
      branchName: BRANCH_NAME,
      worktreePath: WORKTREE_PATH,
      tabs,
    },
    queryClient,
  )
}

function installDeferredReplaceWorkspaceTabs(): DeferredReplaceWorkspaceTabsRequest[] {
  const requests: DeferredReplaceWorkspaceTabsRequest[] = []
  installWorkspacePaneTabsTestBridge({
    replaceWorkspaceTabs: async (input) =>
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
