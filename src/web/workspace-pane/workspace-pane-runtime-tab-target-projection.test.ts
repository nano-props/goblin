import { afterEach, describe, expect, test, vi } from 'vitest'
import { setTerminalSessionCommandBridge } from '#/web/components/terminal/terminal-session-command-bridge.ts'
import { useTerminalProjectionHydrationStore } from '#/web/stores/terminal-projection-hydration.ts'
import { workspacePaneRuntimeTabTargetKey } from '#/web/workspace-pane/workspace-pane-runtime-tab-target-key.ts'
import {
  readWorkspacePaneRuntimeTabTargetProjection,
  workspacePaneRuntimeTabTargetProjection,
} from '#/web/workspace-pane/workspace-pane-runtime-tab-target-projection.ts'

afterEach(() => {
  setTerminalSessionCommandBridge(null)
  useTerminalProjectionHydrationStore.setState({ hydrationByRepo: new Map(), refreshedAtByRepo: new Map() })
})

describe('workspace pane runtime tab target projection', () => {
  test('builds terminal runtime projection from explicit runtime inputs', () => {
    const projection = workspacePaneRuntimeTabTargetProjection({
      repoRoot: '/repo',
      repoInstanceId: 'repo-instance-1',
      worktreePath: '/repo-worktree',
      selectedSessionIdByRuntimeType: { terminal: 'session-1' },
      terminal: {
        views: [terminalView('session-1')],
        createPending: true,
        projectionState: { phase: 'ready' },
      },
    })

    expect(projection.runtimeTabViews).toEqual([terminalView('session-1')])
    expect(projection.runtimeTabStateByType.terminal).toEqual({
      createPending: true,
      projectionPhase: 'ready',
      projectionErrorMessage: undefined,
      selectedSessionId: 'session-1',
    })
  })

  test('clears runtime views and selection when no worktree target exists', () => {
    const projection = workspacePaneRuntimeTabTargetProjection({
      repoRoot: '/repo',
      repoInstanceId: 'repo-instance-1',
      worktreePath: null,
      selectedSessionIdByRuntimeType: { terminal: 'session-1' },
      terminal: {
        views: [terminalView('session-1')],
        projectionState: { phase: 'ready' },
      },
    })

    expect(projection.runtimeTabViews).toEqual([])
    expect(projection.runtimeTabStateByType.terminal.selectedSessionId).toBeNull()
  })

  test('reads terminal runtime projection from command bridge and hydration state', () => {
    const terminalWorktreeKey = '/repo\0/repo-worktree'
    const terminalWorktreeSnapshot = vi.fn(() => ({
      terminalWorktreeKey,
      selectedDescriptor: null,
      sessions: [terminalView('session-1')],
      count: 1,
      bellCount: 0,
      outputActiveCount: 0,
      createPending: true,
    }))
    useTerminalProjectionHydrationStore.getState().markProjectionReady('/repo', 'repo-instance-1')
    setTerminalSessionCommandBridge({
      terminalWorktreeSnapshot,
      createTerminal: vi.fn(async () => 'session-2'),
      selectTerminal: vi.fn(),
    })

    const projection = readWorkspacePaneRuntimeTabTargetProjection({
      repoRoot: '/repo',
      repoInstanceId: 'repo-instance-1',
      worktreePath: '/repo-worktree',
      selectedSessionIdByRuntimeType: { terminal: 'session-1' },
    })

    expect(terminalWorktreeSnapshot).toHaveBeenCalledWith(terminalWorktreeKey)
    expect(projection.runtimeTabViews).toEqual([terminalView('session-1')])
    expect(projection.runtimeTabStateByType.terminal).toMatchObject({
      createPending: true,
      projectionPhase: 'ready',
      selectedSessionId: 'session-1',
    })
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
