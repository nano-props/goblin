import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { useTerminalProjectionHydrationStore } from '#/web/stores/terminal-projection-hydration.ts'

const WORKSPACE_ID = workspaceIdForTest('goblin+file:///workspace')
const DEFAULT_REFRESH_COOLDOWN_MS = useTerminalProjectionHydrationStore.getState().refreshCooldownMs

describe('terminal projection hydration', () => {
  beforeEach(() => {
    useTerminalProjectionHydrationStore.setState({
      refreshCooldownMs: 100,
      hydrationByWorkspace: new Map(),
      lastSuccessfulRecoveryByWorkspace: new Map(),
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    useTerminalProjectionHydrationStore.setState({
      refreshCooldownMs: DEFAULT_REFRESH_COOLDOWN_MS,
      hydrationByWorkspace: new Map(),
      lastSuccessfulRecoveryByWorkspace: new Map(),
    })
  })

  test('measures focus cooldown from the latest successful recovery for the current runtime', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000)
    const state = useTerminalProjectionHydrationStore.getState()
    state.markProjectionReady(WORKSPACE_ID, 'workspace-runtime-current')

    now.mockReturnValue(1_099)
    expect(state.isProjectionFocusRefreshDue(WORKSPACE_ID, 'workspace-runtime-current')).toBe(false)
    now.mockReturnValue(1_100)
    expect(state.isProjectionFocusRefreshDue(WORKSPACE_ID, 'workspace-runtime-current')).toBe(true)

    state.markProjectionReady(WORKSPACE_ID, 'workspace-runtime-current')
    now.mockReturnValue(1_199)
    expect(state.isProjectionFocusRefreshDue(WORKSPACE_ID, 'workspace-runtime-current')).toBe(false)
    now.mockReturnValue(1_200)
    expect(state.isProjectionFocusRefreshDue(WORKSPACE_ID, 'workspace-runtime-current')).toBe(true)

    expect(state.isProjectionFocusRefreshDue(WORKSPACE_ID, 'workspace-runtime-replacement')).toBe(true)
  })
})
