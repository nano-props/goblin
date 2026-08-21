// @vitest-environment jsdom

import { fireEvent } from '@testing-library/vue'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { VNode } from 'vue'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { AppNavigationProvider } from '#/web/app/navigation/context.tsx'
import { appQueryClient } from '#/web/app/query-client.ts'
import { WorkspaceRootNavigator } from '#/web/components/workspace-navigator/WorkspaceRootNavigator.tsx'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'
import { emptyWorkspace } from '#/web/stores/workspaces/workspace-state-factory.ts'
import { resetWorkspacesStore, seedRepoWithReadModelForTest } from '#/web/test-utils/repo-store.ts'
import { navigation } from '#/web/test-utils/workspace-pane.tsx'
import { VueQueryClientScope } from '#/web/test-utils/VueQueryClientScope.tsx'

const responsiveMocks = vi.hoisted(() => ({ compact: false }))
const workspaceCommandMocks = vi.hoisted(() => ({
  showTab: vi.fn(async () => true),
  terminal: vi.fn(async () => true),
}))

vi.mock('#/web/hooks/useResponsiveUiMode.tsx', () => ({
  useIsCompactUi: () => ({
    get value() {
      return responsiveMocks.compact
    },
  }),
}))

vi.mock('#/web/commands/workspace-commands.ts', () => ({
  runShowWorkspacePaneTabCommand: workspaceCommandMocks.showTab,
  runTerminalPrimaryActionCommand: workspaceCommandMocks.terminal,
}))

const WORKSPACE_ID = workspaceIdForTest('goblin+file:///tmp/workspace-root-navigator-test')

beforeEach(() => {
  responsiveMocks.compact = false
  workspaceCommandMocks.showTab.mockClear()
  workspaceCommandMocks.terminal.mockClear()
  appQueryClient.clear()
  resetWorkspacesStore()
  seedRepoWithReadModelForTest({
    id: WORKSPACE_ID,
    branches: [],
    currentBranchName: null,
    workspaceProbe: {
      status: 'ready',
      capabilities: {
        files: { read: true, write: true },
        terminal: { available: true },
        git: { status: 'unavailable' },
      },
      diagnostics: [],
    },
  })
})

describe('WorkspaceRootNavigator', () => {
  test('renders the workspace root and forwards selection', async () => {
    const onSelect = vi.fn()
    const { container } = renderNavigator(
      <WorkspaceRootNavigator workspaceId={WORKSPACE_ID} selected={false} onSelect={onSelect} />,
    )

    const row = workspaceRow(container)
    expect(row.textContent).toContain('workspace-root-navigator-test')

    await fireEvent.click(row)

    expect(onSelect).toHaveBeenCalledOnce()
  })

  test.each(['status', 'files'] as const)('dispatches the %s workspace tab action', async (tab) => {
    const { container } = renderNavigator(<WorkspaceRootNavigator workspaceId={WORKSPACE_ID} selected={false} />)

    await openActionMenu(container)
    await fireEvent.click(actionButton(`tab.${tab}`))

    expect(workspaceCommandMocks.showTab).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: WORKSPACE_ID, tab }),
    )
  })

  test('opens the status tab when the workspace root is double-clicked', async () => {
    const { container } = renderNavigator(<WorkspaceRootNavigator workspaceId={WORKSPACE_ID} selected={false} />)

    await fireEvent.dblClick(workspaceRow(container))

    expect(workspaceCommandMocks.showTab).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: WORKSPACE_ID, tab: 'status' }),
    )
  })

  test('dispatches the terminal primary action when the capability is available', async () => {
    const { container } = renderNavigator(<WorkspaceRootNavigator workspaceId={WORKSPACE_ID} selected={false} />)

    await openActionMenu(container)
    await fireEvent.click(actionButton('tab.terminal'))

    expect(workspaceCommandMocks.terminal).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: WORKSPACE_ID }))
  })

  test('keeps the remote directory name visible while its capability probe is pending', () => {
    const remoteWorkspaceId = workspaceIdForTest('goblin+ssh://example/home/developer/Documents')
    const workspace = emptyWorkspace(remoteWorkspaceId, 'workspace-runtime-remote')
    workspacesStore.setState({ workspaces: { [remoteWorkspaceId]: workspace }, workspaceOrder: [remoteWorkspaceId] })

    const { container } = renderNavigator(<WorkspaceRootNavigator workspaceId={remoteWorkspaceId} selected={false} />)

    expect(workspaceRow(container).textContent).toContain('Documents')
    expect(workspaceRow(container).textContent).not.toContain('example:')
  })

  test('does not dispatch workspace actions before runtime capabilities are ready', async () => {
    resetWorkspacesStore()
    const workspace = emptyWorkspace(WORKSPACE_ID, 'workspace-runtime-pending')
    workspacesStore.setState({ workspaces: { [WORKSPACE_ID]: workspace }, workspaceOrder: [WORKSPACE_ID] })
    const { container } = renderNavigator(<WorkspaceRootNavigator workspaceId={WORKSPACE_ID} selected={false} />)

    await fireEvent.dblClick(workspaceRow(container))
    await openActionMenu(container)

    expect(actionButton('tab.status').disabled).toBe(true)
    expect(actionButton('tab.files').disabled).toBe(true)
    expect([...document.querySelectorAll('button')].some((button) => button.textContent === 'tab.terminal')).toBe(false)
    expect(workspaceCommandMocks.showTab).not.toHaveBeenCalled()
    expect(workspaceCommandMocks.terminal).not.toHaveBeenCalled()
  })

  test('keeps the row action menu visible in compact UI', () => {
    responsiveMocks.compact = true
    const { container } = renderNavigator(<WorkspaceRootNavigator workspaceId={WORKSPACE_ID} selected={false} />)

    const menuTrigger = container.querySelector('button[aria-label="action.menu"]')
    expect(menuTrigger?.parentElement?.className).not.toContain('opacity-0')
    expect(menuTrigger?.parentElement?.className).toContain('pointer-events-auto')
  })

  test('reveals the desktop row action on hover or focus and keeps it visible while its menu is open', async () => {
    const { container } = renderNavigator(<WorkspaceRootNavigator workspaceId={WORKSPACE_ID} selected={false} />)
    const menuTrigger = container.querySelector('button[aria-label="action.menu"]')
    if (!(menuTrigger instanceof HTMLButtonElement)) throw new Error('missing workspace root action menu')
    const action = menuTrigger.parentElement
    if (!(action instanceof HTMLElement)) throw new Error('missing workspace root action wrapper')

    expect(action.className).toContain('opacity-0')
    expect(action.className).toContain('group-hover:opacity-100')
    expect(action.className).toContain('group-focus-within:opacity-100')

    await fireEvent.click(menuTrigger)

    expect(action.className).not.toContain('opacity-0')
    expect(action.className).toContain('pointer-events-auto')
  })
})

function renderNavigator(element: VNode) {
  return renderInJsdom(
    <VueQueryClientScope client={appQueryClient}>
      <AppNavigationProvider value={navigation}>{element}</AppNavigationProvider>
    </VueQueryClientScope>,
  )
}

function workspaceRow(container: HTMLElement): HTMLElement {
  const row = container.querySelector('[data-testid="workspace-root-row"]')
  if (!(row instanceof HTMLElement)) throw new Error('missing workspace root row')
  return row
}

async function openActionMenu(container: HTMLElement): Promise<void> {
  const trigger = container.querySelector('button[aria-label="action.menu"]')
  if (!(trigger instanceof HTMLButtonElement)) throw new Error('missing workspace root action menu')
  await fireEvent.click(trigger)
}

function actionButton(label: string): HTMLButtonElement {
  const button = [...document.querySelectorAll('button')].find((candidate) => candidate.textContent === label)
  if (!(button instanceof HTMLButtonElement)) throw new Error(`missing ${label} action`)
  return button
}
