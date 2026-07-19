// @vitest-environment jsdom

import { afterEach, describe, expect, test, vi } from 'vitest'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { EmptyWorkspaceView } from '#/web/components/EmptyWorkspaceView.tsx'

const responsiveMocks = vi.hoisted(() => ({
  mode: 'default' as 'default' | 'compact',
}))

vi.mock('#/web/hooks/useResponsiveUiMode.tsx', () => ({
  useResponsiveUiMode: () => responsiveMocks.mode,
  useIsCompactUi: () => responsiveMocks.mode === 'compact',
}))

vi.mock('#/web/components/workspace-layout/WorkspaceLayoutShell.tsx', () => ({
  WorkspaceLayoutShell: (props: any) => (
    <div
      data-testid="repo-workspace-shell"
      data-compact={String(props.compact)}
      data-zen-mode={String(props.zenMode)}
      data-workspace-pane-active={String(props.workspacePaneActive)}
      data-zen-mode-toggle-enabled={String(props.zenModeToggleEnabled)}
      data-single-pane-active-pane={props.singlePaneActivePane}
    >
      {props.sidebarPane}
      {props.workspacePane}
    </div>
  ),
}))

vi.mock('#/web/components/workspace-layout/WorkspaceLayoutSidebar.tsx', () => ({
  WorkspaceLayoutSidebar: (props: any) => (
    <div data-testid="workspace-shell-sidebar" data-compact={String(props.compact)} />
  ),
}))

vi.mock('#/web/components/workspace-toolbar-chrome.tsx', () => ({
  WorkspaceChrome: () => <div data-testid="workspace-chrome" />,
}))

afterEach(() => {
  responsiveMocks.mode = 'default'
})

function renderEmptyWorkspaceView() {
  return renderInJsdom(<EmptyWorkspaceView onOpenSettings={() => {}} />)
}

describe('EmptyWorkspaceView', () => {
  test('disables zen toggle and pins the navigator pane in compact mode', () => {
    responsiveMocks.mode = 'compact'
    const { container } = renderEmptyWorkspaceView()

    const shell = container.querySelector<HTMLElement>('[data-testid="repo-workspace-shell"]')
    expect(shell).not.toBeNull()
    expect(shell?.dataset.zenModeToggleEnabled).toBe('false')
    expect(shell?.dataset.singlePaneActivePane).toBe('navigator')
    expect(shell?.dataset.compact).toBe('true')
  })

  test('keeps workspace inactive by default even outside compact mode', () => {
    responsiveMocks.mode = 'default'
    const { container } = renderEmptyWorkspaceView()

    const shell = container.querySelector<HTMLElement>('[data-testid="repo-workspace-shell"]')
    expect(shell?.dataset.zenMode).toBe('false')
    expect(shell?.dataset.workspacePaneActive).toBe('false')
  })
})
