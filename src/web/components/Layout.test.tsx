// @vitest-environment jsdom

import type { ReactNode } from 'react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { act } from '@testing-library/react'
import { CompactRepoWorkspace, RepoWorkspace } from '#/web/components/Layout.tsx'
import { Layout, authenticatedAppShellMode } from '#/web/Layout.tsx'
import { WORKSPACE_PANE_TRANSITION_MS } from '#/web/components/workspace-motion.ts'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { useRepoTerminalBellCounts } from '#/web/components/terminal/terminal-session-store.ts'
import type { TerminalSessionContextValue, TerminalSessionReadContextValue } from '#/web/components/terminal/types.ts'
import type { AuthenticatedAppBootstrapState } from '#/web/hooks/useAuthenticatedAppBootstrap.ts'

const restoringWorkspaceState: AuthenticatedAppBootstrapState = { status: 'restoring-workspace' }
const readyState: AuthenticatedAppBootstrapState = { status: 'ready' }
const failedState: AuthenticatedAppBootstrapState = { status: 'failed', message: 'restore failed' }
const layoutRouterMock = vi.hoisted(() => ({
  pathname: '/settings/general',
  href: '/settings/general',
  matches: [] as Array<{ routeId: string; params: Record<string, string> }>,
  outlet: null as ReactNode | null,
}))

vi.mock('@tanstack/react-router', () => ({
  Outlet: () => layoutRouterMock.outlet,
  useRouterState: (options?: { select?: (state: unknown) => unknown }) => {
    const state = {
      location: { pathname: layoutRouterMock.pathname, href: layoutRouterMock.href },
      matches: layoutRouterMock.matches,
    }
    return options?.select ? options.select(state) : state
  },
}))

vi.mock('@tanstack/react-router-devtools', () => ({
  TanStackRouterDevtools: () => null,
}))

vi.mock('#/web/components/TokenGate.tsx', () => ({
  TokenGate: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

vi.mock('#/web/hooks/usePublicAppBootstrap.ts', () => ({
  usePublicAppBootstrap: () => undefined,
}))

vi.mock('#/web/hooks/useAuthenticatedAppBootstrap.ts', () => ({
  useAuthenticatedAppBootstrap: () => ({ state: { status: 'ready' }, retry: vi.fn() }),
}))

vi.mock('#/web/hooks/useSettingsWriteErrorToast.ts', () => ({
  useSettingsWriteErrorToast: () => undefined,
}))

vi.mock('#/web/workspace-navigation-history.ts', async () => {
  const actual = await vi.importActual<typeof import('#/web/workspace-navigation-history.ts')>(
    '#/web/workspace-navigation-history.ts',
  )
  return {
    ...actual,
    usePrimaryWindowHistoryPresentationObserver: () => undefined,
  }
})

vi.mock('#/web/components/terminal/TerminalSessionProvider.tsx', async () => {
  const React = await vi.importActual<typeof import('react')>('react')
  const context = await vi.importActual<typeof import('#/web/components/terminal/terminal-session-context.ts')>(
    '#/web/components/terminal/terminal-session-context.ts',
  )
  const readContext: TerminalSessionReadContextValue = {
    terminalWorktreeSnapshot: () => ({
      terminalWorktreeKey: '',
      selectedDescriptor: null,
      sessions: [],
      count: 0,
      bellCount: 0,
      outputActiveCount: 0,
      createPending: false,
    }),
    subscribeTerminalWorktree: () => () => {},
    repoBellCount: () => 4,
    subscribeRepoBellCount: () => () => {},
    snapshot: () => ({ phase: 'opening', message: null, processName: 'terminal' }),
    subscribeSnapshot: () => () => {},
  }
  const commandContext: TerminalSessionContextValue = {
    createTerminal: vi.fn(async () => ''),
    createTerminalWithAdmission: vi.fn(async () => ({
      terminalSessionId: '',
      branch: 'main',
      resourceDisposition: 'created',
      workspacePaneTabs: { revision: 0, entries: [] },
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
  }
  return {
    TerminalSessionProvider: ({ children }: { children: ReactNode }) =>
      React.createElement(
        context.TerminalSessionContext,
        { value: commandContext },
        React.createElement(context.TerminalSessionReadContext, { value: readContext }, children),
      ),
  }
})

vi.mock('#/web/components/SplitPane.tsx', () => ({
  SplitPane: ({ before, after, afterSize }: { before: ReactNode; after: ReactNode; afterSize: number }) => (
    <div data-testid="mock-split-pane" data-after-size={afterSize}>
      {before}
      {after}
    </div>
  ),
}))

beforeEach(() => {
  layoutRouterMock.pathname = '/settings/general'
  layoutRouterMock.href = '/settings/general'
  layoutRouterMock.matches = []
  layoutRouterMock.outlet = null
})

function SettingsRetainedOutletTerminalConsumer() {
  const bellCounts = useRepoTerminalBellCounts(['repo-a'])
  return <span data-testid="settings-retained-terminal-consumer">{bellCounts['repo-a']}</span>
}

describe('Layout shell providers', () => {
  test('keeps terminal read context above the settings shell outlet', () => {
    layoutRouterMock.outlet = <SettingsRetainedOutletTerminalConsumer />

    const { getByTestId } = renderInJsdom(<Layout />)

    expect(getByTestId('settings-retained-terminal-consumer').textContent).toBe('4')
  })
})

describe('CompactRepoWorkspace', () => {
  test('marks the inactive pane inert while sharing workspace motion tokens', () => {
    const { container, rerender } = renderCompactWorkspace('navigator')

    expect(compactWorkspace(container)?.dataset.activePane).toBe('navigator')
    expect(compactWorkspace(container)?.style.getPropertyValue('--goblin-workspace-pane-transition-duration')).toBe(
      `${WORKSPACE_PANE_TRANSITION_MS}ms`,
    )
    expect(compactPane(container, 'navigator')?.getAttribute('aria-hidden')).toBeNull()
    expect(compactPane(container, 'navigator')?.hasAttribute('inert')).toBe(false)
    expect(compactPane(container, 'workspace')?.getAttribute('aria-hidden')).toBe('true')
    expect(compactPane(container, 'workspace')?.hasAttribute('inert')).toBe(true)

    rerender(
      <CompactRepoWorkspace
        activePane="workspace"
        sidebarPane={<button type="button">navigator</button>}
        repoWorkspacePane={<button type="button">workspace</button>}
      />,
    )

    expect(compactWorkspace(container)?.dataset.activePane).toBe('workspace')
    expect(compactPane(container, 'navigator')?.getAttribute('aria-hidden')).toBe('true')
    expect(compactPane(container, 'navigator')?.hasAttribute('inert')).toBe(true)
    expect(compactPane(container, 'workspace')?.getAttribute('aria-hidden')).toBeNull()
    expect(compactPane(container, 'workspace')?.hasAttribute('inert')).toBe(false)
  })

  test('retains the outgoing workspace pane content for the slide-out transition', () => {
    vi.useFakeTimers()
    try {
      const { container, rerender } = renderInJsdom(
        <CompactRepoWorkspace
          activePane="workspace"
          sidebarPane={<button type="button">navigator</button>}
          repoWorkspacePane={<div data-testid="workspace-a">workspace-a</div>}
          transitionScopeKey="repo-a"
        />,
      )

      expect(compactPane(container, 'workspace')?.textContent).toContain('workspace-a')

      rerender(
        <CompactRepoWorkspace
          activePane="navigator"
          sidebarPane={<button type="button">navigator</button>}
          repoWorkspacePane={<div data-testid="workspace-b">workspace-b</div>}
          transitionScopeKey="repo-a"
        />,
      )

      expect(compactWorkspace(container)?.dataset.activePane).toBe('navigator')
      expect(compactPane(container, 'workspace')?.textContent).toContain('workspace-a')
      expect(compactPane(container, 'workspace')?.textContent).not.toContain('workspace-b')

      act(() => {
        vi.advanceTimersByTime(WORKSPACE_PANE_TRANSITION_MS)
      })

      expect(compactPane(container, 'workspace')?.textContent).toContain('workspace-b')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('RepoWorkspace', () => {
  test('defaults the split layout to a 30/70 sidebar/workspace ratio', () => {
    const { container } = renderInJsdom(
      <RepoWorkspace sidebarPane={<div>navigator</div>} repoWorkspacePane={<div>workspace</div>} />,
    )

    expect(splitPane(container)?.dataset.afterSize).toBe('70')
  })
})

describe('authenticatedAppShellMode', () => {
  test('settings routes render outside the workspace boot gate', () => {
    expect(authenticatedAppShellMode('/settings/general', restoringWorkspaceState)).toBe('settings')
    expect(authenticatedAppShellMode('/settings/shortcuts', readyState)).toBe('settings')
  })

  test('workspace routes wait for authenticated boot before mounting runtime', () => {
    expect(authenticatedAppShellMode('/', restoringWorkspaceState)).toBe('workspace-restore')
    expect(authenticatedAppShellMode('/repo/repo/dashboard', restoringWorkspaceState)).toBe('workspace-restore')
    expect(authenticatedAppShellMode('/repo/repo/dashboard', readyState)).toBe('workspace-ready')
    expect(authenticatedAppShellMode('/repo/repo/dashboard', failedState)).toBe('workspace-failed')
  })
})

function renderCompactWorkspace(activePane: 'navigator' | 'workspace') {
  return renderInJsdom(
    <CompactRepoWorkspace
      activePane={activePane}
      sidebarPane={<button type="button">navigator</button>}
      repoWorkspacePane={<button type="button">workspace</button>}
    />,
  )
}

function compactWorkspace(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>('[data-compact-workspace]') ?? null
}

function compactPane(container: HTMLElement, pane: 'navigator' | 'workspace'): HTMLElement | null {
  return container.querySelector<HTMLElement>(`[data-compact-workspace-pane="${pane}"]`) ?? null
}

function splitPane(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>('[data-testid="mock-split-pane"]') ?? null
}
