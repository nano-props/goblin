// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { EmptyRepoView } from '#/web/components/EmptyRepoView.tsx'

const responsiveMocks = vi.hoisted(() => ({
  mode: 'default' as 'default' | 'compact',
}))

vi.mock('#/web/hooks/useResponsiveUiMode.tsx', () => ({
  useResponsiveUiMode: () => responsiveMocks.mode,
  useIsCompactUi: () => responsiveMocks.mode === 'compact',
}))

vi.mock('#/web/components/repo-shell/RepoWorkspaceShell.tsx', () => ({
  RepoWorkspaceShell: (props: any) => (
    <div
      data-testid="repo-workspace-shell"
      data-compact={String(props.compact)}
      data-zen-mode={String(props.zenMode)}
      data-branch-workspace-active={String(props.branchWorkspaceActive)}
      data-focus-toggle-enabled={String(props.focusToggleEnabled)}
      data-single-pane-active-pane={props.singlePaneActivePane}
    >
      {props.branchNavigatorPane}
      {props.branchWorkspacePane}
    </div>
  ),
}))

vi.mock('#/web/components/repo-shell/RepoShellSidebar.tsx', () => ({
  RepoShellSidebar: (props: any) => <div data-testid="repo-shell-sidebar" data-compact={String(props.compact)} />,
}))

vi.mock('#/web/components/workspace-toolbar-chrome.tsx', () => ({
  WorkspaceChrome: () => <div data-testid="workspace-chrome" />,
}))

let container: HTMLDivElement | null = null
let root: Root | null = null
const reactActEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }

beforeEach(() => {
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  container?.remove()
  root = null
  container = null
  responsiveMocks.mode = 'default'
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
})

function renderEmptyRepoView() {
  act(() => {
    root!.render(<EmptyRepoView onOpenSettings={() => {}} />)
  })
}

describe('EmptyRepoView', () => {
  test('disables focus toggle and pins the navigator pane in compact mode', () => {
    responsiveMocks.mode = 'compact'
    renderEmptyRepoView()

    const shell = container!.querySelector<HTMLElement>('[data-testid="repo-workspace-shell"]')
    expect(shell).not.toBeNull()
    expect(shell?.dataset.focusToggleEnabled).toBe('false')
    expect(shell?.dataset.singlePaneActivePane).toBe('navigator')
    expect(shell?.dataset.compact).toBe('true')
  })

  test('keeps workspace inactive by default even outside compact mode', () => {
    responsiveMocks.mode = 'default'
    renderEmptyRepoView()

    const shell = container!.querySelector<HTMLElement>('[data-testid="repo-workspace-shell"]')
    expect(shell?.dataset.zenMode).toBe('false')
    expect(shell?.dataset.branchWorkspaceActive).toBe('false')
  })
})
