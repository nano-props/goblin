// @vitest-environment jsdom

import {
  GitWorkspacePaneContentHarness,
  REPO_ID,
  defaultBranchActionSurface,
  emptyWorktreeSnapshot,
  emptyTerminalReadContext,
  filetreeClientMocks,
  getTestGitWorkspacePanePresentation,
  gitWorkspacePaneProjection,
  navigationWith,
  staticEntry,
  terminalCommandContextWith,
  terminalEntry,
  terminalSession,
  workspacePaneTabsTestBridge,
} from '#/web/test-utils/git-workspace-pane-content.tsx'
import {
  createRepoWorktreeSnapshotForTest,
  seedRepoWithReadModelForTest,
  createBranchSnapshot,
} from '#/web/test-utils/repo-store.ts'
import { screen, waitFor } from '@testing-library/vue'
import { flushTestUpdates } from '#/test-utils/render.tsx'
import { QueryClient } from '@tanstack/vue-query'
import { VueQueryClientScope } from '#/web/test-utils/VueQueryClientScope.tsx'
import { describe, expect, test, vi } from 'vitest'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { WorkspaceFilesystemTabPanel } from '#/web/components/workspace-pane/WorkspaceFilesystemTabPanel.tsx'
import { workspaceRootPaneFilesystemTarget } from '#/web/workspace-pane/workspace-pane-filesystem-target.ts'
import { BranchActionSurfaceProvider } from '#/web/components/repo-workspace/branch-action-surface-context.ts'
import {
  TerminalSessionCommandScope,
  TerminalSessionReadScope,
} from '#/web/components/terminal/terminal-session-context.ts'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'
import { terminalProjectionHydrationStore } from '#/web/stores/terminal-projection-hydration.ts'
import { formatTerminalFilesystemTargetKeyForPath } from '#/shared/terminal-filesystem-target-key.ts'
import { AppNavigationProvider } from '#/web/app-navigation.tsx'
import type {
  TerminalFilesystemTargetSnapshot,
  TerminalSessionContextValue,
  TerminalSessionReadContextValue,
} from '#/web/components/terminal/types.ts'
import { observeWorkspacePaneRouteForTest } from '#/web/test-utils/workspace-pane-navigation.ts'
import { readWorkspacePaneTabsForTarget } from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import { workspacePaneTabOpener } from '#/web/workspace-pane/workspace-pane-tab-opener.ts'
import { appQueryClient } from '#/web/app-query-client.ts'
import { renderInJsdom } from '#/test-utils/render.tsx'
import type { WorkspaceFilesystemNode, WorkspaceFilesystemTreeResult } from '#/shared/api-types.ts'

function cleanFileNode(id: string, parentId: string | null = null): WorkspaceFilesystemNode {
  return { id, path: id, name: id.split('/').at(-1) ?? id, parentId, kind: 'file', status: 'clean' }
}

function cleanDirectoryNode(id: string): WorkspaceFilesystemNode {
  return { id, path: id, name: id, parentId: null, kind: 'directory', status: 'clean' }
}

function filesystemTree(...nodes: WorkspaceFilesystemNode[]): WorkspaceFilesystemTreeResult {
  return { nodes, truncated: false }
}

describe('GitWorkspacePaneContent filesystem-terminal', () => {
  test('revalidates the file tree after switching away from and back to the files tab', async () => {
    const worktreePath = '/tmp/filetree-tab-refresh-worktree'
    const branchName = 'feature/filetree-tab-refresh'
    filetreeClientMocks.getWorkspaceFilesystemTree
      .mockResolvedValueOnce(filesystemTree(cleanFileNode('before.txt')))
      .mockResolvedValueOnce(filesystemTree(cleanFileNode('after.txt')))
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [createBranchSnapshot(branchName)],
      worktrees: [createRepoWorktreeSnapshotForTest(branchName, worktreePath, { isPrimary: false, isLocked: false })],
      currentBranchName: branchName,
      preferredWorkspacePaneTab: 'files',
      workspacePaneTabsByBranch: { [branchName]: [staticEntry('files'), staticEntry('status')] },
    })
    terminalProjectionHydrationStore.getState().markProjectionReady(REPO_ID, repo.workspaceRuntimeId)
    const renderSurface = () => {
      const currentRepo = workspacesStore.getState().workspaces[REPO_ID]!
      const projection = gitWorkspacePaneProjection(currentRepo)
      return (
        <TerminalSessionCommandScope value={terminalCommandContextWith()}>
          <TerminalSessionReadScope value={emptyTerminalReadContext}>
            <BranchActionSurfaceProvider value={defaultBranchActionSurface()}>
              <GitWorkspacePaneContentHarness
                repo={projection}
                detail={getTestGitWorkspacePanePresentation(projection)}
                workspacePaneId="workspace"
              />
            </BranchActionSurfaceProvider>
          </TerminalSessionReadScope>
        </TerminalSessionCommandScope>
      )
    }
    const rendered = renderInJsdom(renderSurface())

    expect(await screen.findByRole('treeitem', { name: 'before.txt' })).toBeTruthy()
    expect(filetreeClientMocks.getWorkspaceFilesystemTree).toHaveBeenCalledOnce()

    await flushTestUpdates(async () => {
      workspacesStore.getState().setWorkspacePaneTab(REPO_ID, branchName, 'status')
      await rendered.rerender(renderSurface())
    })
    expect(rendered.container.querySelector('#workspace-status-panel')).not.toBeNull()

    await flushTestUpdates(async () => {
      workspacesStore.getState().setWorkspacePaneTab(REPO_ID, branchName, 'files')
      await rendered.rerender(renderSurface())
    })

    expect(await screen.findByRole('treeitem', { name: 'after.txt' })).toBeTruthy()
    expect(filetreeClientMocks.getWorkspaceFilesystemTree).toHaveBeenCalledTimes(2)
  })

  test('isolates an in-flight directory read when the execution runtime changes', async () => {
    const workspaceId = workspaceIdForTest('goblin+file:///tmp/filetree-runtime-owner-workspace')
    const oldRuntimeId = 'runtime-filetree-owner-old'
    const currentRuntimeId = 'runtime-filetree-owner-current'
    const oldChildren = Promise.withResolvers<WorkspaceFilesystemTreeResult>()
    const currentChildren = Promise.withResolvers<WorkspaceFilesystemTreeResult>()
    filetreeClientMocks.getWorkspaceFilesystemTree.mockImplementation((target, options) => {
      if (options.prefix === 'src') {
        return target.workspaceRuntimeId === oldRuntimeId ? oldChildren.promise : currentChildren.promise
      }
      return Promise.resolve(filesystemTree(cleanDirectoryNode('src')))
    })
    const surface = (workspaceRuntimeId: string) => (
      <VueQueryClientScope client={appQueryClient}>
        <AppNavigationProvider value={navigationWith({})}>
          <TerminalSessionCommandScope value={terminalCommandContextWith()}>
            <WorkspaceFilesystemTabPanel
              target={workspaceRootPaneFilesystemTarget({
                workspaceId,
                workspaceRuntimeId,
                capabilities: {
                  files: { read: true, write: false },
                  terminal: { available: false },
                  git: { status: 'unavailable' },
                },
              })}
            />
          </TerminalSessionCommandScope>
        </AppNavigationProvider>
      </VueQueryClientScope>
    )
    const rendered = renderInJsdom(surface(oldRuntimeId))
    const directory = await screen.findByRole('treeitem', { name: 'src' })

    await flushTestUpdates(() => directory.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    await waitFor(() => expect(filetreeClientMocks.getWorkspaceFilesystemTree).toHaveBeenCalledTimes(2))

    await rendered.rerender(surface(currentRuntimeId))
    await waitFor(() => expect(filetreeClientMocks.getWorkspaceFilesystemTree).toHaveBeenCalledTimes(4))

    await flushTestUpdates(async () => {
      oldChildren.resolve(filesystemTree(cleanFileNode('src/stale.ts', 'src')))
      await oldChildren.promise
    })
    expect(screen.queryByRole('treeitem', { name: 'stale.ts' })).toBeNull()

    await flushTestUpdates(async () => {
      currentChildren.resolve(filesystemTree(cleanFileNode('src/current.ts', 'src')))
      await currentChildren.promise
    })
    expect(await screen.findByRole('treeitem', { name: 'current.ts' })).toBeTruthy()
    expect(screen.queryByRole('treeitem', { name: 'stale.ts' })).toBeNull()
  })

  test('mounts the terminal session while terminal creation is pending with no sessions', async () => {
    const worktreePath = '/tmp/terminal-pending-worktree'
    const terminalFilesystemTargetKey = formatTerminalFilesystemTargetKeyForPath(REPO_ID, worktreePath)
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [createBranchSnapshot('feature/terminal-pending')],
      worktrees: [
        createRepoWorktreeSnapshotForTest('feature/terminal-pending', worktreePath, {
          isPrimary: false,
          isLocked: false,
        }),
      ],
      currentBranchName: 'feature/terminal-pending',
      preferredWorkspacePaneTab: 'terminal',
      workspacePaneTabsByBranch: { 'feature/terminal-pending': [staticEntry('status')] },
    })
    terminalProjectionHydrationStore.getState().markProjectionReady(REPO_ID, repo.workspaceRuntimeId)
    const detail = getTestGitWorkspacePanePresentation(gitWorkspacePaneProjection(repo))
    const terminalFilesystemTargetSnapshot: TerminalFilesystemTargetSnapshot = {
      ...emptyWorktreeSnapshot,
      terminalFilesystemTargetKey,
      createPending: true,
    }
    const readContext: TerminalSessionReadContextValue = {
      ...emptyTerminalReadContext,
      terminalFilesystemTargetSnapshot: () => terminalFilesystemTargetSnapshot,
    }

    const { container } = renderInJsdom(
      <TerminalSessionCommandScope value={terminalCommandContextWith()}>
        <TerminalSessionReadScope value={readContext}>
          <GitWorkspacePaneContentHarness
            repo={gitWorkspacePaneProjection(repo)}
            detail={detail}
            workspacePaneId="workspace"
          />
        </TerminalSessionReadScope>
      </TerminalSessionCommandScope>,
    )

    const panel = container.querySelector('#workspace-terminal-panel')
    expect(panel).not.toBeNull()
    expect(panel?.getAttribute('aria-labelledby')).toBe('workspace-terminal-pending-tab')
    expect(panel?.hasAttribute('aria-label')).toBe(false)
    expect(container.querySelector('.goblin-terminal-session__host')).not.toBeNull()
    expect(container.textContent).toContain('terminal.opening')
    expect(container.textContent).not.toContain('workspace-pane-tabs.empty')
  })

  test('mounts the terminal session while terminal creation is pending after every tab was closed', async () => {
    const worktreePath = '/tmp/terminal-pending-empty-strip-worktree'
    const terminalFilesystemTargetKey = formatTerminalFilesystemTargetKeyForPath(REPO_ID, worktreePath)
    const branchName = 'feature/terminal-pending-empty-strip'
    const seededRepo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [createBranchSnapshot(branchName)],
      worktrees: [createRepoWorktreeSnapshotForTest(branchName, worktreePath, { isPrimary: false, isLocked: false })],
      currentBranchName: branchName,
      preferredWorkspacePaneTab: 'terminal',
      workspacePaneTabsByBranch: { [branchName]: [] },
    })
    terminalProjectionHydrationStore.getState().markProjectionReady(REPO_ID, seededRepo.workspaceRuntimeId)
    const repo = workspacesStore.getState().workspaces[REPO_ID]!
    const detail = getTestGitWorkspacePanePresentation(gitWorkspacePaneProjection(repo))
    const terminalFilesystemTargetSnapshot: TerminalFilesystemTargetSnapshot = {
      ...emptyWorktreeSnapshot,
      terminalFilesystemTargetKey,
      createPending: true,
    }
    const readContext: TerminalSessionReadContextValue = {
      ...emptyTerminalReadContext,
      terminalFilesystemTargetSnapshot: () => terminalFilesystemTargetSnapshot,
    }

    renderInJsdom(
      <TerminalSessionCommandScope value={terminalCommandContextWith()}>
        <TerminalSessionReadScope value={readContext}>
          <GitWorkspacePaneContentHarness
            repo={gitWorkspacePaneProjection(repo)}
            detail={detail}
            workspacePaneId="workspace"
          />
        </TerminalSessionReadScope>
      </TerminalSessionCommandScope>,
    )

    expect(screen.getByRole('tabpanel').id).toBe('workspace-terminal-panel')
    expect(screen.queryByText('workspace-pane-tabs.empty')).toBeNull()
  })

  test('renders terminal loading without a create CTA while initial terminal sync is unresolved', async () => {
    const worktreePath = '/tmp/terminal-loading-worktree'
    const terminalFilesystemTargetKey = formatTerminalFilesystemTargetKeyForPath(REPO_ID, worktreePath)
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [createBranchSnapshot('feature/terminal-loading')],
      worktrees: [
        createRepoWorktreeSnapshotForTest('feature/terminal-loading', worktreePath, {
          isPrimary: false,
          isLocked: false,
        }),
      ],
      currentBranchName: 'feature/terminal-loading',
      preferredWorkspacePaneTab: 'terminal',
      workspacePaneTabsByBranch: { 'feature/terminal-loading': [staticEntry('status')] },
    })
    const detail = getTestGitWorkspacePanePresentation(gitWorkspacePaneProjection(repo))
    const createTerminal = vi.fn(async () => 'term-111111111111111111111')
    const terminalFilesystemTargetSnapshot: TerminalFilesystemTargetSnapshot = {
      ...emptyWorktreeSnapshot,
      terminalFilesystemTargetKey,
      createPending: false,
    }
    const readContext: TerminalSessionReadContextValue = {
      ...emptyTerminalReadContext,
      terminalFilesystemTargetSnapshot: () => terminalFilesystemTargetSnapshot,
    }

    const { container } = renderInJsdom(
      <TerminalSessionCommandScope value={terminalCommandContextWith({ createTerminal })}>
        <TerminalSessionReadScope value={readContext}>
          <GitWorkspacePaneContentHarness
            repo={gitWorkspacePaneProjection(repo)}
            detail={detail}
            workspacePaneId="workspace"
          />
        </TerminalSessionReadScope>
      </TerminalSessionCommandScope>,
    )

    const panel = container.querySelector('#workspace-terminal-panel')
    expect(panel).not.toBeNull()
    expect(panel?.getAttribute('aria-label')).toBe('terminal.loading')
    expect(panel?.hasAttribute('aria-labelledby')).toBe(false)
    expect(container.textContent).toContain('terminal.loading')
    expect(container.textContent).not.toContain('terminal.new')
    expect(container.querySelector('.goblin-terminal-session__empty-cta')).toBeNull()
    expect(createTerminal).not.toHaveBeenCalled()
  })

  test('labels terminal panels from the mixed tab list, not runtime session list', async () => {
    const worktreePath = '/tmp/terminal-reordered-worktree'
    const terminalFilesystemTargetKey = formatTerminalFilesystemTargetKeyForPath(REPO_ID, worktreePath)
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [createBranchSnapshot('feature/terminal-reordered')],
      worktrees: [
        createRepoWorktreeSnapshotForTest('feature/terminal-reordered', worktreePath, {
          isPrimary: false,
          isLocked: false,
        }),
      ],
      currentBranchName: 'feature/terminal-reordered',
      preferredWorkspacePaneTab: 'terminal',
      workspacePaneTabsByBranch: {
        'feature/terminal-reordered': [
          terminalEntry('term-222222222222222222222'),
          staticEntry('status'),
          terminalEntry('term-111111111111111111111'),
        ],
      },
    })
    terminalProjectionHydrationStore.getState().markProjectionReady(REPO_ID, repo.workspaceRuntimeId)
    const detail = getTestGitWorkspacePanePresentation(gitWorkspacePaneProjection(repo))
    const terminalFilesystemTargetSnapshot: TerminalFilesystemTargetSnapshot = {
      ...emptyWorktreeSnapshot,
      terminalFilesystemTargetKey,
      sessions: [
        terminalSession('term-111111111111111111111', 1, false, terminalFilesystemTargetKey),
        terminalSession('term-222222222222222222222', 2, true, terminalFilesystemTargetKey),
      ],
      count: 2,
    }
    const readContext: TerminalSessionReadContextValue = {
      ...emptyTerminalReadContext,
      terminalFilesystemTargetSnapshot: () => terminalFilesystemTargetSnapshot,
    }

    const { container } = renderInJsdom(
      <TerminalSessionCommandScope value={terminalCommandContextWith()}>
        <TerminalSessionReadScope value={readContext}>
          <GitWorkspacePaneContentHarness
            repo={gitWorkspacePaneProjection(repo)}
            detail={detail}
            workspacePaneId="workspace"
          />
        </TerminalSessionReadScope>
      </TerminalSessionCommandScope>,
    )

    expect(container.querySelector('#workspace-terminal-panel')?.getAttribute('aria-labelledby')).toBe(
      'workspace-workspace-pane-tab',
    )
  })

  test('opens a file by creating a terminal with a startup shell command instead of writing to an opening PTY', async () => {
    const worktreePath = '/tmp/filetree-open-worktree'
    const branchName = 'feature/filetree-open'
    filetreeClientMocks.getWorkspaceFilesystemTree.mockResolvedValueOnce({
      nodes: [
        {
          id: 'README.md',
          path: 'README.md',
          name: 'README.md',
          parentId: null,
          kind: 'file',
          status: 'clean',
        },
      ],
      truncated: false,
    })
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [createBranchSnapshot(branchName)],
      worktrees: [createRepoWorktreeSnapshotForTest(branchName, worktreePath, { isPrimary: false, isLocked: false })],
      currentBranchName: branchName,
      preferredWorkspacePaneTab: 'files',
      workspacePaneTabsByBranch: { [branchName]: [staticEntry('files'), staticEntry('status')] },
    })
    terminalProjectionHydrationStore.getState().markProjectionReady(REPO_ID, repo.workspaceRuntimeId)
    const detail = getTestGitWorkspacePanePresentation(gitWorkspacePaneProjection(repo))
    let resolvedStartupShellCommand: string | null = null
    const createTerminalWithAdmission: TerminalSessionContextValue['createTerminalWithAdmission'] = vi.fn(
      async (_base, options) => {
        resolvedStartupShellCommand = (await options?.resolveStartupShellCommand?.()) ?? null
        workspacePaneTabsTestBridge.addRuntimeTab({
          workspaceId: REPO_ID,
          workspaceRuntimeId: repo.workspaceRuntimeId,
          branchName,
          worktreePath,
          terminalSessionId: 'term-111111111111111111111',
          insertAfterIdentity: 'workspace-pane:files',
        })
        return {
          terminalSessionId: 'term-111111111111111111111',
          presentation: { kind: 'git-worktree' as const },
          requestRole: 'leader' as const,
          resourceDisposition: 'created' as const,
          runtimeProjectionApplied: true,
        }
      },
    )
    const showRepoBranchWorkspacePaneTab = vi.fn(() => true)
    const navigation = navigationWith({ showRepoBranchWorkspacePaneTab })
    let resolveViewer!: (value: { viewer: 'bat'; shell: 'posix'; executionRoot: string }) => void
    filetreeClientMocks.getWorkspaceFileViewer.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveViewer = resolve
        }),
    )
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    renderInJsdom(
      <VueQueryClientScope client={queryClient}>
        <TerminalSessionCommandScope value={terminalCommandContextWith({ createTerminalWithAdmission })}>
          <TerminalSessionReadScope value={emptyTerminalReadContext}>
            <BranchActionSurfaceProvider value={defaultBranchActionSurface()}>
              <GitWorkspacePaneContentHarness
                repo={gitWorkspacePaneProjection(repo)}
                detail={detail}
                workspacePaneId="workspace"
                navigation={navigation}
              />
            </BranchActionSurfaceProvider>
          </TerminalSessionReadScope>
        </TerminalSessionCommandScope>
      </VueQueryClientScope>,
    )

    const row = await screen.findByRole('treeitem', { name: 'README.md' })
    observeWorkspacePaneRouteForTest({
      workspaceId: REPO_ID,
      workspaceRuntimeId: repo.workspaceRuntimeId,
      branchName,
      worktreePath,
      route: { kind: 'static', tab: 'files' },
    })
    await flushTestUpdates(async () => {
      row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
      await Promise.resolve()
    })
    const actionButton = row.querySelector<HTMLButtonElement>('[data-action-popover-trigger]')
    expect(actionButton?.getAttribute('aria-busy')).toBe('true')
    expect(actionButton?.querySelector('svg.animate-spin')).toBeTruthy()
    expect(createTerminalWithAdmission).toHaveBeenCalledTimes(1)
    await flushTestUpdates(async () => {
      row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
      await Promise.resolve()
    })
    expect(filetreeClientMocks.getWorkspaceFileViewer).toHaveBeenCalledTimes(1)
    workspacesStore.getState().setWorkspacePaneTab(REPO_ID, 'feature/changes', 'status')
    await flushTestUpdates(async () => {
      resolveViewer({ viewer: 'bat', shell: 'posix', executionRoot: worktreePath })
      await Promise.resolve()
    })
    expect(showRepoBranchWorkspacePaneTab).not.toHaveBeenCalled()
    expect(createTerminalWithAdmission).toHaveBeenCalledWith(
      {
        target: {
          kind: 'git-worktree' as const,
          workspaceId: REPO_ID,
          workspaceRuntimeId: repo.workspaceRuntimeId,
          root: 'goblin+file:///tmp/filetree-open-worktree',
        },
        presentation: { kind: 'git-worktree' as const },
      },
      {
        resolveStartupShellCommand: expect.any(Function),
      },
      {
        insertAfterIdentity: 'workspace-pane:files',
      },
    )
    expect(
      readWorkspacePaneTabsForTarget({
        kind: 'git-worktree' as const,
        workspaceId: REPO_ID,
        workspaceRuntimeId: repo.workspaceRuntimeId,
        worktreePath,
      }),
    ).toEqual([staticEntry('files'), terminalEntry('term-111111111111111111111'), staticEntry('status')])
    expect(resolvedStartupShellCommand).toBe(
      "bat --paging=never --style=plain '/tmp/filetree-open-worktree/README.md'\r",
    )

    // Chrome-tab-style opener tracking: the terminal this opened should be
    // attributed to "files" (the only tab open, and active, when the file
    // was double-clicked), scoped to this workspace pane target.
    expect(
      workspacePaneTabOpener(
        {
          kind: 'git-worktree',
          workspaceId: REPO_ID,
          worktreePath: '/tmp/filetree-open-worktree',
        },
        repo.workspaceRuntimeId,
        'terminal:term-111111111111111111111',
      ),
    ).toBe('workspace-pane:files')
  })

  test('opens a workspace-root file through the shared filesystem terminal flow', async () => {
    const workspaceId = workspaceIdForTest('goblin+file:///Users/example/Workspace/sample-project')
    const repo = seedRepoWithReadModelForTest({ id: workspaceId, branches: [], currentBranchName: null })
    filetreeClientMocks.getWorkspaceFilesystemTree.mockResolvedValueOnce({
      nodes: [
        {
          id: 'sample-document.md',
          path: 'sample-document.md',
          name: 'sample-document.md',
          parentId: null,
          kind: 'file',
          status: 'clean',
        },
      ],
      truncated: false,
    })
    filetreeClientMocks.getWorkspaceFileViewer.mockResolvedValueOnce({
      viewer: 'bat',
      shell: 'posix',
      executionRoot: '/Users/example/Workspace/sample-project',
    })
    let startupShellCommand: string | null = null
    const commitWorkspaceRootTerminalSession = vi.fn(async () => true)
    const createTerminalWithAdmission: TerminalSessionContextValue['createTerminalWithAdmission'] = vi.fn(
      async (base, options) => {
        startupShellCommand = (await options?.resolveStartupShellCommand?.()) ?? null
        workspacePaneTabsTestBridge.addRuntimeTab({
          kind: 'workspace-root',
          workspaceId: workspaceId,
          workspaceRuntimeId: repo.workspaceRuntimeId,

          terminalSessionId: 'term-111111111111111111111',
          insertAfterIdentity: 'workspace-pane:files',
        })
        return {
          terminalSessionId: 'term-111111111111111111111',
          presentation: { kind: 'workspace-root' as const },
          requestRole: 'leader' as const,
          resourceDisposition: 'created' as const,
          runtimeProjectionApplied: true,
        }
      },
    )

    renderInJsdom(
      <VueQueryClientScope client={appQueryClient}>
        <AppNavigationProvider value={navigationWith({ commitWorkspaceRootTerminalSession })}>
          <TerminalSessionCommandScope value={terminalCommandContextWith({ createTerminalWithAdmission })}>
            <WorkspaceFilesystemTabPanel
              target={workspaceRootPaneFilesystemTarget({
                workspaceId,
                workspaceRuntimeId: repo.workspaceRuntimeId,
                capabilities: {
                  files: { read: true, write: true },
                  terminal: { available: true },
                  git: { status: 'unavailable' },
                },
              })}
            />
          </TerminalSessionCommandScope>
        </AppNavigationProvider>
      </VueQueryClientScope>,
    )

    const row = await screen.findByRole('treeitem', { name: 'sample-document.md' })
    await flushTestUpdates(async () => {
      row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
      await Promise.resolve()
    })

    await waitFor(() => expect(createTerminalWithAdmission).toHaveBeenCalledOnce())
    expect(createTerminalWithAdmission).toHaveBeenCalledWith(
      {
        target: {
          kind: 'workspace-root',
          workspaceId,
          workspaceRuntimeId: repo.workspaceRuntimeId,
        },
        presentation: { kind: 'workspace-root' },
      },
      { resolveStartupShellCommand: expect.any(Function) },
      { insertAfterIdentity: 'workspace-pane:files' },
    )
    expect(commitWorkspaceRootTerminalSession).toHaveBeenCalledWith(
      workspaceId,
      repo.workspaceRuntimeId,
      'term-111111111111111111111',
      expect.objectContaining({ navigationGeneration: expect.any(Number) }),
    )
    expect(startupShellCommand).toBe(
      "bat --paging=never --style=plain '/Users/example/Workspace/sample-project/sample-document.md'\r",
    )
  })

  test('only exposes download without terminal-open or trash capabilities', async () => {
    const workspaceId = workspaceIdForTest('goblin+file:///tmp/read-only-filetree-workspace')
    const repo = seedRepoWithReadModelForTest({ id: workspaceId, branches: [], currentBranchName: null })
    filetreeClientMocks.getWorkspaceFilesystemTree.mockResolvedValueOnce({
      nodes: [
        {
          id: 'README.md',
          path: 'README.md',
          name: 'README.md',
          parentId: null,
          kind: 'file',
          status: 'clean',
        },
      ],
      truncated: false,
    })
    const createTerminalWithAdmission = vi.fn()

    renderInJsdom(
      <VueQueryClientScope client={appQueryClient}>
        <AppNavigationProvider value={navigationWith({})}>
          <TerminalSessionCommandScope value={terminalCommandContextWith({ createTerminalWithAdmission })}>
            <WorkspaceFilesystemTabPanel
              target={workspaceRootPaneFilesystemTarget({
                workspaceId,
                workspaceRuntimeId: repo.workspaceRuntimeId,
                capabilities: {
                  files: { read: true, write: false },
                  terminal: { available: false },
                  git: { status: 'unavailable' },
                },
              })}
            />
          </TerminalSessionCommandScope>
        </AppNavigationProvider>
      </VueQueryClientScope>,
    )

    const row = await screen.findByRole('treeitem', { name: 'README.md' })
    const actionButton = row.querySelector<HTMLButtonElement>('[data-action-popover-trigger]')
    expect(actionButton).toBeTruthy()
    await flushTestUpdates(async () => actionButton?.click())
    expect(document.body.textContent).toContain('filetree.download')
    expect(document.body.textContent).not.toContain('app-chrome.open')
    expect(document.body.textContent).not.toContain('menu.edit.delete')
    row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    expect(createTerminalWithAdmission).not.toHaveBeenCalled()
  })
})
