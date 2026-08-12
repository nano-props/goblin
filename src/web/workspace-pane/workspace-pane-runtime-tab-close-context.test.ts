import { afterEach, describe, expect, test, vi } from 'vitest'
import type { TerminalSessionBase } from '#/shared/terminal-types.ts'
import { canonicalWorkspaceLocator } from '#/shared/workspace-locator.ts'
import {
  setTerminalSessionCommandBridge,
  type TerminalSessionCommandBridge,
} from '#/web/components/terminal/terminal-session-command-bridge.ts'
import { readWorkspacePaneRuntimeTabCloseContext } from '#/web/workspace-pane/workspace-pane-runtime-tab-close-context.ts'

const WORKSPACE_RUNTIME_ID = 'repo-runtime-test'
const terminalBase: TerminalSessionBase = {
  target: {
    kind: 'git-worktree' as const,
    workspaceId: canonicalWorkspaceLocator('goblin+file:///repo')!,
    workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
    root: canonicalWorkspaceLocator('goblin+file:///repo-worktree')!,
  },
  presentation: { kind: 'git-worktree' as const, head: { kind: 'branch' as const, branchName: 'main' } },
}
afterEach(() => {
  setTerminalSessionCommandBridge(null)
})

describe('workspace pane runtime tab close context', () => {
  test('reads terminal close capability from the command bridge', async () => {
    const closeTerminalByDescriptor = vi.fn(async () => ({ kind: 'committed' as const, projection: 'applied' as const }))
    setTerminalSessionCommandBridge(terminalCommandBridge({ closeTerminalByDescriptor }))

    const context = readWorkspacePaneRuntimeTabCloseContext()

    if (!context) throw new Error('terminal close context missing')
    await expect(context.closeTerminalByDescriptor('term-111111111111111111111', terminalBase)).resolves.toEqual({
      kind: 'committed',
      projection: 'applied',
    })
    expect(closeTerminalByDescriptor).toHaveBeenCalledWith('term-111111111111111111111', terminalBase)
  })

  test('rejects confirmed close when terminal capability is unavailable', () => {
    const context = readWorkspacePaneRuntimeTabCloseContext()

    expect(context).toBeNull()
  })
})

function terminalCommandBridge({
  closeTerminalByDescriptor,
}: {
  closeTerminalByDescriptor: TerminalSessionCommandBridge['closeTerminalByDescriptor']
}): TerminalSessionCommandBridge {
  const createTerminal = vi.fn(async () => 'term-111111111111111111111')
  return {
    terminalFilesystemTargetSnapshot: () => ({
      terminalFilesystemTargetKey: 'repo\0worktree',
      selectedDescriptor: null,
      sessions: [],
      count: 0,
      bellCount: 0,
      outputActiveCount: 0,
      createPending: false,
    }),
    createTerminal,
    createTerminalWithAdmission: vi.fn(async (base) => ({
      terminalSessionId: 'term-111111111111111111111',
      presentation: base.presentation,
      requestRole: 'leader' as const,
      resourceDisposition: 'created' as const,
      runtimeProjectionApplied: true,
    })),
    selectTerminal: vi.fn(),
    focusTerminal: vi.fn(),
    closeTerminalByDescriptor,
  }
}
