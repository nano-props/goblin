// @vitest-environment jsdom

// Lightweight contract test for BranchListPopover. Radix HoverCard
// requires ResizeObserver and animation timings that jsdom doesn't
// provide — full open/close behaviour is covered manually. What we
// CAN assert in jsdom is that the trigger slot is rendered for both
// a known and an unknown repo. The popover doesn't subscribe to the
// store, so a workspaceFocused flip is no longer its concern (the
// parent unmounts it). Branch action dialogs are no longer mounted
// inside the popover — see BranchActionDialogHost — so we don't need
// to stub BranchActionsMenu anymore.
//
// BranchList's own behaviour is covered in BranchList.test.tsx.

import { act } from 'react'
import type { ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { BranchListPopover } from '#/web/components/branch-navigator/BranchListPopover.tsx'
import { createRepoBranch, resetReposStore, seedRepoState } from '#/web/stores/repos/test-utils.ts'

const mocks = vi.hoisted(() => ({
  navigation: {
    selectRepoBranch: vi.fn(),
  },
}))

vi.mock('#/web/stores/i18n.ts', () => ({
  useI18nStore: (selector: (state: { lang: string }) => string) => selector({ lang: 'zh' }),
  useT: () => (key: string) => key,
}))

vi.mock('#/web/main-window-navigation.tsx', () => ({
  useMainWindowNavigation: () => mocks.navigation,
}))

vi.mock('#/web/components/branch-workspace/open-workspace-pane-view.ts', () => ({
  openWorkspacePaneView: vi.fn(),
}))

vi.mock('#/web/components/terminal/terminal-session-store.ts', () => ({
  useWorktreeTerminalBellCount: () => 0,
}))

let container: HTMLDivElement | null = null
let root: Root | null = null

const reactActEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }

beforeEach(() => {
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
  mocks.navigation.selectRepoBranch.mockClear()
  resetReposStore()
  seedRepoState({
    id: '/tmp/repo',
    branches: [createRepoBranch('main'), createRepoBranch('feature/a')],
  })
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
  document.body.innerHTML = ''
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
  vi.clearAllMocks()
})

describe('BranchListPopover', () => {
  test('renders the trigger slot', () => {
    render(
      <BranchListPopover repoId="/tmp/repo">
        <button data-testid="trigger">trigger</button>
      </BranchListPopover>,
    )

    expect(document.querySelector('[data-testid="trigger"]')).not.toBeNull()
  })

  test('renders the trigger slot even when the repo is missing', () => {
    render(
      <BranchListPopover repoId="/missing">
        <button data-testid="trigger">trigger</button>
      </BranchListPopover>,
    )

    expect(document.querySelector('[data-testid="trigger"]')).not.toBeNull()
  })
})

function render(element: ReactNode) {
  act(() => {
    root!.render(element)
  })
}