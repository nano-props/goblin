// @vitest-environment jsdom

import { act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { setClientBridgeForTests } from '#/web/client-bridge.ts'
import {
  installWorkspacePaneTabsTestBridge,
  resetReposStore,
} from '#/web/test-utils/bridge.ts'
import {
  readWorkspacePaneTabsForBranch,
  setWorkspacePaneTabsForBranchQueryData,
} from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import { useWorkspacePaneTabsReorderMutation } from '#/web/workspace-pane/workspace-pane-tabs-reorder-mutation.ts'
import { workspacePaneStaticTabEntry, workspacePaneTerminalTabEntry } from '#/shared/workspace-pane.ts'
import type { WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
import type { TerminalReplaceWorkspaceTabsInput } from '#/shared/terminal-types.ts'

const REPO_ROOT = '/tmp/workspace-pane-tabs-reorder-mutation-repo'
const BRANCH_NAME = 'feature/worktree'
const WORKTREE_PATH = '/tmp/workspace-pane-tabs-reorder-mutation-worktree'

let queryClient: QueryClient
let controls: WorkspacePaneTabsReorderMutationControls | null = null

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

  test('rolls query cache back and reports failure when the server rejects reorder', async () => {
    const onReorderError = vi.fn()
    installWorkspacePaneTabsTestBridge({
      replaceWorkspaceTabs: async () => {
        throw new Error('server unavailable')
      },
    })
    const sourceTabs = [terminalEntry('session-1'), staticEntry('status')]
    const reorderedTabs = [staticEntry('status'), terminalEntry('session-1')]
    seedWorkspacePaneTabs(sourceTabs)
    renderMutationHook({ canonicalTabs: sourceTabs, onReorderError })

    act(() => {
      currentControls().reorderTabs(reorderedTabs)
    })

    await vi.waitFor(() => {
      expect(readWorkspacePaneTabsForBranch(REPO_ROOT, BRANCH_NAME, queryClient)).toEqual(sourceTabs)
      expect(onReorderError).toHaveBeenCalledTimes(1)
    })
  })

  test('clears optimistic query data when a failed reorder has no previous cache', async () => {
    const onReorderError = vi.fn()
    installWorkspacePaneTabsTestBridge({
      replaceWorkspaceTabs: async () => {
        throw new Error('server unavailable')
      },
    })
    const sourceTabs = [staticEntry('status')]
    const reorderedTabs = [staticEntry('status'), terminalEntry('session-1')]
    renderMutationHook({ canonicalTabs: sourceTabs, onReorderError })

    act(() => {
      currentControls().reorderTabs(reorderedTabs)
    })

    await vi.waitFor(() => {
      expect(readWorkspacePaneTabsForBranch(REPO_ROOT, BRANCH_NAME, queryClient)).toEqual(sourceTabs)
      expect(onReorderError).toHaveBeenCalledTimes(1)
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

type WorkspacePaneTabsReorderMutationControls = ReturnType<typeof useWorkspacePaneTabsReorderMutation>
type WorkspacePaneTabsReorderMutationInput = Parameters<typeof useWorkspacePaneTabsReorderMutation>[0]

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

function currentControls(): WorkspacePaneTabsReorderMutationControls {
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

function terminalEntry(sessionId: string): WorkspacePaneTabEntry {
  return workspacePaneTerminalTabEntry(sessionId)
}

function staticEntry(type: Parameters<typeof workspacePaneStaticTabEntry>[0]): WorkspacePaneTabEntry {
  return workspacePaneStaticTabEntry(type)
}
