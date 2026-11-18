// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from 'vitest'
import { defineComponent, ref } from 'vue'
import { screen } from '@testing-library/vue'
import { userEvent } from '@testing-library/user-event'
import { workspacePickerItemsEqual } from '#/web/components/workspace-picker/summary-equality.ts'
import type { WorkspacePickerItem } from '#/web/components/workspace-picker/types.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { flushTestUpdates, renderInJsdom } from '#/test-utils/render.tsx'
import { WorkspacePickerHost } from '#/web/components/WorkspacePickerHost.tsx'
import { emptyWorkspace } from '#/web/stores/workspaces/workspace-state-factory.ts'
import { resetWorkspacesStore } from '#/web/test-utils/repo-store.ts'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'

const navigationMocks = vi.hoisted(() => ({
  activateWorkspace: vi.fn(),
  openWorkspaceNavigator: vi.fn(),
  openWorkspaceDashboard: vi.fn(),
  compact: { value: false },
}))

vi.mock('#/web/app/navigation/route-navigation.ts', () => ({
  useAppRouteNavigation: () => ({
    openWorkspaceNavigator: navigationMocks.openWorkspaceNavigator,
    openWorkspaceDashboard: navigationMocks.openWorkspaceDashboard,
  }),
}))
vi.mock('#/web/hooks/useResponsiveUiMode.tsx', () => ({
  useIsCompactUi: () => navigationMocks.compact,
}))

vi.mock('#/web/terminal/components/terminal-session-store.ts', () => ({
  useWorkspaceTerminalBellCounts: () => ({ value: {} }),
}))
vi.mock('#/web/app/navigation/context.tsx', () => ({
  useAppNavigation: () => ({
    activateWorkspace: navigationMocks.activateWorkspace,
    closeWorkspace: vi.fn(async () => ({ ok: true })),
  }),
}))

beforeEach(() => {
  resetWorkspacesStore()
  navigationMocks.compact.value = false
  navigationMocks.activateWorkspace.mockClear()
  navigationMocks.openWorkspaceNavigator.mockClear()
  navigationMocks.openWorkspaceDashboard.mockClear()
})

describe('WorkspacePickerHost', () => {
  test('binds a remote workspace directory name into the picker from its canonical id', async () => {
    const workspaceId = workspaceIdForTest('goblin+ssh://example/home/developer/Documents')
    const workspace = emptyWorkspace(workspaceId, 'workspace-runtime-picker')
    workspacesStore.setState({ workspaces: { [workspaceId]: workspace }, workspaceOrder: [workspaceId] })

    const { container } = renderInJsdom(
      <WorkspacePickerHost
        currentWorkspaceId={workspaceId}
        onOpenWorkspacePathDialog={vi.fn()}
        onOpenRemote={vi.fn()}
        onClone={vi.fn()}
      />,
    )

    expect(container.textContent).toContain('Documents')
    expect(container.textContent).not.toContain('example:Documents')
  })

  test('toggles the list and follows the current workspace while filtered', async () => {
    const first = workspaceIdForTest('goblin+file:///tmp/sample-one')
    const second = workspaceIdForTest('goblin+file:///tmp/sample-two')
    workspacesStore.setState({
      workspaces: {
        [first]: emptyWorkspace(first, 'workspace-runtime-one'),
        [second]: emptyWorkspace(second, 'workspace-runtime-two'),
      },
      workspaceOrder: [first, second],
    })
    const currentWorkspaceId = ref<WorkspacePickerItem['id'] | null>(first)
    const Harness = defineComponent(() => () => (
      <WorkspacePickerHost
        currentWorkspaceId={currentWorkspaceId.value}
        onOpenWorkspacePathDialog={vi.fn()}
        onOpenRemote={vi.fn()}
        onClone={vi.fn()}
      />
    ))
    renderInJsdom(<Harness />)

    const user = userEvent.setup()
    const filter = screen.getByRole('button', { name: 'workspace-picker.filter-label' })
    expect(screen.getByRole('button', { name: 'sample-two' })).toBeTruthy()
    await user.click(filter)
    expect(filter.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'sample-one' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'sample-two' })).toBeNull()

    const currentRow = screen.getByRole('button', { name: 'sample-one' })
    currentRow.focus()
    await user.keyboard('{ArrowDown}{ArrowUp}{Home}{End}')
    expect(document.activeElement).toBe(currentRow)
    expect(navigationMocks.activateWorkspace).not.toHaveBeenCalled()

    await flushTestUpdates(() => {
      currentWorkspaceId.value = second
    })
    expect(screen.queryByRole('button', { name: 'sample-one' })).toBeNull()
    expect(screen.getByRole('button', { name: 'sample-two' })).toBeTruthy()

    await flushTestUpdates(() => {
      currentWorkspaceId.value = null
    })
    expect(screen.getByRole('button', { name: 'sample-one' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'sample-two' })).toBeTruthy()
    expect(filter.getAttribute('aria-pressed')).toBe('true')
    expect(filter.getAttribute('aria-description')).toBe('workspace-picker.filter-tooltip.pending')

    await flushTestUpdates(() => {
      currentWorkspaceId.value = second
    })
    await user.click(filter)
    expect(filter.getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByRole('button', { name: 'sample-one' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'sample-two' })).toBeTruthy()
  })

  test.each([
    { compact: true, action: 'openWorkspaceNavigator', otherAction: 'activateWorkspace' },
    { compact: false, action: 'activateWorkspace', otherAction: 'openWorkspaceNavigator' },
  ] as const)('switches using $action when compact is $compact', async ({ compact, action, otherAction }) => {
    navigationMocks.compact.value = compact
    const first = workspaceIdForTest('goblin+file:///tmp/sample-one')
    const second = workspaceIdForTest('goblin+file:///tmp/sample-two')
    workspacesStore.setState({
      workspaces: {
        [first]: emptyWorkspace(first, 'workspace-runtime-one'),
        [second]: emptyWorkspace(second, 'workspace-runtime-two'),
      },
      workspaceOrder: [first, second],
    })
    renderInJsdom(
      <WorkspacePickerHost
        currentWorkspaceId={first}
        onOpenWorkspacePathDialog={vi.fn()}
        onOpenRemote={vi.fn()}
        onClone={vi.fn()}
      />,
    )

    const user = userEvent.setup()
    const target = screen.getByRole('button', { name: 'sample-two' })
    await user.click(target)

    expect(navigationMocks[action]).toHaveBeenCalledWith(second, undefined)
    expect(navigationMocks[otherAction]).not.toHaveBeenCalled()
    expect(navigationMocks.openWorkspaceDashboard).not.toHaveBeenCalled()

    await user.dblClick(target)

    expect(navigationMocks.openWorkspaceDashboard).toHaveBeenCalledExactlyOnceWith(second)
  })
})

describe('workspacePickerItemsEqual', () => {
  test('treats Git capability changes as unequal', async () => {
    const item: WorkspacePickerItem = {
      id: workspaceIdForTest('goblin+file:///tmp/workspace'),
      name: 'workspace',
      gitAvailable: false,
      lifecycle: null,
    }

    expect(workspacePickerItemsEqual([item], [{ ...item, gitAvailable: true }])).toBe(false)
  })

  test('treats remote lifecycle target changes as unequal even when repo id stays the same', async () => {
    const left: WorkspacePickerItem[] = [
      {
        id: workspaceIdForTest('goblin+ssh://example/srv/repo'),
        name: 'repo',
        gitAvailable: true,
        lifecycle: {
          kind: 'ready',
          target: {
            id: workspaceIdForTest('goblin+ssh://example/srv/repo'),
            alias: 'example',
            host: 'old-host.internal',
            user: 'old-user',
            port: 22,
            remotePath: '/srv/repo',
            displayName: 'example:repo',
          },
        },
      },
    ]
    const right: WorkspacePickerItem[] = [
      {
        id: workspaceIdForTest('goblin+ssh://example/srv/repo'),
        name: 'repo',
        gitAvailable: true,
        lifecycle: {
          kind: 'ready',
          target: {
            id: workspaceIdForTest('goblin+ssh://example/srv/repo'),
            alias: 'example',
            host: 'new-host.internal',
            user: 'new-user',
            port: 2222,
            remotePath: '/srv/repo',
            displayName: 'example-renamed:repo',
          },
        },
      },
    ]

    expect(workspacePickerItemsEqual(left, right)).toBe(false)
  })

  test('treats failed lifecycle target locator changes as unequal', async () => {
    const target = {
      id: workspaceIdForTest('goblin+ssh://example/srv/repo'),
      alias: 'example',
      host: 'same-host.internal',
      user: 'old-user',
      port: 22,
      remotePath: '/srv/repo',
      displayName: 'example:repo',
    }
    const left: WorkspacePickerItem[] = [
      {
        id: target.id,
        name: 'repo',
        gitAvailable: true,
        lifecycle: {
          kind: 'failed',
          reason: 'timeout',
          target,
        },
      },
    ]
    const right: WorkspacePickerItem[] = [
      {
        id: target.id,
        name: 'repo',
        gitAvailable: true,
        lifecycle: {
          kind: 'failed',
          reason: 'timeout',
          target: {
            ...target,
            user: 'new-user',
            port: 2222,
            displayName: 'example-renamed:repo',
          },
        },
      },
    ]

    expect(workspacePickerItemsEqual(left, right)).toBe(false)
  })

  test('treats terminal bell count changes as unequal', async () => {
    const left: WorkspacePickerItem[] = [
      {
        id: workspaceIdForTest('goblin+file:///tmp/repo'),
        name: 'repo',
        gitAvailable: true,
        terminalBellCount: 1,
        lifecycle: null,
      },
    ]
    const right: WorkspacePickerItem[] = [
      {
        id: workspaceIdForTest('goblin+file:///tmp/repo'),
        name: 'repo',
        gitAvailable: true,
        terminalBellCount: 2,
        lifecycle: null,
      },
    ]

    expect(workspacePickerItemsEqual(left, right)).toBe(false)
  })
})
