import { afterEach, describe, expect, test, vi } from 'vitest'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { setTerminalSessionCommandBridgeForTest as setTerminalSessionCommandBridge } from '#/web/test-utils/terminal-session-command-bridge.ts'
import { useTerminalProjectionHydrationStore } from '#/web/stores/terminal-projection-hydration.ts'
import { workspacePaneRuntimeTabTargetKey } from '#/web/workspace-pane/workspace-pane-runtime-tab-target-key.ts'
import {
  readWorkspacePaneRuntimeTabTargetProjection,
  workspacePaneRuntimeTabTargetProjection,
} from '#/web/workspace-pane/workspace-pane-runtime-tab-target-projection.ts'
import { workspacePaneRuntimeTabProjectionProviders } from '#/web/workspace-pane/workspace-pane-runtime-tab-providers.ts'
import { WORKSPACE_PANE_RUNTIME_TAB_TYPES } from '#/shared/workspace-pane.ts'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import { formatTerminalFilesystemTargetKeyForPath } from '#/shared/terminal-filesystem-target-key.ts'
import { gitWorktreeFilesystemExecutionTarget } from '#/shared/workspace-runtime.ts'

const REPO_ID = workspaceIdForTest('goblin+file:///repo')
const WORKTREE_PATH = '/repo-worktree'
const WORKTREE_KEY = formatTerminalFilesystemTargetKeyForPath(REPO_ID, WORKTREE_PATH)

afterEach(() => {
  setTerminalSessionCommandBridge(null)
  useTerminalProjectionHydrationStore.setState({
    hydrationByWorkspace: new Map(),
    lastSuccessfulRecoveryByWorkspace: new Map(),
  })
  useWorkspacesStore.setState({ selectedTerminalSessionIdByTerminalFilesystemTarget: {} })
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
          targetKey: WORKTREE_KEY,
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
    const terminalFilesystemTargetKey = WORKTREE_KEY
    const terminalFilesystemTargetSnapshot = vi.fn(() => ({
      terminalFilesystemTargetKey,
      selectedDescriptor: null,
      sessions: [terminalView('term-111111111111111111111')],
      count: 1,
      bellCount: 0,
      outputActiveCount: 0,
      createPending: true,
    }))
    useTerminalProjectionHydrationStore.getState().markProjectionReady(REPO_ID, 'repo-runtime-1')
    useWorkspacesStore.setState({
      selectedTerminalSessionIdByTerminalFilesystemTarget: {
        [terminalFilesystemTargetKey]: 'term-111111111111111111111',
      },
    })
    setTerminalSessionCommandBridge({
      terminalFilesystemTargetSnapshot,
      createTerminal: vi.fn(async () => 'term-222222222222222222222'),
      selectTerminal: vi.fn(),
    })

    const projection = readWorkspacePaneRuntimeTabTargetProjection({
      workspaceId: REPO_ID,
      workspaceRuntimeId: 'repo-runtime-1',
      filesystemTarget: gitWorktreeFilesystemExecutionTarget(REPO_ID, 'repo-runtime-1', WORKTREE_PATH),
    })

    expect(terminalFilesystemTargetSnapshot).toHaveBeenCalledWith(terminalFilesystemTargetKey)
    expect(projection.runtimeTabViews).toEqual([terminalView('term-111111111111111111111')])
    expect(projection.runtimeTabStateByType.terminal).toMatchObject({
      createPending: true,
      projectionPhase: 'ready',
      selectedSessionId: 'term-111111111111111111111',
    })
  })

  test('reads terminal selected session through the projection provider', () => {
    const terminalFilesystemTargetKey = WORKTREE_KEY
    setTerminalSessionCommandBridge({
      terminalFilesystemTargetSnapshot: vi.fn(() => ({
        terminalFilesystemTargetKey,
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
    useWorkspacesStore.setState({
      selectedTerminalSessionIdByTerminalFilesystemTarget: {
        [terminalFilesystemTargetKey]: 'term-222222222222222222222',
      },
    })

    const projection = readWorkspacePaneRuntimeTabTargetProjection({
      workspaceId: REPO_ID,
      workspaceRuntimeId: 'repo-runtime-1',
      filesystemTarget: gitWorktreeFilesystemExecutionTarget(REPO_ID, 'repo-runtime-1', WORKTREE_PATH),
    })

    expect(projection.runtimeTabStateByType.terminal.selectedSessionId).toBe('term-222222222222222222222')
  })

  test('formats the current runtime target key', () => {
    expect(
      workspacePaneRuntimeTabTargetKey({
        workspaceId: REPO_ID,
        workspaceRuntimeId: 'repo-runtime-1',
        filesystemTarget: gitWorktreeFilesystemExecutionTarget(REPO_ID, 'repo-runtime-1', WORKTREE_PATH),
      }),
    ).toBe(WORKTREE_KEY)
    expect(
      workspacePaneRuntimeTabTargetKey({
        workspaceId: REPO_ID,
        workspaceRuntimeId: 'repo-runtime-1',
        filesystemTarget: { kind: 'workspace-root', workspaceId: REPO_ID, workspaceRuntimeId: 'repo-runtime-1' },
      }),
    ).toBe(formatTerminalFilesystemTargetKeyForPath(REPO_ID, REPO_ID))
    expect(
      workspacePaneRuntimeTabTargetKey({
        workspaceId: REPO_ID,
        workspaceRuntimeId: 'repo-runtime-1',
        filesystemTarget: null,
      }),
    ).toBeNull()
  })

  test('rejects a filesystem target owned by a different runtime', () => {
    expect(
      workspacePaneRuntimeTabTargetKey({
        workspaceId: REPO_ID,
        workspaceRuntimeId: 'repo-runtime-current',
        filesystemTarget: {
          kind: 'workspace-root',
          workspaceId: REPO_ID,
          workspaceRuntimeId: 'repo-runtime-stale',
        },
      }),
    ).toBeNull()
  })
})

function terminalView(terminalSessionId: string) {
  return {
    type: 'terminal' as const,
    terminalSessionId,
    terminalFilesystemTargetKey: WORKTREE_KEY,
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
