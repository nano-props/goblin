// @vitest-environment jsdom

import { act } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { WorkspacePicker } from '#/web/components/workspace-picker/WorkspacePicker.tsx'
import type { WorkspacePickerItem } from '#/web/components/workspace-picker/types.ts'
import { renderInJsdom } from '#/test-utils/render.tsx'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('WorkspacePicker', () => {
  test('uses workspace capability and transport icons', () => {
    render(
      <WorkspacePicker
        workspaces={[
          workspace('Folder', '/tmp/folder', { gitCapability: 'unavailable' }),
          workspace('Git', '/tmp/git'),
          workspace('Remote', 'goblin+ssh://example/tmp%2Fremote', { gitCapability: 'unavailable' }),
        ]}
        currentWorkspaceId="/tmp/folder"
        labels={labels}
        onActivate={() => {}}
        onClose={() => {}}
        onOpenLocal={() => {}}
        onOpenRemote={() => {}}
        onClone={() => {}}
      />,
    )

    const current = document.body.querySelector('[data-current-workspace-id="/tmp/folder"]')
    expect(current?.querySelector('.lucide-folder')).not.toBeNull()
    expect(current?.querySelector('.lucide-folder-git-2')).toBeNull()
  })

  test('keeps the current workspace button as the only workspace chrome inside the current workspace group', () => {
    render(
      <WorkspacePicker
        workspaces={[workspace('Repo-A', '/tmp/workspace-a'), workspace('workspace-b', '/tmp/workspace-b')]}
        currentWorkspaceId="/tmp/workspace-a"
        labels={labels}
        onActivate={() => {}}
        onClose={() => {}}
        onOpenLocal={() => {}}
        onOpenRemote={() => {}}
        onClone={() => {}}
      />,
    )

    const currentWorkspaceGroup = document.body.querySelector('[data-current-workspace-group]')
    expect(currentWorkspaceGroup).not.toBeNull()
    expect(currentWorkspaceGroup?.querySelector('[data-current-workspace-id="/tmp/workspace-a"]')).not.toBeNull()
    // The "All repositories" chevron button is gone — the tab is the
    // single popover trigger now.
    expect(currentWorkspaceGroup?.querySelector('button[aria-label="More"]')).toBeNull()
    expect(document.body.querySelector('button[aria-label="More"]')).toBeNull()
  })

  test('exposes the current workspace button as a selected tab in a horizontal tablist', () => {
    render(
      <WorkspacePicker
        workspaces={[workspace('Repo-A', '/tmp/workspace-a'), workspace('workspace-b', '/tmp/workspace-b')]}
        currentWorkspaceId="/tmp/workspace-a"
        labels={labels}
        onActivate={() => {}}
        onClose={() => {}}
        onOpenLocal={() => {}}
        onOpenRemote={() => {}}
        onClone={() => {}}
      />,
    )

    const tablist = document.body.querySelector('[data-current-workspace-group]')
    expect(tablist?.getAttribute('role')).toBe('tablist')
    expect(tablist?.getAttribute('aria-orientation')).toBe('horizontal')

    const activeTab = document.body.querySelector('[data-current-workspace-id="/tmp/workspace-a"]')
    if (!(activeTab instanceof HTMLButtonElement)) throw new Error('missing current workspace tab')
    expect(activeTab.getAttribute('role')).toBe('tab')
    expect(activeTab.getAttribute('aria-selected')).toBe('true')
    expect(activeTab.tabIndex).toBe(0)
  })

  test('renders the sidebar surface as a plain full-width picker button instead of a tab strip', () => {
    render(
      <WorkspacePicker
        workspaces={[workspace('Repo-A', '/tmp/workspace-a'), workspace('workspace-b', '/tmp/workspace-b')]}
        currentWorkspaceId="/tmp/workspace-a"
        labels={labels}
        onActivate={() => {}}
        onClose={() => {}}
        onOpenLocal={() => {}}
        onOpenRemote={() => {}}
        onClone={() => {}}
        surface="sidebar"
      />,
    )

    expect(document.body.querySelector('[data-current-workspace-group]')).toBeNull()

    const currentWorkspaceButton = document.body.querySelector('[data-current-workspace-id="/tmp/workspace-a"]')
    if (!(currentWorkspaceButton instanceof HTMLButtonElement)) throw new Error('missing current workspace button')
    expect(currentWorkspaceButton.getAttribute('role')).toBeNull()
    expect(currentWorkspaceButton.getAttribute('aria-selected')).toBeNull()
    expect(currentWorkspaceButton.className).toContain('w-full')
    expect(currentWorkspaceButton.className).toContain('shrink-0')
    expect(currentWorkspaceButton.className).not.toContain('flex-1')
    const workspaceLabel = currentWorkspaceButton.querySelector('.uppercase')
    expect(workspaceLabel).not.toBeNull()
    expect(workspaceLabel?.className).not.toContain('font-medium')
    expect(currentWorkspaceButton.textContent).toContain('Repo-A')
    expect(currentWorkspaceButton.hasAttribute('data-interactive')).toBe(true)
    expect(currentWorkspaceButton.closest('nav')?.hasAttribute('data-interactive')).toBe(false)
  })

  test('opens the workspace menu popover from the sidebar surface', async () => {
    render(
      <WorkspacePicker
        workspaces={[workspace('workspace-a', '/tmp/workspace-a'), workspace('workspace-b', '/tmp/workspace-b')]}
        currentWorkspaceId="/tmp/workspace-a"
        labels={labels}
        onActivate={() => {}}
        onClose={() => {}}
        onOpenLocal={() => {}}
        onOpenRemote={() => {}}
        onClone={() => {}}
        surface="sidebar"
      />,
    )

    const trigger = document.body.querySelector('[data-current-workspace-id="/tmp/workspace-a"]')
    if (!(trigger instanceof HTMLButtonElement)) throw new Error('missing sidebar workspace trigger')

    await act(async () => {
      trigger.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
      trigger.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }))
      await Promise.resolve()
    })

    const selectedItem = [...document.body.querySelectorAll('button[aria-current="true"]')].find((item) =>
      item.textContent?.includes('workspace-a'),
    )
    expect(selectedItem).not.toBeNull()
    expect(document.body.textContent).toContain('/tmp/workspace-b')
  })

  test('renders canonical workspace ids as user-facing locations in the workspace menu', async () => {
    const workspaceId = 'goblin+file:///workspace/sample-project'
    render(
      <WorkspacePicker
        workspaces={[workspace('sample-project', workspaceId), workspace('other', 'goblin+file:///workspace/other')]}
        currentWorkspaceId={workspaceId}
        labels={labels}
        onActivate={() => {}}
        onClose={() => {}}
        onOpenLocal={() => {}}
        onOpenRemote={() => {}}
        onClone={() => {}}
        surface="sidebar"
      />,
    )

    const trigger = document.body.querySelector(`[data-current-workspace-id="${workspaceId}"]`)
    await act(async () => {
      trigger!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
      trigger!.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }))
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain('/workspace/sample-project')
    expect(document.body.textContent).not.toContain('goblin+file://')
  })

  test('opens the workspace menu popover when the current workspace tab is clicked', async () => {
    render(
      <WorkspacePicker
        workspaces={[workspace('workspace-a', '/tmp/workspace-a'), workspace('workspace-b', '/tmp/workspace-b')]}
        currentWorkspaceId="/tmp/workspace-a"
        labels={labels}
        onActivate={() => {}}
        onClose={() => {}}
        onOpenLocal={() => {}}
        onOpenRemote={() => {}}
        onClone={() => {}}
      />,
    )

    const tab = document.body.querySelector('[data-current-workspace-id="/tmp/workspace-a"]')
    if (!(tab instanceof HTMLButtonElement)) throw new Error('missing current workspace tab')

    await act(async () => {
      tab.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
      tab.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }))
      await Promise.resolve()
    })

    const selectedItem = [...document.body.querySelectorAll('button[aria-current="true"]')].find((item) =>
      item.textContent?.includes('workspace-a'),
    )
    expect(selectedItem).not.toBeNull()
    expect(selectedItem?.className).toContain('bg-selected')
  })

  test('shows unread terminal bell badges on the trigger and matching workspace rows', async () => {
    render(
      <WorkspacePicker
        workspaces={[
          workspace('workspace-a', '/tmp/workspace-a'),
          workspace('workspace-b', '/tmp/workspace-b', { terminalBellCount: 2 }),
          workspace('workspace-c', '/tmp/workspace-c', { terminalBellCount: 1 }),
        ]}
        currentWorkspaceId="/tmp/workspace-a"
        labels={labels}
        onActivate={() => {}}
        onClose={() => {}}
        onOpenLocal={() => {}}
        onOpenRemote={() => {}}
        onClone={() => {}}
      />,
    )

    const trigger = document.body.querySelector('[data-current-workspace-id="/tmp/workspace-a"]')
    if (!(trigger instanceof HTMLButtonElement)) throw new Error('missing current workspace button')
    const triggerBadge = trigger.querySelector('.bg-notification')
    expect(triggerBadge?.textContent).toBe('3')

    await act(async () => {
      trigger.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
      trigger.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }))
      await Promise.resolve()
    })

    const workspaceBRow = [...document.body.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('workspace-b'),
    )
    const workspaceCRow = [...document.body.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('workspace-c'),
    )
    expect(workspaceBRow?.querySelector('.bg-notification')?.textContent).toBe('2')
    expect(workspaceCRow?.querySelector('.bg-notification')?.textContent).toBe('1')
  })

  test('renders only the current workspace button when multiple workspaces are open, with the rest in the popover', () => {
    vi.stubGlobal('matchMedia', createMatchMedia(false))

    render(
      <WorkspacePicker
        workspaces={[
          workspace('workspace-a', '/tmp/workspace-a'),
          workspace('workspace-b', '/tmp/workspace-b'),
          workspace('workspace-c', '/tmp/workspace-c'),
        ]}
        currentWorkspaceId="/tmp/workspace-b"
        labels={labels}
        onActivate={() => {}}
        onClose={() => {}}
        onOpenLocal={() => {}}
        onOpenRemote={() => {}}
        onClone={() => {}}
      />,
    )

    expect(document.body.querySelector('[data-current-workspace-id="/tmp/workspace-b"]')).not.toBeNull()
    expect(document.body.querySelector('[data-current-workspace-id="/tmp/workspace-a"]')).toBeNull()
    expect(document.body.querySelector('[data-current-workspace-id="/tmp/workspace-c"]')).toBeNull()
    // No standalone "All repositories" button — the tab is the trigger.
    expect(document.body.querySelector('button[aria-label="More"]')).toBeNull()
  })

  test('keeps current workspace chrome borderless with hover and shows two-line rows with path in the popover', async () => {
    render(
      <WorkspacePicker
        workspaces={[workspace('workspace-a', '/tmp/workspace-a'), workspace('workspace-b', '/tmp/workspace-b')]}
        currentWorkspaceId="/tmp/workspace-a"
        labels={labels}
        onActivate={() => {}}
        onClose={() => {}}
        onOpenLocal={() => {}}
        onOpenRemote={() => {}}
        onClone={() => {}}
      />,
    )

    const currentWorkspaceButton = document.body.querySelector('[data-current-workspace-id="/tmp/workspace-a"]')
    if (!(currentWorkspaceButton instanceof HTMLButtonElement)) throw new Error('missing current workspace button')

    const currentWorkspaceChrome = currentWorkspaceButton.closest('[data-current-workspace-chrome]')
    expect(currentWorkspaceChrome?.className).toContain('border-transparent')
    expect(currentWorkspaceChrome?.className).not.toContain('border-separator')
    expect(currentWorkspaceChrome?.className).toContain('hover:bg-accent/70')
    // The chrome now reads in text-foreground by default to match the
    // action buttons, so there's no hover:text-foreground shift anymore.
    expect(currentWorkspaceChrome?.className).toContain('text-foreground')
    // The close button used to live in the chrome; it now lives in
    // each popover row instead.
    expect(currentWorkspaceChrome?.querySelector('button[aria-label="Close workspace-a"]')).toBeNull()

    // No internal vertical separator between tab and chevron — the
    // chevron is part of the tab now.
    expect(
      currentWorkspaceChrome?.parentElement?.querySelector(
        ':scope > [data-slot="separator"][data-orientation="vertical"]',
      ),
    ).toBeNull()

    const tab = document.body.querySelector('[data-current-workspace-id="/tmp/workspace-a"]')
    if (!(tab instanceof HTMLButtonElement)) throw new Error('missing current workspace tab')

    await act(async () => {
      tab.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
      tab.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }))
      await Promise.resolve()
    })

    const closeButton = document.body.querySelector('button[aria-label="Close workspace-a"]')
    expect(closeButton).not.toBeNull()
    expect(closeButton?.className).not.toContain('opacity-0')
    expect(closeButton?.className).not.toContain('group-hover:opacity-100')
    const popoverContent = document.body.querySelector('[data-slot="popover-content"]')
    expect((popoverContent as HTMLElement | null)?.style.minWidth).toBe(
      'max(16rem, var(--radix-popover-trigger-width))',
    )

    // Each popover row is now two lines: name on top, locator (path
    // or remote target) below in mono muted text. The locator for a
    // local workspace is the tilde-expanded path.
    const workspaceARow = [...document.body.querySelectorAll('button[aria-current]')].find((btn) =>
      btn.textContent?.includes('workspace-a'),
    )
    expect(workspaceARow).not.toBeNull()
    expect(workspaceARow?.className).toContain('min-h-11')
    const locator = workspaceARow?.querySelector('.font-mono')
    expect(locator).not.toBeNull()
    expect(locator?.textContent?.trim()).toBe('/tmp/workspace-a')
  })

  test('renders a placeholder button on the sidebar surface when no workspace is open', async () => {
    const onOpenLocal = vi.fn()

    render(
      <WorkspacePicker
        workspaces={[]}
        currentWorkspaceId={null}
        labels={labels}
        onActivate={() => {}}
        onClose={() => {}}
        onOpenLocal={onOpenLocal}
        onOpenRemote={() => {}}
        onClone={() => {}}
        surface="sidebar"
      />,
    )

    const placeholder = document.body.querySelector('[data-testid="workspace-picker-placeholder"]')
    expect(placeholder).not.toBeNull()
    expect(placeholder?.textContent).toContain('Select workspace')
    expect(placeholder?.className).toContain('w-full')

    await act(async () => {
      placeholder!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
      placeholder!.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }))
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain('Open local repository…')
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
    expect(plus).not.toBeNull()
    expect(plus?.closest('nav')?.hasAttribute('data-interactive')).toBe(false)

    await act(async () => {
      plus!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
      plus!.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }))
      await Promise.resolve()
    })

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
    expect(cloneButton).not.toBeNull()
    await act(async () => {
      cloneButton!.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }))
    })
    expect(onClone).toHaveBeenCalled()
  })
})

function render(element: React.ReactNode) {
  return renderInJsdom(element)
}

function workspace(name: string, id: string, overrides: Partial<WorkspacePickerItem> = {}): WorkspacePickerItem {
  return {
    id,
    name,
    gitCapability: 'available',
    git: { remoteDetails: [], lastSyncedAt: null },
    lifecycle: null,
    ...overrides,
  }
}

const labels = {
  workspaces: 'Workspaces',
  closeWithName: (name: string) => `Close ${name}`,
  open: 'Open',
  placeholder: 'Select workspace',
  openLocal: 'Open local repository…',
  openLocalShortcut: '⌘O',
  openRemote: 'Open remote repository…',
  openRemoteShortcut: '⌘⇧R',
  clone: 'Clone repository…',
  cloneShortcut: '⌘⇧O',
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
