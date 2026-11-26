// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from 'vitest'
import { defineComponent, ref } from 'vue'
import { screen, waitFor, within } from '@testing-library/vue'
import { userEvent } from '@testing-library/user-event'
import { workspacePickerItemsEqual } from '#/web/components/workspace-picker/summary-equality.ts'
import type { WorkspacePickerItem } from '#/web/components/workspace-picker/types.ts'
import { mockFetch } from '#/test-utils/fetch-mock.ts'
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

  test.each([
    { count: 1, index: 0, firstDisabled: true, lastDisabled: true },
    { count: 3, index: 1, serverIndexes: [0, 1], firstDisabled: false, lastDisabled: true },
    { count: 3, index: 2, serverIndexes: [0, 1], firstDisabled: true, lastDisabled: true },
    { count: 3, index: 2, serverIndexes: [2, 0, 1], firstDisabled: true, lastDisabled: false },
    { count: 3, index: 0, firstDisabled: true, lastDisabled: false },
    { count: 3, index: 1, firstDisabled: false, lastDisabled: false },
    { count: 3, index: 2, firstDisabled: false, lastDisabled: true },
  ])('shows the available moves for row $index of $count workspaces', async (scenario) => {
    const order = Array.from({ length: scenario.count }, (_, index) =>
      workspaceIdForTest(`goblin+file:///tmp/sample-${index}`),
    )
    const serverOrder = scenario.serverIndexes?.map((index) => order[index]) ?? order
    mockFetch(() => Response.json(serverOrder))
    workspacesStore.setState({
      workspaces: Object.fromEntries(order.map((id, index) => [id, emptyWorkspace(id, `runtime-${index}`)])),
      workspaceOrder: order,
      showActiveWorkspaceOnly: true,
    })
    renderInJsdom(
      <WorkspacePickerHost
        currentWorkspaceId={order[scenario.index]}
        onOpenWorkspacePathDialog={vi.fn()}
        onOpenRemote={vi.fn()}
        onClone={vi.fn()}
      />,
    )

    const user = userEvent.setup()
    const row = screen.getByRole('listitem')
    await user.click(within(row).getByRole('button', { name: 'action.menu' }))

    const moveFirst = screen.getByRole<HTMLButtonElement>('button', { name: 'workspace-picker.move-first' })
    const moveLast = screen.getByRole<HTMLButtonElement>('button', { name: 'workspace-picker.move-last' })
    await waitFor(() => {
      expect(moveFirst.disabled).toBe(scenario.firstDisabled)
      expect(moveLast.disabled).toBe(scenario.lastDisabled)
    })
  })

  test('refreshes the visible order and the move actions together when opening the menu', async () => {
    const first = workspaceIdForTest('goblin+file:///tmp/sample-one')
    const second = workspaceIdForTest('goblin+file:///tmp/sample-two')
    workspacesStore.setState({
      workspaces: {
        [first]: emptyWorkspace(first, 'runtime-one'),
        [second]: emptyWorkspace(second, 'runtime-two'),
      },
      workspaceOrder: [first, second],
    })
    mockFetch(() => Response.json([second, first]))
    renderInJsdom(
      <WorkspacePickerHost
        currentWorkspaceId={first}
        onOpenWorkspacePathDialog={vi.fn()}
        onOpenRemote={vi.fn()}
        onClone={vi.fn()}
      />,
    )

    const user = userEvent.setup()
    const [row] = screen.getAllByRole('listitem')
    await user.click(within(row).getByRole('button', { name: 'action.menu' }))

    await waitFor(() => {
      const [firstRow, lastRow] = screen.getAllByRole('listitem')
      expect(within(firstRow).getByRole('button', { name: 'sample-two' })).toBeTruthy()
      expect(within(lastRow).getByRole('button', { name: 'sample-one', current: true })).toBeTruthy()
      expect(screen.getByRole<HTMLButtonElement>('button', { name: 'workspace-picker.move-first' }).disabled).toBe(
        false,
      )
      expect(screen.getByRole<HTMLButtonElement>('button', { name: 'workspace-picker.move-last' }).disabled).toBe(true)
    })
  })

  test('keeps moves disabled across a remount until the committed order arrives', async () => {
    const first = workspaceIdForTest('goblin+file:///tmp/sample-one')
    const second = workspaceIdForTest('goblin+file:///tmp/sample-two')
    workspacesStore.setState({
      workspaces: {
        [first]: emptyWorkspace(first, 'runtime-one'),
        [second]: emptyWorkspace(second, 'runtime-two'),
      },
      workspaceOrder: [first, second],
    })
    const initialOrder = workspacesStore.getState().workspaceOrder
    const response = Promise.withResolvers<Response>()
    let serverOrder = [first, second]
    const move = vi.fn((_body: RequestInit['body']) => response.promise)
    const readOrder = vi.fn(() => Response.json(serverOrder))
    mockFetch((url, init) => (String(url).endsWith('/order') ? readOrder() : move(init?.body)))
    const renderPicker = () =>
      renderInJsdom(
        <WorkspacePickerHost
          currentWorkspaceId={first}
          onOpenWorkspacePathDialog={vi.fn()}
          onOpenRemote={vi.fn()}
          onClone={vi.fn()}
        />,
      )

    const user = userEvent.setup()
    const firstMenu = renderPicker()
    async function openMenuForFirstWorkspace() {
      const row = screen
        .getAllByRole('listitem')
        .find((item) => within(item).queryByRole('button', { name: 'sample-one' }))
      if (!row) throw new Error('Expected the first workspace row')
      await user.click(within(row).getByRole('button', { name: 'action.menu' }))
    }

    try {
      await openMenuForFirstWorkspace()
      const moveLast = screen.getByRole<HTMLButtonElement>('button', { name: 'workspace-picker.move-last' })
      await waitFor(() => expect(moveLast.disabled).toBe(false))
      expect(workspacesStore.getState().workspaceOrder).toBe(initialOrder)
      await user.click(moveLast)
      expect(move).toHaveBeenCalledExactlyOnceWith(JSON.stringify({ workspaceId: first, edge: 'last' }))

      firstMenu.unmount()
      renderPicker()
      await openMenuForFirstWorkspace()
      const remountedMoveLast = screen.getByRole<HTMLButtonElement>('button', { name: 'workspace-picker.move-last' })
      expect(remountedMoveLast.disabled).toBe(true)
      await user.click(remountedMoveLast)
      expect(move).toHaveBeenCalledOnce()
      expect(readOrder).toHaveBeenCalledOnce()
    } finally {
      serverOrder = [second, first]
      response.resolve(
        Response.json({
          openWorkspaceEntries: serverOrder.map((id) => ({ id })),
          workspacePaneTabsByTargetByWorkspace: {},
        }),
      )
    }
    await waitFor(() => {
      const moveFirst = screen.getByRole<HTMLButtonElement>('button', { name: 'workspace-picker.move-first' })
      expect(moveFirst.disabled).toBe(false)
      const [firstRow, lastRow] = screen.getAllByRole('listitem')
      expect(within(firstRow).getByRole('button', { name: 'sample-two' })).toBeTruthy()
      expect(within(lastRow).getByRole('button', { name: 'sample-one', current: true })).toBeTruthy()
    })
    expect(navigationMocks.activateWorkspace).not.toHaveBeenCalled()
  })

  test('shows a tooltip for opening a workspace and opens the menu from the same button', async () => {
    const user = userEvent.setup()
    const openLocal = vi.fn()
    renderInJsdom(
      <WorkspacePickerHost
        currentWorkspaceId={null}
        onOpenWorkspacePathDialog={openLocal}
        onOpenRemote={vi.fn()}
        onClone={vi.fn()}
      />,
    )

    const trigger = screen.getByRole('button', { name: 'workspace-picker.open-title' })
    await user.hover(trigger)
    expect((await screen.findByRole('tooltip')).textContent).toBe('workspace-picker.open-title')

    await user.click(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    await user.click(screen.getByRole('button', { name: 'workspace-picker.open-local' }))
    expect(openLocal).toHaveBeenCalledOnce()
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
