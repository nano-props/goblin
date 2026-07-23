// @vitest-environment jsdom
import { describe, expect, test, vi } from 'vitest'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import {
  EMPTY_TERMINAL_FILESYSTEM_TARGET_SNAPSHOT,
  TerminalSessionContext,
  TerminalSessionReadContext,
  useTerminalSessionContext,
  useTerminalSessionReadContext,
} from '#/web/components/terminal/terminal-session-context.ts'
import type { TerminalSessionContextValue, TerminalSessionReadContextValue } from '#/web/components/terminal/types.ts'
import { terminalSessionContextForTest } from '#/web/test-utils/terminal-session-context.ts'

const WORKSPACE_ID = workspaceIdForTest('goblin+file:///example-workspace')

function ReadSnapshot() {
  const ctx = useTerminalSessionReadContext()
  return (
    <>
      <span data-testid="count">{ctx.terminalFilesystemTargetSnapshot('any').count}</span>
      <span data-testid="bell">{ctx.workspaceBellCount(WORKSPACE_ID)}</span>
    </>
  )
}

function CommandProbe() {
  const ctx = useTerminalSessionContext()
  return <span data-testid="has-create-terminal">{String(typeof ctx.createTerminal)}</span>
}

function makeCommandContext(overrides: Partial<TerminalSessionContextValue> = {}): TerminalSessionContextValue {
  return terminalSessionContextForTest({
    createTerminal: vi.fn(async () => 'term-111111111111111111111'),
    createTerminalWithAdmission: vi.fn(async () => ({
      terminalSessionId: 'term-111111111111111111111',
      presentation: { kind: 'git-worktree' as const, head: { kind: 'branch' as const, branchName: 'main' } },
      resourceDisposition: 'created',
      runtimeProjectionApplied: false,
      requestRole: 'leader',
    })) as TerminalSessionContextValue['createTerminalWithAdmission'],
    selectTerminal: vi.fn(),
    scrollToBottom: vi.fn(),
    scrollLines: vi.fn(),
    clearBell: vi.fn(() => false),
    closeTerminalByDescriptor: vi.fn(async () => false),
    attach: vi.fn(),
    detach: vi.fn(),
    restart: vi.fn(),
    focusTerminal: vi.fn(),
    findNext: vi.fn(() => ({ resultIndex: 0, resultCount: 0, found: false })),
    findPrevious: vi.fn(() => ({ resultIndex: 0, resultCount: 0, found: false })),
    clearSearch: vi.fn(),
    takeover: vi.fn(async () => false),
    ...overrides,
  })
}

describe('useTerminalSessionContext', () => {
  test('throws when the provider is missing', () => {
    expect(() => renderInJsdom(<CommandProbe />)).toThrow('Terminal session context is unavailable')
  })

  test('returns the provider value when present', () => {
    const createTerminal = vi.fn(async () => 'real-session-id')
    renderInJsdom(
      <TerminalSessionContext value={makeCommandContext({ createTerminal })}>
        <CommandProbe />
      </TerminalSessionContext>,
    )
    expect(createTerminal).not.toHaveBeenCalled()
  })
})

describe('useTerminalSessionReadContext', () => {
  test('throws when the provider is missing', () => {
    expect(() => renderInJsdom(<ReadSnapshot />)).toThrow('Terminal session read context is unavailable')
  })

  test('returns the provider value when present', () => {
    const readContext: TerminalSessionReadContextValue = {
      terminalFilesystemTargetSnapshot: () => ({ ...EMPTY_TERMINAL_FILESYSTEM_TARGET_SNAPSHOT, count: 7 }),
      subscribeTerminalFilesystemTarget: () => () => {},
      workspaceBellCount: () => 3,
      subscribeWorkspaceBellCount: () => () => {},
      snapshot: () => ({ phase: 'opening', message: null, processName: 'terminal' }),
      subscribeSnapshot: () => () => {},
    }
    const { getByTestId } = renderInJsdom(
      <TerminalSessionReadContext value={readContext}>
        <ReadSnapshot />
      </TerminalSessionReadContext>,
    )
    expect(getByTestId('count').textContent).toBe('7')
    expect(getByTestId('bell').textContent).toBe('3')
  })
})
