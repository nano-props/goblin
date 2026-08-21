// @vitest-environment jsdom
import { describe, expect, test } from 'vitest'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import {
  EMPTY_TERMINAL_FILESYSTEM_TARGET_SNAPSHOT,
  EMPTY_TERMINAL_SNAPSHOT,
  TerminalSessionReadScope,
  useTerminalSessionContext,
  useTerminalSessionReadContext,
} from '#/web/terminal/components/terminal-session-context.ts'
import type { TerminalSessionReadContextValue } from '#/web/terminal/components/types.ts'

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

describe('useTerminalSessionContext', () => {
  test('throws when the provider is missing', () => {
    expect(() => renderInJsdom(<CommandProbe />)).toThrow('Terminal session context is unavailable')
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
      workspaceTerminalSessions: () => [],
      subscribeWorkspaceTerminalSessions: () => () => {},
      snapshot: () => EMPTY_TERMINAL_SNAPSHOT,
      subscribeSnapshot: () => () => {},
    }
    const { getByTestId } = renderInJsdom(
      <TerminalSessionReadScope value={readContext}>
        <ReadSnapshot />
      </TerminalSessionReadScope>,
    )
    expect(getByTestId('count').textContent).toBe('7')
    expect(getByTestId('bell').textContent).toBe('3')
  })
})
