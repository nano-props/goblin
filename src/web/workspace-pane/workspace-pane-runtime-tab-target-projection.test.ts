import { afterEach, describe, expect, test, vi } from 'vitest'
import { setTerminalSessionCommandBridgeForTest as setTerminalSessionCommandBridge } from '#/web/test-utils/terminal-session-command-bridge.ts'
import { useTerminalProjectionHydrationStore } from '#/web/stores/terminal-projection-hydration.ts'
import { workspacePaneRuntimeTabTargetKey } from '#/web/workspace-pane/workspace-pane-runtime-tab-target-key.ts'
import {
  readWorkspacePaneRuntimeTabTargetProjection,
  workspacePaneRuntimeTabTargetProjection,
} from '#/web/workspace-pane/workspace-pane-runtime-tab-target-projection.ts'
import { workspacePaneRuntimeTabProjectionProviders } from '#/web/workspace-pane/workspace-pane-runtime-tab-providers.ts'
import { WORKSPACE_PANE_RUNTIME_TAB_TYPES } from '#/shared/workspace-pane.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'

afterEach(() => {
  setTerminalSessionCommandBridge(null)
  useTerminalProjectionHydrationStore.setState({ hydrationByRepo: new Map(), refreshedAtByRepo: new Map() })
  useReposStore.setState({ selectedTerminalSessionIdByTerminalWorktree: {} })
})

describe('workspace pane runtime tab target projection', () => {
  test('registers a projection provider for every runtime tab type', () => {
    expect(workspacePaneRuntimeTabProjectionProviders().map((provider) => provider.type)).toEqual(
      WORKSPACE_PANE_RUNTIME_TAB_TYPES,
    )
  })

  test('builds terminal runtime projection from explicit runtime inputs', () => {
    const projection = workspacePaneRuntimeTabTargetProjection({
      providers: [
        {
          type: 'terminal',
          targetKey: '/repo\0/repo-worktree',
          views: [terminalView('term-111111111111111111111')],
          selectedSessionId: 'term-111111111111111111111',
          state: {
            createPending: true,
            projectionPhase: 'ready',
            selectedSessionId: 'term-111111111111111111111',
          },
        },
      ],
    })

    expect(projection.runtimeTabViews).toEqual([terminalView('term-111111111111111111111')])
    expect(projection.runtimeTabStateByType.terminal).toEqual({
      createPending: true,
      projectionPhase: 'ready',
      projectionErrorMessage: undefined,
      selectedSessionId: 'term-111111111111111111111',
    })
  })

  test('clears runtime views and selection when no worktree target exists', () => {
    const projection = workspacePaneRuntimeTabTargetProjection({
      providers: [
        {
          type: 'terminal',
          targetKey: null,
          views: [],
          selectedSessionId: null,
          state: {
            projectionPhase: 'ready',
            selectedSessionId: null,
          },
        },
      ],
    })

    expect(projection.runtimeTabViews).toEqual([])
    expect(projection.runtimeTabStateByType.terminal.selectedSessionId).toBeNull()
  })

  test('reads terminal runtime projection from command bridge and hydration state', () => {
    const terminalWorktreeKey = '/repo\0/repo-worktree'
    const terminalWorktreeSnapshot = vi.fn(() => ({
      terminalWorktreeKey,
      selectedDescriptor: null,
      sessions: [terminalView('term-111111111111111111111')],
      count: 1,
      bellCount: 0,
      outputActiveCount: 0,
      createPending: true,
    }))
    useTerminalProjectionHydrationStore.getState().markProjectionReady('/repo', 'repo-runtime-1')
    useReposStore.setState({
      selectedTerminalSessionIdByTerminalWorktree: {
        [terminalWorktreeKey]: 'term-111111111111111111111',
      },
    })
    setTerminalSessionCommandBridge({
      terminalWorktreeSnapshot,
      createTerminal: vi.fn(async () => 'term-222222222222222222222'),
      selectTerminal: vi.fn(),
    })

    const projection = readWorkspacePaneRuntimeTabTargetProjection({
      repoRoot: '/repo',
      repoRuntimeId: 'repo-runtime-1',
      worktreePath: '/repo-worktree',
    })

    expect(terminalWorktreeSnapshot).toHaveBeenCalledWith(terminalWorktreeKey)
    expect(projection.runtimeTabViews).toEqual([terminalView('term-111111111111111111111')])
    expect(projection.runtimeTabStateByType.terminal).toMatchObject({
      createPending: true,
      projectionPhase: 'ready',
      selectedSessionId: 'term-111111111111111111111',
    })
  })

  test('reads terminal selected session through the projection provider', () => {
    const terminalWorktreeKey = '/repo\0/repo-worktree'
    setTerminalSessionCommandBridge({
      terminalWorktreeSnapshot: vi.fn(() => ({
        terminalWorktreeKey,
        selectedDescriptor: null,
        sessions: [terminalView('term-111111111111111111111'), terminalView('term-222222222222222222222')],
        count: 2,
        bellCount: 0,
        outputActiveCount: 0,
        createPending: false,
      })),
      createTerminal: vi.fn(async () => 'term-333333333333333333333'),
      selectTerminal: vi.fn(),
    })
    useReposStore.setState({
      selectedTerminalSessionIdByTerminalWorktree: {
        [terminalWorktreeKey]: 'term-222222222222222222222',
      },
    })

    const projection = readWorkspacePaneRuntimeTabTargetProjection({
      repoRoot: '/repo',
      repoRuntimeId: 'repo-runtime-1',
      worktreePath: '/repo-worktree',
    })

    expect(projection.runtimeTabStateByType.terminal.selectedSessionId).toBe('term-222222222222222222222')
  })

  test('formats the current runtime target key', () => {
    expect(workspacePaneRuntimeTabTargetKey({ repoRoot: '/repo', worktreePath: '/repo-worktree' })).toBe(
      '/repo\0/repo-worktree',
    )
    expect(workspacePaneRuntimeTabTargetKey({ repoRoot: '/repo', worktreePath: null })).toBeNull()
  })
})

function terminalView(terminalSessionId: string) {
  return {
    type: 'terminal' as const,
    terminalSessionId,
    terminalWorktreeKey: '/repo\0/repo-worktree',
    index: 1,
    title: terminalSessionId,
    fullTitle: terminalSessionId,
    originalTitle: terminalSessionId,
    phase: 'open' as const,
    selected: true,
    hasBell: false,
    hasRecentOutput: false,
  }
}
