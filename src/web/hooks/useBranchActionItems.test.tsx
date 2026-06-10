// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { normalizeRemoteTarget } from '#/shared/remote-repo.ts'
import { createRepoBranch, resetReposStore, seedRepoState } from '#/web/stores/repos/test-utils.ts'
import type { useBranchActionItems } from '#/web/hooks/useBranchActionItems.ts'

const mocks = vi.hoisted(() => ({
  useRuntimeExternalAppSettings: vi.fn(),
  useBranchActions: vi.fn(),
}))

vi.mock('#/web/runtime-settings-external-apps.ts', () => ({
  useRuntimeExternalAppSettings: mocks.useRuntimeExternalAppSettings,
}))
vi.mock('#/web/stores/i18n.ts', () => ({
  useT: () => (key: string) => key,
}))
vi.mock('#/web/hooks/useBranchActions.tsx', () => ({
  useBranchActions: mocks.useBranchActions,
}))

describe('useBranchActionItems', () => {
  let container: HTMLDivElement
  let root: Root | null = null
  const reactActEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }

  beforeEach(() => {
    resetReposStore()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    mocks.useRuntimeExternalAppSettings.mockReturnValue({
      terminalApp: 'auto',
      resolvedTerminalApp: null,
      terminalAvailable: false,
      editorApp: 'vscode',
      resolvedEditorApp: 'vscode',
      editorAvailable: true,
    })
    mocks.useBranchActions.mockReturnValue({
      blocked: false,
      busyAction: null,
      capabilities: {
        isCurrent: false,
        checkedOutInAnotherWorktree: true,
        canRemoveWorktree: false,
        isRegularBranch: false,
        canCopyPatch: false,
        canPull: false,
        canPush: false,
        canOpenRemote: false,
        canOpenTerminal: true,
        canOpenEditor: true,
      },
      actions: {
        copyPatch: vi.fn(),
        checkout: vi.fn(),
        pull: vi.fn(),
        push: vi.fn(),
        openTerminal: vi.fn(),
        openEditor: vi.fn(),
        openRemote: vi.fn(),
        requestDeleteBranch: vi.fn(),
        requestRemoveWorktree: vi.fn(),
      },
      dialogs: null,
    })
  })

  afterEach(async () => {
    await act(async () => {
      root?.unmount()
    })
    container.remove()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
    root = null
  })

  test('shows remote terminal even when local terminal apps are unavailable', async () => {
    const branch = createRepoBranch('feature/remote', { worktree: { path: '/srv/repo-feature' } })
    const target = normalizeRemoteTarget({
      alias: 'prod',
      host: 'example.com',
      user: 'alice',
      port: 22,
      remotePath: '/srv/repo',
    })
    expect(target).not.toBeNull()
    const repo = seedRepoState({
      id: target!.id,
      branches: [branch],
      remote: { target: target!, hasRemotes: true, hasBrowserRemote: true, hasGitHubRemote: true },
    })

    let itemIds: string[] = []
    root = createRoot(container)
    const { useBranchActionItems: useItems } = await import('#/web/hooks/useBranchActionItems.ts')
    await act(async () => {
      root!.render(<ItemsHarness useItems={useItems} repo={repo} branch={branch} onReady={(ids) => (itemIds = ids)} />)
    })

    expect(itemIds).toContain('terminal')
    expect(itemIds).toContain('editor')
  })
})

function ItemsHarness({
  useItems,
  repo,
  branch,
  onReady,
}: {
  useItems: typeof useBranchActionItems
  repo: ReturnType<typeof seedRepoState>
  branch: ReturnType<typeof createRepoBranch>
  onReady: (itemIds: string[]) => void
}) {
  const items = useItems(repo, branch)
  React.useEffect(() => {
    onReady([...items.patchItems, ...items.mainItems, ...items.destructiveItems].map((item) => item.id))
  }, [items, onReady])
  return null
}
