// @vitest-environment jsdom

import { afterEach, describe, expect, test, vi } from 'vitest'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { EmptyRepoView } from '#/web/components/EmptyRepoView.tsx'

const responsiveMocks = vi.hoisted(() => ({
  mode: 'default' as 'default' | 'compact',
}))

vi.mock('#/web/hooks/useResponsiveUiMode.tsx', () => ({
  useResponsiveUiMode: () => responsiveMocks.mode,
  useIsCompactUi: () => responsiveMocks.mode === 'compact',
}))

vi.mock('#/web/components/repo-layout/RepoLayoutWorkspaceShell.tsx', () => ({
  RepoLayoutWorkspaceShell: (props: any) => (
    <div
      data-testid="repo-workspace-shell"
      data-compact={String(props.compact)}
      data-zen-mode={String(props.zenMode)}
      data-repo-workspace-active={String(props.repoWorkspaceActive)}
      data-zen-mode-toggle-enabled={String(props.zenModeToggleEnabled)}
      data-single-pane-active-pane={props.singlePaneActivePane}
    >
      {props.sidebarPane}
      {props.repoWorkspacePane}
    </div>
  ),
}))

vi.mock('#/web/components/repo-layout/RepoLayoutSidebar.tsx', () => ({
  RepoLayoutSidebar: (props: any) => <div data-testid="repo-shell-sidebar" data-compact={String(props.compact)} />,
}))

vi.mock('#/web/components/workspace-toolbar-chrome.tsx', () => ({
  WorkspaceChrome: () => <div data-testid="workspace-chrome" />,
}))

afterEach(() => {
  responsiveMocks.mode = 'default'
})

function renderEmptyRepoView() {
  return renderInJsdom(<EmptyRepoView onOpenSettings={() => {}} />)
}

describe('EmptyRepoView', () => {
  test('disables zen toggle and pins the navigator pane in compact mode', () => {
    responsiveMocks.mode = 'compact'
    const { container } = renderEmptyRepoView()

    const shell = container.querySelector<HTMLElement>('[data-testid="repo-workspace-shell"]')
    expect(shell).not.toBeNull()
    expect(shell?.dataset.zenModeToggleEnabled).toBe('false')
    expect(shell?.dataset.singlePaneActivePane).toBe('navigator')
    expect(shell?.dataset.compact).toBe('true')
  })

  test('keeps workspace inactive by default even outside compact mode', () => {
    responsiveMocks.mode = 'default'
    const { container } = renderEmptyRepoView()

    const shell = container.querySelector<HTMLElement>('[data-testid="repo-workspace-shell"]')
    expect(shell?.dataset.zenMode).toBe('false')
    expect(shell?.dataset.repoWorkspaceActive).toBe('false')
  })
})
