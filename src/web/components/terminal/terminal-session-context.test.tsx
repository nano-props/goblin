// @vitest-environment jsdom
import { describe, expect, test, vi } from 'vitest'
import { renderInJsdom } from '#/test-utils/render.tsx'
import {
  EMPTY_TERMINAL_WORKTREE_SNAPSHOT,
  TerminalSessionContext,
  TerminalSessionReadContext,
  useTerminalSessionContext,
  useTerminalSessionReadContext,
} from '#/web/components/terminal/terminal-session-context.ts'
import type {
  TerminalSessionContextValue,
  TerminalSessionReadContextValue,
} from '#/web/components/terminal/types.ts'

function ReadSnapshot() {
  const ctx = useTerminalSessionReadContext()
  return (
    <>
      <span data-testid="count">{ctx.terminalWorktreeSnapshot('any').count}</span>
      <span data-testid="bell">{ctx.repoBellCount('any')}</span>
    </>
  )
}

function CommandProbe() {
  const ctx = useTerminalSessionContext()
  return <span data-testid="has-create-terminal">{String(typeof ctx.createTerminal)}</span>
}

function makeCommandContext(
  overrides: Partial<TerminalSessionContextValue> = {},
): TerminalSessionContextValue {
  return {
    createTerminal: vi.fn(async () => 'term-111111111111111111111'),
    createTerminalWithAdmission: vi.fn(async () => ({
      terminalSessionId: 'term-111111111111111111111',
      resourceDisposition: 'created',
      runtimeProjectionApplied: false,
      requestRole: 'leader',
    })) as TerminalSessionContextValue['createTerminalWithAdmission'],
    registerHost: vi.fn(),
    unregisterHost: vi.fn(),
    selectTerminal: vi.fn(),
    scrollToBottom: vi.fn(),
    scrollLines: vi.fn(),
    clearBell: vi.fn(() => false),
    closeTerminalByDescriptor: vi.fn(async () => false),
    attach: vi.fn(),
    detach: vi.fn(),
    restart: vi.fn(),
    focusTerminal: vi.fn(),
    isTerminalFocusTarget: vi.fn(() => false),
    findNext: vi.fn(() => ({ resultIndex: 0, resultCount: 0, found: false })),
    findPrevious: vi.fn(() => ({ resultIndex: 0, resultCount: 0, found: false })),
    clearSearch: vi.fn(),
    writeInput: vi.fn(),
    takeover: vi.fn(async () => false),
    ...overrides,
  }
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
      terminalWorktreeSnapshot: () => ({ ...EMPTY_TERMINAL_WORKTREE_SNAPSHOT, count: 7 }),
      subscribeTerminalWorktree: () => () => {},
      repoBellCount: () => 3,
      subscribeRepoBellCount: () => () => {},
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
