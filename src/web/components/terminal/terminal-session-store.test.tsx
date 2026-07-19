// @vitest-environment jsdom
// Tests the simplified hooks in `terminal-session-store.ts` after the
// factory refactor: each hook should derive the right field, return a
// safe empty value when the key is null, and the latest-ref selector
// pattern should keep extra re-renders to zero when the selector
// identity changes but the projected value does not.
import { useState } from 'react'
import { describe, expect, test } from 'vitest'
import { act } from '@testing-library/react'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { renderInJsdom } from '#/test-utils/render.tsx'
import {
  EMPTY_TERMINAL_SNAPSHOT,
  TerminalSessionReadContext,
} from '#/web/components/terminal/terminal-session-context.ts'
import {
  useTerminalSessionSummaries,
  useTerminalSnapshot,
  useWorkspaceTerminalBellCounts,
  useTerminalFilesystemTargetBellCount,
  useTerminalFilesystemTargetCount,
  useTerminalFilesystemTargetCreatePending,
  useTerminalFilesystemTargetField,
  useTerminalFilesystemTargetOutputActive,
  useTerminalFilesystemTargetSelectedDescriptor,
} from '#/web/components/terminal/terminal-session-store.ts'
import { terminalDescriptorForTest } from '#/web/test-utils/terminal-model.ts'
import type {
  TerminalSessionReadContextValue,
  TerminalSnapshot,
  TerminalFilesystemTargetSnapshot,
} from '#/web/components/terminal/types.ts'

const WORKTREE_KEY = 'wt:1'
const SESSION_ID = 'session:1'
const WORKSPACE_ID = workspaceIdForTest('goblin+file:///example-workspace')

function makeReadContext(overrides: Partial<TerminalFilesystemTargetSnapshot> = {}): TerminalSessionReadContextValue {
  const snapshot: TerminalFilesystemTargetSnapshot = {
    terminalFilesystemTargetKey: WORKTREE_KEY,
    selectedDescriptor: null,
    sessions: [],
    count: 3,
    bellCount: 2,
    outputActiveCount: 1,
    createPending: false,
    ...overrides,
  }
  return {
    terminalFilesystemTargetSnapshot: (key) =>
      key === WORKTREE_KEY ? snapshot : { ...snapshot, terminalFilesystemTargetKey: key },
    subscribeTerminalFilesystemTarget: () => () => {},
    workspaceBellCount: () => 0,
    subscribeWorkspaceBellCount: () => () => {},
    snapshot: () => EMPTY_TERMINAL_SNAPSHOT,
    subscribeSnapshot: () => () => {},
  }
}

function withRead(value: TerminalSessionReadContextValue, children: React.ReactNode) {
  return <TerminalSessionReadContext value={value}>{children}</TerminalSessionReadContext>
}

describe('simplified worktree hooks read the right field', () => {
  test('useTerminalFilesystemTargetCount returns snapshot.count', () => {
    function Probe() {
      const count = useTerminalFilesystemTargetCount(WORKTREE_KEY)
      return <span data-testid="v">{count}</span>
    }
    const { getByTestId } = renderInJsdom(withRead(makeReadContext({ count: 7 }), <Probe />))
    expect(getByTestId('v').textContent).toBe('7')
  })

  test('useTerminalFilesystemTargetCreatePending returns snapshot.createPending', () => {
    function Probe() {
      const v = useTerminalFilesystemTargetCreatePending(WORKTREE_KEY)
      return <span data-testid="v">{String(v)}</span>
    }
    const { getByTestId } = renderInJsdom(withRead(makeReadContext({ createPending: true }), <Probe />))
    expect(getByTestId('v').textContent).toBe('true')
  })

  test('useTerminalFilesystemTargetBellCount returns snapshot.bellCount', () => {
    function Probe() {
      const v = useTerminalFilesystemTargetBellCount(WORKTREE_KEY)
      return <span data-testid="v">{v}</span>
    }
    const { getByTestId } = renderInJsdom(withRead(makeReadContext({ bellCount: 5 }), <Probe />))
    expect(getByTestId('v').textContent).toBe('5')
  })

  test('useTerminalFilesystemTargetOutputActive derives from outputActiveCount', () => {
    function Probe() {
      const v = useTerminalFilesystemTargetOutputActive(WORKTREE_KEY)
      return <span data-testid="v">{String(v)}</span>
    }
    const { rerender, getByTestId } = renderInJsdom(withRead(makeReadContext({ outputActiveCount: 2 }), <Probe />))
    expect(getByTestId('v').textContent).toBe('true')
    rerender(withRead(makeReadContext({ outputActiveCount: 0 }), <Probe />))
    expect(getByTestId('v').textContent).toBe('false')
  })

  test('useTerminalFilesystemTargetSelectedDescriptor returns snapshot.selectedDescriptor', () => {
    const descriptor = terminalDescriptorForTest({
      terminalSessionId: SESSION_ID,
      index: 0,
      workspaceRuntimeId: 'rt:1',
      repoRoot: '/r',
      branch: 'main',
      worktreePath: '/r',
    })
    function Probe() {
      const d = useTerminalFilesystemTargetSelectedDescriptor(WORKTREE_KEY)
      return <span data-testid="v">{d?.terminalSessionId ?? 'none'}</span>
    }
    const { getByTestId } = renderInJsdom(withRead(makeReadContext({ selectedDescriptor: descriptor }), <Probe />))
    expect(getByTestId('v').textContent).toBe(SESSION_ID)
  })

  test('useTerminalSessionSummaries returns snapshot.sessions', () => {
    const sessions = [
      {
        type: 'terminal' as const,
        terminalFilesystemTargetKey: WORKTREE_KEY,
        terminalSessionId: 's1',
        index: 0,
        title: 't1',
        phase: 'opening' as const,
        selected: true,
        hasBell: false,
        hasRecentOutput: false,
      },
    ]
    function Probe() {
      const v = useTerminalSessionSummaries(WORKTREE_KEY)
      return <span data-testid="v">{v.length}</span>
    }
    const { getByTestId } = renderInJsdom(withRead(makeReadContext({ sessions }), <Probe />))
    expect(getByTestId('v').textContent).toBe('1')
  })
})

describe('null key returns empty-derived values', () => {
  test('useTerminalFilesystemTargetCount(null) returns 0', () => {
    function Probe() {
      const v = useTerminalFilesystemTargetCount(null)
      return <span data-testid="v">{v}</span>
    }
    const { getByTestId } = renderInJsdom(withRead(makeReadContext(), <Probe />))
    expect(getByTestId('v').textContent).toBe('0')
  })

  test('useTerminalFilesystemTargetCreatePending(null) returns false', () => {
    function Probe() {
      const v = useTerminalFilesystemTargetCreatePending(null)
      return <span data-testid="v">{String(v)}</span>
    }
    const { getByTestId } = renderInJsdom(withRead(makeReadContext(), <Probe />))
    expect(getByTestId('v').textContent).toBe('false')
  })

  test('useTerminalFilesystemTargetOutputActive(null) returns false', () => {
    function Probe() {
      const v = useTerminalFilesystemTargetOutputActive(null)
      return <span data-testid="v">{String(v)}</span>
    }
    const { getByTestId } = renderInJsdom(withRead(makeReadContext(), <Probe />))
    expect(getByTestId('v').textContent).toBe('false')
  })

  test('useTerminalFilesystemTargetBellCount(null) returns 0', () => {
    function Probe() {
      const v = useTerminalFilesystemTargetBellCount(null)
      return <span data-testid="v">{v}</span>
    }
    const { getByTestId } = renderInJsdom(withRead(makeReadContext(), <Probe />))
    expect(getByTestId('v').textContent).toBe('0')
  })

  test('useTerminalSnapshot(null) returns the EMPTY snapshot', () => {
    function Probe() {
      const v = useTerminalSnapshot(null)
      return <span data-testid="v">{v.phase}</span>
    }
    const { getByTestId } = renderInJsdom(withRead(makeReadContext(), <Probe />))
    expect(getByTestId('v').textContent).toBe(EMPTY_TERMINAL_SNAPSHOT.phase)
  })

  test('null worktree key still requires the read provider', () => {
    function Probe() {
      useTerminalFilesystemTargetCount(null)
      return null
    }
    expect(() => renderInJsdom(<Probe />)).toThrow('Terminal session read context is unavailable')
  })

  test('null session id still requires the read provider', () => {
    function Probe() {
      useTerminalSnapshot(null)
      return null
    }
    expect(() => renderInJsdom(<Probe />)).toThrow('Terminal session read context is unavailable')
  })

  test('empty repo bell count query still requires the read provider', () => {
    function Probe() {
      useWorkspaceTerminalBellCounts([])
      return null
    }
    expect(() => renderInJsdom(<Probe />)).toThrow('Terminal session read context is unavailable')
  })

  test('real worktree key still requires the read provider', () => {
    function Probe() {
      useTerminalFilesystemTargetCount(WORKTREE_KEY)
      return null
    }
    expect(() => renderInJsdom(<Probe />)).toThrow('Terminal session read context is unavailable')
  })

  test('real session id still requires the read provider', () => {
    function Probe() {
      useTerminalSnapshot(SESSION_ID)
      return null
    }
    expect(() => renderInJsdom(<Probe />)).toThrow('Terminal session read context is unavailable')
  })

  test('non-empty repo bell count query still requires the read provider', () => {
    function Probe() {
      useWorkspaceTerminalBellCounts([WORKSPACE_ID])
      return null
    }
    expect(() => renderInJsdom(<Probe />)).toThrow('Terminal session read context is unavailable')
  })
})

describe('useTerminalFilesystemTargetField uses the latest selector closure', () => {
  test('a selector that depends on a captured variable reflects updates to that variable', () => {
    function Probe({ multiplier }: { multiplier: number }) {
      // Closure captures `multiplier`; when the prop changes, the new
      // selector closure must take effect on the very next render.
      const value = useTerminalFilesystemTargetField(WORKTREE_KEY, (s) => s.count * multiplier)
      return <span data-testid="v">{value}</span>
    }

    function Parent() {
      const [multiplier, setMultiplier] = useState(1)
      return (
        <>
          <button data-testid="bump" onClick={() => setMultiplier(multiplier + 1)} />
          <Probe multiplier={multiplier} />
        </>
      )
    }

    const { getByTestId } = renderInJsdom(withRead(makeReadContext({ count: 3 }), <Parent />))
    expect(getByTestId('v').textContent).toBe('3')

    act(() => {
      getByTestId('bump').click()
    })
    // multiplier is now 2; count * 2 should be 6. If the selectorRef were
    // stale we would still see 3.
    expect(getByTestId('v').textContent).toBe('6')

    act(() => {
      getByTestId('bump').click()
    })
    expect(getByTestId('v').textContent).toBe('9')
  })

  test('a selector that ignores its captured variable stays consistent across re-renders', () => {
    function Probe({ tick }: { tick: number }) {
      // Selector always projects to `s.count` regardless of `tick`. This
      // mirrors the real `useTerminalFilesystemTargetCount` etc., where the
      // selector ignores everything except the store snapshot.
      const value = useTerminalFilesystemTargetField(WORKTREE_KEY, (s) => s.count + (tick - tick))
      return <span data-testid="v">{value}</span>
    }

    function Parent() {
      const [tick, setTick] = useState(0)
      return (
        <>
          <button data-testid="bump" onClick={() => setTick(tick + 1)} />
          <Probe tick={tick} />
        </>
      )
    }

    const { getByTestId } = renderInJsdom(withRead(makeReadContext({ count: 9 }), <Parent />))
    expect(getByTestId('v').textContent).toBe('9')

    act(() => {
      getByTestId('bump').click()
    })
    expect(getByTestId('v').textContent).toBe('9')
  })
})
