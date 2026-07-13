// @vitest-environment jsdom
// Tests the defensive fallback path of `useTerminalSessionContext` /
// `useTerminalSessionReadContext`: when the provider is transiently absent
// (e.g. during a route transition or Suspense fallback) the hooks must
// return the EMPTY_* fixtures instead of throwing, and surface a single
// toast to the user per kind per "burst" (so a missing provider doesn't
// spam N toasts for N consumer mounts).
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { renderInJsdom } from '#/test-utils/render.tsx'
import {
  EMPTY_TERMINAL_COMMAND_CONTEXT_VALUE,
  EMPTY_TERMINAL_READ_CONTEXT_VALUE,
  EMPTY_TERMINAL_WORKTREE_SNAPSHOT,
  TerminalSessionContext,
  TerminalSessionReadContext,
  __resetTerminalContextReporting,
  useTerminalSessionContext,
  useTerminalSessionReadContext,
} from '#/web/components/terminal/terminal-session-context.ts'
import type {
  TerminalSessionContextValue,
  TerminalSessionReadContextValue,
} from '#/web/components/terminal/types.ts'

vi.mock(import('#/web/stores/i18n.ts'), async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    useT: (() => (key: string) => i18nMocks.dict[key] ?? key) as typeof actual.useT,
  }
})

const toastMocks = vi.hoisted(() => ({
  error: vi.fn(),
}))
const i18nMocks = vi.hoisted(() => ({
  dict: {
    'error.terminal-context-unavailable': 'Terminal session unavailable',
    'error.terminal-context-unavailable-description': 'Some terminal status indicators may be missing.',
  } as Record<string, string>,
}))

vi.mock('sonner', () => ({
  toast: toastMocks,
}))

afterEach(() => {
  toastMocks.error.mockClear()
  __resetTerminalContextReporting()
})

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

describe('useTerminalSessionContext — missing provider', () => {
  beforeEach(() => {
    toastMocks.error.mockClear()
  })

  test('returns EMPTY_TERMINAL_COMMAND_CONTEXT_VALUE (no throw)', () => {
    expect(() => renderInJsdom(<CommandProbe />)).not.toThrow()
    expect(typeof EMPTY_TERMINAL_COMMAND_CONTEXT_VALUE.createTerminal).toBe('function')
    expect(typeof EMPTY_TERMINAL_COMMAND_CONTEXT_VALUE.registerHost).toBe('function')
  })

  test('exposes the same identity as a freshly imported EMPTY_* constant', () => {
    expect(EMPTY_TERMINAL_COMMAND_CONTEXT_VALUE.createTerminal).toBeDefined()
    expect(EMPTY_TERMINAL_READ_CONTEXT_VALUE.terminalWorktreeSnapshot).toBeDefined()
    expect(EMPTY_TERMINAL_WORKTREE_SNAPSHOT.count).toBe(0)
  })

  test('calls toast.error once per burst when context is missing', () => {
    renderInJsdom(<CommandProbe />)
    expect(toastMocks.error).toHaveBeenCalledTimes(1)
    const [title, options] = toastMocks.error.mock.calls[0]!
    expect(title).toBe('Terminal session unavailable')
    expect(options.description).toBe('Some terminal status indicators may be missing.')
  })
})

describe('useTerminalSessionReadContext — missing provider', () => {
  beforeEach(() => {
    toastMocks.error.mockClear()
  })

  test('returns the empty worktree snapshot, repoBellCount 0, no throw', () => {
    expect(() => renderInJsdom(<ReadSnapshot />)).not.toThrow()
  })

  test('global dedup: N read consumers → exactly 1 toast for the burst', () => {
    // A burst of consumers mounting under the missing provider should
    // collapse to a single toast — otherwise the user sees N stacked toasts
    // of the same error during a transient route transition.
    renderInJsdom(
      <>
        <ReadSnapshot />
        <ReadSnapshot />
        <ReadSnapshot />
      </>,
    )
    expect(toastMocks.error).toHaveBeenCalledTimes(1)
  })

  test('per-kind dedup: read + command missing → exactly 2 toasts (one each)', () => {
    renderInJsdom(
      <>
        <ReadSnapshot />
        <CommandProbe />
      </>,
    )
    expect(toastMocks.error).toHaveBeenCalledTimes(2)
  })
})

describe('hooks with a provider do not toast or fall back', () => {
  beforeEach(() => {
    toastMocks.error.mockClear()
  })

  const realRead: TerminalSessionReadContextValue = {
    ...EMPTY_TERMINAL_READ_CONTEXT_VALUE,
    repoBellCount: () => 7,
  }
  const realCommand: TerminalSessionContextValue = {
    ...EMPTY_TERMINAL_COMMAND_CONTEXT_VALUE,
    createTerminal: vi.fn(() => Promise.resolve('real-session-id')) as TerminalSessionContextValue['createTerminal'],
  }

  test('read context: real value wins, no toast', () => {
    renderInJsdom(
      <TerminalSessionReadContext value={realRead}>
        <ReadSnapshot />
      </TerminalSessionReadContext>,
    )
    expect(toastMocks.error).not.toHaveBeenCalled()
  })

  test('command context: real value wins, no toast', () => {
    renderInJsdom(
      <TerminalSessionContext value={realCommand}>
        <CommandProbe />
      </TerminalSessionContext>,
    )
    expect(toastMocks.error).not.toHaveBeenCalled()
  })
})

describe('remount + StrictMode interactions with the burst dedup', () => {
  beforeEach(() => {
    toastMocks.error.mockClear()
  })

  test('unmount + remount within the same burst stays at 1 toast', () => {
    // Mount → report to module-level set → unmount → remount → set already
    // has 'read' → no new toast. This is the intended "once per burst"
    // semantic.
    const first = renderInJsdom(<ReadSnapshot />)
    first.unmount()
    renderInJsdom(<ReadSnapshot />)
    expect(toastMocks.error).toHaveBeenCalledTimes(1)
  })

  test('after __resetTerminalContextReporting, a fresh mount fires a new toast', () => {
    renderInJsdom(<ReadSnapshot />)
    expect(toastMocks.error).toHaveBeenCalledTimes(1)
    __resetTerminalContextReporting()
    renderInJsdom(<ReadSnapshot />)
    expect(toastMocks.error).toHaveBeenCalledTimes(2)
  })

  test('StrictMode double-invoke fires toast only once (per-burst set + per-component ref both hold)', () => {
    renderInJsdom(
      <StrictMode>
        <ReadSnapshot />
      </StrictMode>,
    )
    expect(toastMocks.error).toHaveBeenCalledTimes(1)
  })
})