// @vitest-environment jsdom

import { flushTestUpdates } from '#/test-utils/render.tsx'
import { screen, within } from '@testing-library/vue'
import { userEvent } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { WorkspacePicker } from '#/web/components/workspace-picker/WorkspacePicker.tsx'
import type { WorkspacePickerItem } from '#/web/components/workspace-picker/types.ts'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import type { VNode } from 'vue'

beforeEach(() => {
  vi.stubGlobal('matchMedia', createMatchMedia(false))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('WorkspacePicker', () => {
  test('uses workspace capability and transport icons', () => {
    render(
      <WorkspacePicker
        workspaces={[
          workspace('Folder', 'goblin+file:///tmp/folder', { gitAvailable: false }),
          workspace('Git', 'goblin+file:///tmp/git'),
          workspace('Remote', 'goblin+ssh://example/tmp/remote', { gitAvailable: false }),
        ]}
        currentWorkspaceId={workspaceIdForTest('goblin+file:///tmp/folder')}
        labels={labels}
        onActivate={() => {}}
        onClose={() => {}}
        onOpenLocal={() => {}}
        onOpenRemote={() => {}}
        onClone={() => {}}
      />,
    )

    expect(screen.getByRole('button', { name: 'Folder' }).querySelector('.lucide-folder')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Git' }).querySelector('.lucide-folder-git-2')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Remote' }).querySelector('.lucide-server')).not.toBeNull()
  })

  test('shows open projects in order and dispatches selection and close separately', async () => {
    const user = userEvent.setup()
    const onActivate = vi.fn()
    const onClose = vi.fn()
    const firstId = workspaceIdForTest('goblin+file:///tmp/workspace-a')
    const secondId = workspaceIdForTest('goblin+file:///tmp/workspace-b')

    render(
      <WorkspacePicker
        workspaces={[workspace('Repo-A', firstId), workspace('Repo-B', secondId, { terminalBellCount: 3 })]}
        currentWorkspaceId={firstId}
        labels={labels}
        onActivate={onActivate}
        onClose={onClose}
        onOpenLocal={() => {}}
        onOpenRemote={() => {}}
        onClone={() => {}}
      />,
    )

    const first = screen.getByRole('button', { name: 'Repo-A' })
    const second = screen.getByRole('button', { name: /^Repo-B/ })
    expect(screen.getAllByRole('listitem').map((row) => row.querySelector('button'))).toEqual([first, second])
    expect(first.getAttribute('aria-current')).toBe('true')
    expect(first.closest('li')?.classList.contains('bg-selected')).toBe(true)
    expect(second.getAttribute('title')).toBe('/tmp/workspace-b')
    expect(second.closest('li')?.textContent).toContain('3')

    await user.click(second)
    const firstRow = screen.getAllByRole('listitem')[0]!
    const actions = within(firstRow).getByRole('button', { name: 'action.menu' })
    expect(screen.queryByRole('button', { name: labels.close })).toBeNull()
    actions.focus()
    await user.keyboard('{Enter}')
    const menu = await screen.findByRole('dialog')
    expect(onClose).not.toHaveBeenCalled()
    expect(within(menu).getAllByRole('button')).toHaveLength(1)
    await user.keyboard('{Enter}')
    expect(onClose).not.toHaveBeenCalled()
    await user.tab()
    expect(document.activeElement).toBe(within(menu).getByRole('button', { name: labels.close }))
    await user.keyboard('{Enter}')

    expect(onActivate.mock.calls).toEqual([[secondId]])
    expect(onClose.mock.calls).toEqual([[firstId]])

    const trigger = screen.getByRole('button', { name: 'Open' })
    expect(trigger.contains(screen.getByText(labels.workspaces))).toBe(false)
    expect(trigger.classList.contains('opacity-0')).toBe(false)
    await clickPopoverTrigger(trigger)

    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(screen.getByRole('button', { name: labels.openLocal })).toBeTruthy()
    expect(screen.getByRole('button', { name: labels.openRemote })).toBeTruthy()
    expect(screen.getByRole('button', { name: labels.clone })).toBeTruthy()
  })

  test('shows a + button that opens the action popover when no workspace is open', async () => {
    const onOpenLocal = vi.fn()
    const onOpenRemote = vi.fn()
    const onClone = vi.fn()

    render(
      <WorkspacePicker
        workspaces={[]}
        currentWorkspaceId={null}
        labels={labels}
        onActivate={() => {}}
        onClose={() => {}}
        onOpenLocal={onOpenLocal}
        onOpenRemote={onOpenRemote}
        onClone={onClone}
      />,
    )

    const plus = document.body.querySelector('button[aria-label="Open"]')
    if (!(plus instanceof HTMLButtonElement)) throw new Error('missing open workspace button')
    expect(plus.closest('nav')?.hasAttribute('data-interactive')).toBe(false)

    await clickPopoverTrigger(plus)

    // Popover shows the three actions and no workspace rows.
    expect(document.body.textContent).toContain('Open local repository…')
    expect(document.body.textContent).toContain('Open remote repository…')
    expect(document.body.textContent).toContain('Clone repository…')
    expect(document.body.querySelector('button[aria-current]')).toBeNull()

    // Clicking an action invokes the matching callback and closes
    // the popover (which the parent would do via onSelectAction).
    const cloneButton = [...document.body.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Clone repository…'),
    )
    if (!(cloneButton instanceof HTMLButtonElement)) throw new Error('missing clone repository action')
    await flushTestUpdates(() => {
      cloneButton.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }))
    })
    expect(onClone).toHaveBeenCalled()
    expect(document.body.contains(cloneButton)).toBe(false)
  })
})

function render(element: VNode) {
  return renderInJsdom(element)
}

async function clickPopoverTrigger(trigger: HTMLElement): Promise<void> {
  await userEvent.setup().click(trigger)
  await screen.findByRole('dialog')
}

function workspace(name: string, id: string, overrides: Partial<WorkspacePickerItem> = {}): WorkspacePickerItem {
  return {
    id: workspaceIdForTest(id),
    name,
    gitAvailable: true,
    lifecycle: null,
    ...overrides,
  }
}

const labels = {
  workspaces: 'Workspaces',
  close: 'Close',
  open: 'Open',
  openLocal: 'Open local repository…',
  openRemote: 'Open remote repository…',
  clone: 'Clone repository…',
  unavailable: 'Unavailable',
}

function createMatchMedia(matches: boolean) {
  return (query: string) => ({
    matches: query === '(max-width: 639px)' ? matches : false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })
}
