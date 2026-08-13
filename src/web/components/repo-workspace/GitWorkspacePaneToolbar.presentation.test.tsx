// @vitest-environment jsdom

import { flushTestUpdates } from '#/test-utils/render.tsx'
import { describe, expect, test, vi } from 'vitest'
import { terminalSessionBaseForTest } from '#/web/test-utils/terminal-model.ts'
import type { AppNavigationActions } from '#/web/app-navigation-actions.ts'
import {
  REPO_ID,
  WORKTREE_PATH,
  closeButtonFor,
  flush,
  navigationWith,
  openPopover,
  openTabsFor,
  renderToolbar,
  staticEntry,
  terminalEntry,
  toolbarResponsiveMocks,
  workspaceRuntimeIdForTest,
} from '#/web/test-utils/git-workspace-pane-toolbar.tsx'

describe('GitWorkspacePaneToolbar presentation', () => {
  test('renders a status tab for a selected branch without a worktree', async () => {
    const showRepoBranchWorkspacePaneTab = vi.fn(() => true)
    const { container: c, terminalTab } = renderToolbar({
      terminalCount: 0,
      worktree: false,
      navigation: navigationWith({ showRepoBranchWorkspacePaneTab }),
    })

    const tabs = Array.from(c.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? [])
    expect(tabs).toHaveLength(1)
    expect(tabs[0]?.id).toBe('workspace-status-tab')
    expect(tabs[0]?.textContent).toBe('tab.status')
    expect(tabs[0]?.getAttribute('aria-controls')).toBe('workspace-status-panel')
    expect(c.querySelector('#workspace-workspace-pane-tab-empty')).toBeNull()
    expect(c.querySelector('button[aria-label="terminal.new"]')).toBeNull()

    await flushTestUpdates(() => {
      terminalTab.click()
    })
    await flush()

    expect(showRepoBranchWorkspacePaneTab).not.toHaveBeenCalled()
  })

  test('keeps the focus-offset leading spacer mounted for width transitions', () => {
    const { container: c } = renderToolbar({
      terminalCount: 0,
      worktree: false,
      navigation: navigationWith({}),
      trafficLightOffset: true,
    })

    const toolbarClassName = c.querySelector('.goblin-workspace-toolbar')?.className ?? ''
    expect(toolbarClassName).toContain('goblin-workspace-toolbar--traffic-offset')
    expect(toolbarClassName).toContain('gap-0')
    expect(c.querySelector('[data-testid="workspace-toolbar-leading-spacer"]')?.className).toContain(
      'goblin-workspace-toolbar__leading-spacer--reserved',
    )
    expect(
      c.querySelector<HTMLElement>('[data-testid="workspace-toolbar-leading-no-drag"]')?.dataset.titleBarChromeRegion,
    ).toBe('no-drag')
  })

  test('keeps the leading spacer mounted when the focus offset is inactive', () => {
    const { container: c } = renderToolbar({
      terminalCount: 0,
      worktree: false,
      navigation: navigationWith({}),
      trafficLightOffset: false,
    })

    const toolbarClassName = c.querySelector('.goblin-workspace-toolbar')?.className ?? ''
    expect(toolbarClassName).not.toContain('title-bar-chrome')
    expect(toolbarClassName).not.toContain('goblin-workspace-toolbar--non-draggable')
    expect(toolbarClassName).toContain('gap-0')
    expect(c.querySelector('[data-testid="workspace-toolbar-leading-spacer"]')).not.toBeNull()
    expect(c.querySelector('[data-testid="workspace-toolbar-leading-spacer"]')?.className).not.toContain(
      'goblin-workspace-toolbar__leading-spacer--reserved',
    )
    expect(c.querySelector('[data-testid="workspace-toolbar-leading-no-drag"]')).toBeNull()
  })

  test('does not opt compact toolbar chrome into window dragging', () => {
    toolbarResponsiveMocks.compactUi = true
    const { container: c } = renderToolbar({
      terminalCount: 0,
      worktree: false,
      navigation: navigationWith({}),
    })

    expect(c.querySelector('.goblin-workspace-toolbar')?.className).not.toContain('app-drag-region')
    expect(c.querySelector('.goblin-workspace-toolbar')?.className).not.toContain('title-bar-chrome')
    expect(c.querySelector('.goblin-workspace-toolbar')?.className).toContain('goblin-workspace-toolbar--non-draggable')
  })

  test('renders status and terminal affordance without a default changes tab', () => {
    const { container: c } = renderToolbar({ terminalCount: 0, changeCount: 3, navigation: navigationWith({}) })

    const tabs = Array.from(c.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? [])
    expect(tabs.map((tab) => tab.id)).toEqual(['workspace-status-tab'])
    // The empty state is a plus icon button — no text label, just an aria-label/tooltip
    // describing the action. `useT` is mocked to return the key string, so checking that
    // textContent does not contain "terminal.label" guards against regressing back to
    // the old text-only button that rendered `t('terminal.label')` as its label.
    const emptyButton = c.querySelector<HTMLButtonElement>('button[aria-label="terminal.new"]')
    expect(emptyButton).not.toBeNull()
    expect(emptyButton?.textContent ?? '').not.toContain('terminal.label')
    expect(emptyButton?.getAttribute('aria-label')).toBe('terminal.new')
    expect(emptyButton?.getAttribute('title')).toBe('terminal.new')
    expect(c.querySelector('[data-workspace-pane-tab-tooltip-id="workspace-pane:status"]')).not.toBeNull()
    expect(c.querySelector('[data-workspace-pane-tab-tooltip-id="workspace-pane:changes"]')).toBeNull()
  })

  test('renders status and terminal tabs in one workspace tab strip with a separator', () => {
    const { container: c } = renderToolbar({
      terminalCount: 1,
      navigation: navigationWith({}),
    })

    const tablist = c.querySelector('[role="tablist"][aria-label="workspace-pane-tabs.tabs"]')
    expect(tablist).not.toBeNull()
    expect(c.querySelectorAll('[role="tablist"][aria-label="workspace-pane-tabs.tabs"]')).toHaveLength(1)
    expect(tablist?.querySelector('#workspace-status-tab')).not.toBeNull()
    expect(tablist?.querySelector('#workspace-workspace-pane-tab')).not.toBeNull()
  })

  test('renders saved mixed tab list across terminal and static tabs', () => {
    const { container: c } = renderToolbar({
      terminalCount: 1,
      workspacePaneTabs: [terminalEntry('term-111111111111111111111'), staticEntry('status')],
      navigation: navigationWith({}),
    })

    const tabs = Array.from(c.querySelectorAll('[data-workspace-pane-tab-tooltip-id]')).map((node) =>
      node.getAttribute('data-workspace-pane-tab-tooltip-id'),
    )
    expect(tabs.slice(0, 2)).toEqual(['terminal:term-111111111111111111111', 'workspace-pane:status'])
  })

  test('uses the workspace toolbar spacing primitives without generic toolbar gaps', () => {
    const { container: c } = renderToolbar({
      terminalCount: 3,
      navigation: navigationWith({}),
    })

    const toolbar = c.firstElementChild
    if (!(toolbar instanceof HTMLElement)) throw new Error('missing toolbar')
    const spacer = toolbar.firstElementChild
    const content = toolbar.children[1]
    if (!(spacer instanceof HTMLElement)) throw new Error('missing leading spacer')
    if (!(content instanceof HTMLElement)) throw new Error('missing workspace toolbar content')
    const primary = content.firstElementChild
    const actions = content.querySelector('[data-workspace-toolbar-trailing-actions]')
    if (!(primary instanceof HTMLElement)) throw new Error('missing workspace toolbar primary group')
    if (!(actions instanceof HTMLElement)) throw new Error('missing workspace toolbar actions group')

    expect(toolbar.children).toHaveLength(2)
    expect(toolbar.className).toContain('gap-0')
    expect(toolbar.className).not.toContain('gap-2')
    expect(spacer.className).toContain('goblin-workspace-toolbar__leading-spacer')
    expect(spacer.className).not.toContain('goblin-workspace-toolbar__leading-spacer--reserved')
    expect(content.className).toContain('goblin-workspace-toolbar__content')
    expect(primary.className).toContain('goblin-workspace-toolbar__primary')
    expect(actions.className).toContain('goblin-workspace-toolbar__actions')
  })

  test('renders static tabs from the saved workspace pane tab list without runtime materialization', async () => {
    const { container: c } = renderToolbar({
      terminalCount: 0,
      preferredWorkspacePaneTab: 'history',
      workspacePaneStaticTabs: ['history', 'status'],
      navigation: navigationWith({}),
    })
    await flush()

    const tabs = Array.from(c.querySelectorAll('[data-workspace-pane-tab-tooltip-id]')).map((node) =>
      node.getAttribute('data-workspace-pane-tab-tooltip-id'),
    )
    expect(tabs.slice(0, 2)).toEqual(['workspace-pane:history', 'workspace-pane:status'])
  })

  test('closes the status static tab through the shared tab close control', async () => {
    const { container: c } = renderToolbar({
      terminalCount: 0,
      navigation: navigationWith({}),
    })

    const statusCloseButton = closeButtonFor(c, 'workspace-pane:status')
    expect(statusCloseButton).not.toBeNull()

    await flushTestUpdates(() => {
      statusCloseButton?.click()
    })
    await flush()

    expect(openTabsFor('feature/worktree')).toEqual([])
  })

  test('lands on the adjacent terminal after closing the active status tab', async () => {
    const showRepoBranchWorkspacePaneTab = vi.fn(() => true)
    const commitFilesystemWorkspacePaneRoute = vi.fn<AppNavigationActions['commitFilesystemWorkspacePaneRoute']>(
      async (_target, _route, options) => {
        options?.onCommit?.()
        return true
      },
    )
    const { container: c } = renderToolbar({
      terminalCount: 1,
      navigation: navigationWith({
        showRepoBranchWorkspacePaneTab,
        commitFilesystemWorkspacePaneRoute,
      }),
    })

    const statusCloseButton = closeButtonFor(c, 'workspace-pane:status')
    expect(statusCloseButton).not.toBeNull()

    await flushTestUpdates(() => {
      statusCloseButton?.click()
    })
    await flush()

    expect(openTabsFor('feature/worktree')).toEqual([])
    expect(commitFilesystemWorkspacePaneRoute).toHaveBeenCalledWith(
      expect.objectContaining({
        routeTarget: { kind: 'git-worktree', workspaceId: REPO_ID, worktreePath: WORKTREE_PATH },
      }),
      { kind: 'terminal', terminalSessionId: 'term-111111111111111111111' },
      expect.any(Object),
    )
    expect(showRepoBranchWorkspacePaneTab).not.toHaveBeenCalled()
  })

  test('closes a terminal tab through the shared tab close control', async () => {
    const { container: c, mocks } = renderToolbar({
      terminalCount: 1,
      preferredWorkspacePaneTab: 'terminal',
      navigation: navigationWith({}),
    })

    const terminalCloseButton = closeButtonFor(c, 'terminal:term-111111111111111111111')
    expect(terminalCloseButton).not.toBeNull()

    await flushTestUpdates(() => {
      terminalCloseButton?.click()
    })
    await flush()

    expect(mocks.closeTerminalByDescriptor).toHaveBeenCalledWith(
      'term-111111111111111111111',
      terminalSessionBaseForTest({
        repoRoot: REPO_ID,
        workspaceRuntimeId: workspaceRuntimeIdForTest(),
        branch: 'feature/worktree',
        worktreePath: WORKTREE_PATH,
      }),
    )
  })

  test('closes a static tab without routing through runtime close', async () => {
    const { container: c } = renderToolbar({
      terminalCount: 0,
      preferredWorkspacePaneTab: 'history',
      workspacePaneStaticTabs: ['history', 'status'],
      navigation: navigationWith({}),
    })

    const historyCloseButton = closeButtonFor(c, 'workspace-pane:history')
    expect(historyCloseButton).not.toBeNull()

    await flushTestUpdates(() => {
      historyCloseButton?.click()
    })
    await flush()

    expect(openTabsFor('feature/worktree')).toEqual(['status'])
  })

  test('compact workspace tab popover merges status and terminal tabs', async () => {
    toolbarResponsiveMocks.compactUi = true
    const { container: c } = renderToolbar({
      terminalCount: 1,
      preferredWorkspacePaneTab: 'terminal',
      navigation: navigationWith({}),
    })

    expect(c.querySelectorAll('[role="tab"]')).toHaveLength(1)
    expect(c.querySelector('#workspace-status-tab')).toBeNull()

    const trigger = c.querySelector<HTMLButtonElement>('button[aria-label="workspace-pane-tabs.tabs"]')
    if (!trigger) throw new Error('missing workspace tab popover trigger')

    await openPopover(trigger)

    const list = document.body.querySelector('[role="list"]')
    expect(list?.textContent).toContain('tab.status')
    expect(list?.textContent).toContain('term-1')
    expect(document.body.textContent).toContain('terminal.new')
  })

  test('puts compact back at the start of the workspace tab row', async () => {
    toolbarResponsiveMocks.compactUi = true
    const { container: c } = renderToolbar({
      terminalCount: 1,
      preferredWorkspacePaneTab: 'terminal',
      navigation: navigationWith({}),
    })

    const back = c.querySelector<HTMLButtonElement>('button[aria-label="workspace.back-to-workspace-navigator"]')
    const tablist = c.querySelector('[role="tablist"][aria-label="workspace-pane-tabs.tabs"]')
    // After the refactor the back button lives at the toolbar level, so the
    // tablist is no longer a sibling of an internal "leading action" wrapper.
    // The back button is the first flex child; the strip that hosts the
    // tablist is its next sibling.
    expect(back).not.toBeNull()
    expect(tablist).not.toBeNull()
    const toolbarRow = back?.parentElement
    expect(toolbarRow).not.toBeNull()
    expect(toolbarRow?.firstElementChild).toBe(back)
    // The next sibling of the back button hosts the tablist — this nails down
    // the architectural contract that the strip lives beside (not inside) the
    // back button, so a future refactor can't silently re-couple them.
    const tabStripHost = back?.nextElementSibling
    expect(tabStripHost?.querySelector('[role="tablist"]')).toBe(tablist)

    await flushTestUpdates(() => {
      back?.click()
    })
  })

  test('compact UI keeps the back button visible when the tab strip is empty', () => {
    toolbarResponsiveMocks.compactUi = true
    const { container: c } = renderToolbar({
      terminalCount: 0,
      workspacePaneStaticTabs: [],
      workspacePaneTabs: [],
      navigation: navigationWith({}),
    })

    // Empty strip: no tabs, just the + new terminal affordance.
    expect(c.querySelectorAll('[role="tab"]')).toHaveLength(0)
    expect(c.querySelector('button[aria-label="terminal.new"]')).not.toBeNull()
    // The back button must remain visible so the user can navigate back to
    // the branch navigator — otherwise closing the status tab strands them.
    const back = c.querySelector<HTMLButtonElement>('button[aria-label="workspace.back-to-workspace-navigator"]')
    expect(back).not.toBeNull()
  })

  test('non-compact UI does not render the back button in the toolbar', () => {
    toolbarResponsiveMocks.compactUi = false
    const { container: c } = renderToolbar({
      terminalCount: 1,
      navigation: navigationWith({}),
    })

    // In expanded mode the toolbar delegates navigation to the branch row,
    // so the back button must stay out of the workspace pane toolbar.
    expect(c.querySelector('button[aria-label="workspace.back-to-workspace-navigator"]')).toBeNull()
    // Sanity check: tabs are still rendered in expanded mode.
    expect(c.querySelectorAll('[role="tab"]').length).toBeGreaterThan(0)
  })

  test('compact workspace tab strip keeps the tab switcher available during terminal sync loading', () => {
    toolbarResponsiveMocks.compactUi = true
    const { container: c } = renderToolbar({
      terminalCount: 0,
      navigation: navigationWith({}),
      loading: true,
    })

    expect(c.querySelectorAll('[role="tab"]')).toHaveLength(1)
    expect(c.querySelector('button[aria-label="terminal.new"]')).toBeNull()
    expect(c.querySelector('button[aria-label="terminal.loading"]')).toBeNull()
    expect(c.querySelector('button[aria-label="workspace-pane-tabs.tabs"]')).not.toBeNull()
  })

  test('compact workspace tab strip keeps the popover switcher reachable while the terminal tab is loading', () => {
    // Regression: when the user is viewing the terminal panel while the
    // terminal session projection is still hydrating (`preferredWorkspacePaneTab =
    // 'terminal'`, no materialized terminal tabs), the toolbar's
    // `activeTabIdentity` is null because the tab-model's selection is
    // `runtime-host` with no materialized tab. The compact layout must still be
    // used (a structural choice driven by screen size) — otherwise the
    // strip falls through to the scrollable layout, which renders fixed
    // `w-36` tabs and the busy `+ New` button. The compact body shows an
    // empty tab area in this state and keeps the popover switcher
    // reachable so the user can navigate to an existing tab.
    toolbarResponsiveMocks.compactUi = true
    const { container: c } = renderToolbar({
      terminalCount: 0,
      preferredWorkspacePaneTab: 'terminal',
      navigation: navigationWith({}),
      loading: true,
    })

    const tablist = c.querySelector('[role="tablist"][aria-label="workspace-pane-tabs.tabs"]')
    const tabs = Array.from(c.querySelectorAll('[role="tab"]'))

    expect(tablist).not.toBeNull()
    expect(tablist?.className).toContain('flex-1')
    // No tab is rendered because no tab is active and no terminal is
    // materialized. The compact body renders an empty tab area + chevron.
    expect(tabs).toHaveLength(0)
    // The scrollable-layout affordances (the busy `+ New` button) must
    // stay out of the compact strip — the chevron-driven tab switcher is
    // the only way to reach the workspace pane tabs in compact mode.
    expect(c.querySelector('button[aria-label="terminal.new"]')).toBeNull()
    expect(c.querySelector('button[aria-label="terminal.loading"]')).toBeNull()
    expect(c.querySelector('button[aria-label="workspace-pane-tabs.tabs"]')).not.toBeNull()
  })

  test('compact workspace tab strip shows terminal creation as a full-width pending tab', () => {
    toolbarResponsiveMocks.compactUi = true
    const { container: c } = renderToolbar({
      terminalCount: 0,
      preferredWorkspacePaneTab: 'terminal',
      navigation: navigationWith({}),
      createPending: true,
    })

    const pendingView = c.querySelector('[data-workspace-pane-pending-tab="terminal"]')
    const tab = c.querySelector('[role="tab"][aria-label="terminal.opening"]')

    expect(pendingView).not.toBeNull()
    expect(pendingView?.className).toContain('flex-1')
    expect(pendingView?.textContent).not.toContain('terminal.opening')
    expect(tab?.getAttribute('aria-busy')).toBeNull()
    expect(tab?.getAttribute('aria-selected')).toBe('true')
    expect(c.querySelector('button[aria-label="terminal.loading"]')).toBeNull()
    expect(c.querySelector('button[aria-label="workspace-pane-tabs.tabs"]')).not.toBeNull()
  })

  test('expanded workspace tab strip uses the same pending terminal tab during creation', () => {
    const { container: c } = renderToolbar({
      terminalCount: 0,
      preferredWorkspacePaneTab: 'terminal',
      navigation: navigationWith({}),
      createPending: true,
    })

    const pendingView = c.querySelector('[data-workspace-pane-pending-tab="terminal"]')
    const tabs = Array.from(c.querySelectorAll('[role="tab"]'))

    expect(pendingView).not.toBeNull()
    expect(pendingView?.textContent).not.toContain('terminal.opening')
    expect(tabs.map((tab) => tab.getAttribute('aria-label'))).toEqual(['tab.status', 'terminal.opening'])
    const pendingTab = c.querySelector('[role="tab"][aria-label="terminal.opening"]')
    expect(pendingTab?.getAttribute('aria-busy')).toBeNull()
    expect(pendingTab?.getAttribute('aria-selected')).toBe('true')
    const busyNewButton = c.querySelector<HTMLButtonElement>('[data-workspace-pane-new-button]')
    expect(busyNewButton).not.toBeNull()
    expect(busyNewButton?.getAttribute('aria-label')).toBe('terminal.new')
    expect(busyNewButton?.getAttribute('aria-busy')).toBe('true')
    expect(busyNewButton?.disabled).toBe(true)
    expect(busyNewButton?.querySelector('.animate-spin')).toBeNull()
  })
})
