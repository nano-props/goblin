// @vitest-environment jsdom

import { createElement } from 'react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { workspacePickerItemsEqual } from '#/web/components/workspace-picker/summary-equality.ts'
import type { WorkspacePickerItem } from '#/web/components/workspace-picker/types.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { WorkspacePickerHost } from '#/web/components/WorkspacePickerHost.tsx'
import { emptyWorkspace } from '#/web/stores/workspaces/workspace-state-factory.ts'
import { resetWorkspacesStore } from '#/web/test-utils/repo-store.ts'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'

vi.mock('#/web/stores/i18n.ts', () => ({ useT: () => (key: string) => key }))
vi.mock('#/web/runtime-settings-shortcuts.ts', () => ({ useShortcutSettings: () => ({ shortcutsDisabled: false }) }))
vi.mock('#/web/components/terminal/terminal-session-store.ts', () => ({
  useWorkspaceTerminalBellCounts: () => ({}),
}))
vi.mock('#/web/primary-window-navigation.tsx', () => ({
  usePrimaryWindowNavigation: () => ({
    activateWorkspace: vi.fn(),
    closeWorkspace: vi.fn(async () => ({ ok: true })),
  }),
}))

beforeEach(resetWorkspacesStore)

describe('WorkspacePickerHost', () => {
  test('binds a remote workspace directory name into the picker from its canonical id', () => {
    const workspaceId = workspaceIdForTest('goblin+ssh://example/home/developer/Documents')
    const workspace = emptyWorkspace(workspaceId, 'workspace-runtime-picker')
    useWorkspacesStore.setState({ workspaces: { [workspaceId]: workspace }, workspaceOrder: [workspaceId] })

    const { container } = renderInJsdom(
      createElement(WorkspacePickerHost, {
        currentWorkspaceId: workspaceId,
        onOpenWorkspacePathDialog: vi.fn(),
        onOpenRemote: vi.fn(),
        onClone: vi.fn(),
      }),
    )

    expect(container.textContent).toContain('Documents')
    expect(container.textContent).not.toContain('example:Documents')
  })
})

describe('workspacePickerItemsEqual', () => {
  test('treats Git capability changes as unequal', () => {
    const item: WorkspacePickerItem = {
      id: workspaceIdForTest('goblin+file:///tmp/workspace'),
      name: 'workspace',
      gitCapability: 'unavailable',
      git: null,
      lifecycle: null,
    }

    expect(workspacePickerItemsEqual([item], [{ ...item, gitCapability: 'available' }])).toBe(false)
  })

  test('treats remote lifecycle target changes as unequal even when repo id stays the same', () => {
    const left: WorkspacePickerItem[] = [
      {
        id: workspaceIdForTest('goblin+ssh://example/srv/repo'),
        name: 'repo',
        gitCapability: 'available',
        git: { remoteDetails: [] },
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
        gitCapability: 'available',
        git: { remoteDetails: [] },
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

  test('treats failed lifecycle target locator changes as unequal', () => {
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
        gitCapability: 'available',
        git: { remoteDetails: [] },
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
        gitCapability: 'available',
        git: { remoteDetails: [] },
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

  test('treats terminal bell count changes as unequal', () => {
    const left: WorkspacePickerItem[] = [
      {
        id: workspaceIdForTest('goblin+file:///tmp/repo'),
        name: 'repo',
        gitCapability: 'available',
        git: { remoteDetails: [] },
        terminalBellCount: 1,
        lifecycle: null,
      },
    ]
    const right: WorkspacePickerItem[] = [
      {
        id: workspaceIdForTest('goblin+file:///tmp/repo'),
        name: 'repo',
        gitCapability: 'available',
        git: { remoteDetails: [] },
        terminalBellCount: 2,
        lifecycle: null,
      },
    ]

    expect(workspacePickerItemsEqual(left, right)).toBe(false)
  })
})
