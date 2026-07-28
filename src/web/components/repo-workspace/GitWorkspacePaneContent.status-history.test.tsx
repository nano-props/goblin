// @vitest-environment jsdom

import {
  GitWorkspacePaneContentHarness,
  REPO_ID,
  branchActionSurfaceWithCopyPatch,
  defaultBranchActionSurface,
  emptyTerminalReadContext,
  flushAsyncWork,
  getTestGitWorkspacePanePresentation,
  gitWorkspacePaneProjection,
  gitWorktreeFilesystemTarget,
  navigationWith,
  preferenceBackedWorkspacePaneTabModel,
  repoClientMocks,
  staticEntry,
} from '#/web/test-utils/git-workspace-pane-content.tsx'
import { seedRepoWithReadModelForTest, createBranchSnapshot } from '#/web/test-utils/repo-store.ts'
import { act, screen, waitFor } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { BranchActionSurfaceContext } from '#/web/components/repo-workspace/branch-action-surface-context.ts'
import { GitWorkspacePaneContent } from '#/web/components/repo-workspace/GitWorkspacePaneContent.tsx'
import { TerminalSessionReadContext } from '#/web/components/terminal/terminal-session-context.ts'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import { runCloseWorkspacePaneTabCommand } from '#/web/commands/workspace-commands.ts'
import { PrimaryWindowNavigationProvider } from '#/web/primary-window-navigation.tsx'
import { useFakeTimers } from '#/test-utils/timers.ts'
import { getCurrentGitWorkspacePanePresentation as buildGitWorkspacePanePresentation } from '#/web/components/repo-workspace/model.ts'
import { observeWorkspacePaneRouteForTest } from '#/web/test-utils/workspace-pane-navigation.ts'
import { workspacePaneTabOpener } from '#/web/workspace-pane/workspace-pane-tab-opener.ts'
import { renderInJsdom } from '#/test-utils/render.tsx'
describe('GitWorkspacePaneContent status-history', () => {
  test('renders the changes row with the copy patch action in the status tab when the worktree is dirty', () => {
    const onCopyPatch = vi.fn()
    const worktreePath = '/tmp/changes-worktree'
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [
        createBranchSnapshot('feature/changes', {
          worktree: { path: worktreePath, isPrimary: false, isLocked: false },
        }),
      ],
      currentBranchName: 'feature/changes',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: {
        'feature/changes': [staticEntry('status'), staticEntry('changes')],
      },
      status: [
        {
          path: worktreePath,
          branch: 'feature/changes',
          isMain: false,
          entries: [
            { x: 'M', y: ' ', path: 'src/a.ts' },
            { x: 'M', y: ' ', path: 'src/b.ts' },
            { x: 'M', y: ' ', path: 'src/c.ts' },
            { x: 'M', y: ' ', path: 'src/d.ts' },
          ],
        },
      ],
    })
    const presentationRepo = gitWorkspacePaneProjection(repo)
    const detail = buildGitWorkspacePanePresentation(
      presentationRepo,
      {
        loading: true,
        error: null,
        stale: false,
      },
      undefined,
      { state: 'empty', stale: false, error: null, retrying: false, retry: vi.fn() },
    )
    const workspacePaneTabModel = preferenceBackedWorkspacePaneTabModel(REPO_ID, 'feature/changes')

    const { container } = renderInJsdom(
      <TerminalSessionReadContext value={emptyTerminalReadContext}>
        <BranchActionSurfaceContext
          value={branchActionSurfaceWithCopyPatch({
            label: 'status.copy-patch',
            title: 'status.copy-patch-title',
            disabled: false,
            visible: true,
            onSelect: onCopyPatch,
          })}
        >
          <GitWorkspacePaneContent
            repo={presentationRepo}
            detail={detail}
            workspacePaneId="workspace"
            workspacePaneTabModel={workspacePaneTabModel}
          />
        </BranchActionSurfaceContext>
      </TerminalSessionReadContext>,
    )

    expect(container.querySelector('#workspace-status-panel')?.getAttribute('aria-busy')).toBe('true')
    expect(container.textContent).toContain('branch-status.changes-count')
    expect(container.textContent).toContain('branch-status.signal.changes')

    const copyButton = container.querySelector<HTMLButtonElement>('button[aria-label="status.copy-patch-title"]')
    expect(copyButton).not.toBeNull()
    // The button is now icon-only (no visible text), mirroring CopyButton.
    expect(copyButton!.textContent?.trim()).toBe('')
    act(() => {
      copyButton!.click()
    })
    expect(onCopyPatch).toHaveBeenCalledTimes(1)
  })

  test('flashes the check affordance when copy patch onSelect resolves to true, then reverts', async () => {
    useFakeTimers()
    const worktreePath = '/tmp/copy-success-worktree'
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [
        createBranchSnapshot('feature/copy-success', {
          worktree: { path: worktreePath, isPrimary: false, isLocked: false },
        }),
      ],
      currentBranchName: 'feature/copy-success',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: {
        'feature/copy-success': [staticEntry('status')],
      },
      status: [
        {
          path: worktreePath,
          branch: 'feature/copy-success',
          isMain: false,
          entries: [{ x: 'M', y: ' ', path: 'src/example.ts' }],
        },
      ],
    })
    const detail = getTestGitWorkspacePanePresentation(gitWorkspacePaneProjection(repo))
    const onCopyPatch = vi.fn().mockResolvedValue(true)

    const { container } = renderInJsdom(
      <TerminalSessionReadContext value={emptyTerminalReadContext}>
        <BranchActionSurfaceContext
          value={branchActionSurfaceWithCopyPatch({
            label: 'status.copy-patch',
            title: 'status.copy-patch-title',
            disabled: false,
            visible: true,
            onSelect: onCopyPatch,
          })}
        >
          <GitWorkspacePaneContentHarness
            repo={gitWorkspacePaneProjection(repo)}
            detail={detail}
            workspacePaneId="workspace"
          />
        </BranchActionSurfaceContext>
      </TerminalSessionReadContext>,
    )

    const copyButton = container.querySelector<HTMLButtonElement>('button[aria-label="status.copy-patch-title"]')!
    expect(copyButton).not.toBeNull()

    await act(async () => {
      copyButton.click()
      await vi.runOnlyPendingTimersAsync()
    })

    // After success, the tooltip stays open and the label flips to
    // status.copy-patch-success. Radix renders the tooltip into a
    // portal under document.body, so check the whole document.
    expect(document.body.textContent).toContain('status.copy-patch-success')

    act(() => {
      vi.advanceTimersByTime(1500)
    })

    expect(document.body.textContent).not.toContain('status.copy-patch-success')
  })

  test('does not render the changes row in the status tab when the worktree is clean', () => {
    const worktreePath = '/tmp/clean-worktree'
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [
        createBranchSnapshot('feature/clean', {
          worktree: { path: worktreePath, isPrimary: false, isLocked: false },
        }),
      ],
      currentBranchName: 'feature/clean',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: {
        'feature/clean': [staticEntry('status')],
      },
      status: [{ path: worktreePath, branch: 'feature/clean', isMain: false, entries: [] }],
    })
    const detail = getTestGitWorkspacePanePresentation(gitWorkspacePaneProjection(repo))

    const { container } = renderInJsdom(
      <TerminalSessionReadContext value={emptyTerminalReadContext}>
        <BranchActionSurfaceContext
          value={branchActionSurfaceWithCopyPatch({
            label: 'status.copy-patch',
            title: 'status.copy-patch-title',
            disabled: false,
            visible: true,
            onSelect: vi.fn(),
          })}
        >
          <GitWorkspacePaneContentHarness
            repo={gitWorkspacePaneProjection(repo)}
            detail={detail}
            workspacePaneId="workspace"
          />
        </BranchActionSurfaceContext>
      </TerminalSessionReadContext>,
    )

    expect(container.querySelector('#workspace-status-panel')).not.toBeNull()
    expect(container.textContent).not.toContain('branch-status.changes-count')
    expect(container.textContent).not.toContain('branch-status.signal.changes')
    expect(container.querySelector('button[aria-label="status.copy-patch-title"]')).toBeNull()
  })

  test('opens files from the status row as a new tab and returns to status when it closes', async () => {
    const worktreePath = '/tmp/status-links-worktree'
    const showRepoBranchWorkspacePaneTab = vi.fn((repoId, branch, tab) => {
      useWorkspacesStore.getState().setWorkspacePaneTab(repoId, branch, tab)
      return true
    })
    const showRepoBranchEmptyWorkspacePane = vi.fn(() => true)
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [
        createBranchSnapshot('feature/status-links', {
          worktree: { path: worktreePath, isPrimary: false, isLocked: false },
        }),
      ],
      currentBranchName: 'feature/status-links',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: {
        'feature/status-links': [staticEntry('status'), staticEntry('changes')],
      },
      status: [
        {
          path: worktreePath,
          branch: 'feature/status-links',
          isMain: false,
          entries: Array.from({ length: 18 }, (_, index) => ({ x: 'M', y: ' ', path: `src/file-${index}.ts` })),
        },
      ],
    })
    const detail = getTestGitWorkspacePanePresentation(gitWorkspacePaneProjection(repo))
    const navigation = navigationWith({ showRepoBranchWorkspacePaneTab, showRepoBranchEmptyWorkspacePane })

    const { container } = renderInJsdom(
      <PrimaryWindowNavigationProvider value={navigation}>
        <TerminalSessionReadContext value={emptyTerminalReadContext}>
          <BranchActionSurfaceContext value={defaultBranchActionSurface()}>
            <GitWorkspacePaneContentHarness
              repo={gitWorkspacePaneProjection(repo)}
              detail={detail}
              workspacePaneId="workspace"
            />
          </BranchActionSurfaceContext>
        </TerminalSessionReadContext>
      </PrimaryWindowNavigationProvider>,
    )

    const pathButton = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent === worktreePath,
    )

    expect(pathButton).not.toBeNull()
    observeWorkspacePaneRouteForTest({
      workspaceId: REPO_ID,
      workspaceRuntimeId: repo.workspaceRuntimeId,
      branchName: 'feature/status-links',
      worktreePath,
      route: { kind: 'static', tab: 'status' },
    })

    await act(async () => {
      pathButton?.click()
      await Promise.resolve()
    })
    expect(showRepoBranchWorkspacePaneTab).toHaveBeenCalledWith(REPO_ID, 'feature/status-links', 'files')
    expect(
      workspacePaneTabOpener(
        {
          kind: 'git-worktree',
          workspaceId: REPO_ID,
          worktreePath,
        },
        repo.workspaceRuntimeId,
        'workspace-pane:files',
      ),
    ).toBe('workspace-pane:status')

    showRepoBranchWorkspacePaneTab.mockClear()
    observeWorkspacePaneRouteForTest({
      workspaceId: REPO_ID,
      workspaceRuntimeId: repo.workspaceRuntimeId,
      branchName: 'feature/status-links',
      worktreePath,
      route: { kind: 'static', tab: 'files' },
    })

    expect(
      await runCloseWorkspacePaneTabCommand({
        workspaceId: REPO_ID,
        target: {
          routeTarget: { kind: 'git-branch', workspaceId: REPO_ID, branchName: 'feature/status-links' },
          workspacePaneRoute: { kind: 'static', tab: 'files' },
          filesystemTarget: gitWorktreeFilesystemTarget(repo, worktreePath, 'feature/status-links'),
        },
        targetIdentity: 'workspace-pane:files',
        navigation,
      }),
    ).toBe(true)
    expect(showRepoBranchWorkspacePaneTab).toHaveBeenCalledWith(REPO_ID, 'feature/status-links', 'status')
    expect(showRepoBranchEmptyWorkspacePane).not.toHaveBeenCalled()
  })

  test('opens changes from the status row', async () => {
    const worktreePath = '/tmp/status-links-worktree'
    const showRepoBranchWorkspacePaneTab = vi.fn(() => true)
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [
        createBranchSnapshot('feature/status-links', {
          worktree: { path: worktreePath, isPrimary: false, isLocked: false },
        }),
      ],
      currentBranchName: 'feature/status-links',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: {
        'feature/status-links': [staticEntry('status'), staticEntry('changes')],
      },
      status: [
        {
          path: worktreePath,
          branch: 'feature/status-links',
          isMain: false,
          entries: Array.from({ length: 18 }, (_, index) => ({ x: 'M', y: ' ', path: `src/file-${index}.ts` })),
        },
      ],
    })
    const detail = getTestGitWorkspacePanePresentation(gitWorkspacePaneProjection(repo))

    const { container } = renderInJsdom(
      <PrimaryWindowNavigationProvider value={navigationWith({ showRepoBranchWorkspacePaneTab })}>
        <TerminalSessionReadContext value={emptyTerminalReadContext}>
          <BranchActionSurfaceContext value={defaultBranchActionSurface()}>
            <GitWorkspacePaneContentHarness
              repo={gitWorkspacePaneProjection(repo)}
              detail={detail}
              workspacePaneId="workspace"
            />
          </BranchActionSurfaceContext>
        </TerminalSessionReadContext>
      </PrimaryWindowNavigationProvider>,
    )

    const changesButton = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find((button) =>
      (button.textContent ?? '').includes('branch-status.changes-count'),
    )

    expect(changesButton).not.toBeNull()
    observeWorkspacePaneRouteForTest({
      workspaceId: REPO_ID,
      workspaceRuntimeId: repo.workspaceRuntimeId,
      branchName: 'feature/status-links',
      worktreePath,
      route: { kind: 'static', tab: 'status' },
    })

    await act(async () => {
      changesButton?.click()
      await Promise.resolve()
    })
    expect(showRepoBranchWorkspacePaneTab).toHaveBeenCalledWith(REPO_ID, 'feature/status-links', 'changes')
  })

  test('opens upstream refs and commit hashes from the status rows', async () => {
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [
        createBranchSnapshot('feature/open-links', {
          tracking: 'origin/team/main',
          lastCommitHash: 'ecff955e65e045ee673dc730c06a9a7350d8a558',
          lastCommitShortHash: 'ecff955',
          lastCommitMessage: 'Unify repo status link actions',
        }),
      ],
      currentBranchName: 'feature/open-links',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: {
        'feature/open-links': [staticEntry('status')],
      },
      remote: {
        remotes: [
          { name: 'origin', fetchUrl: 'https://example.test/repo.git', pushUrl: 'https://example.test/repo.git' },
          { name: 'origin/team', fetchUrl: 'https://example.test/team.git', pushUrl: 'https://example.test/team.git' },
        ],
        hasRemotes: true,
        hasBrowserRemote: true,
        browserRemoteProvider: 'github',
        remoteProviders: { origin: 'github', 'origin/team': 'gitlab' },
        hasGitHubRemote: true,
      },
    })
    const presentationRepo = gitWorkspacePaneProjection(repo)
    const detail = getTestGitWorkspacePanePresentation(presentationRepo)
    const workspacePaneTabModel = preferenceBackedWorkspacePaneTabModel(REPO_ID, 'feature/open-links')

    const { container } = renderInJsdom(
      <TerminalSessionReadContext value={emptyTerminalReadContext}>
        <BranchActionSurfaceContext value={defaultBranchActionSurface()}>
          <GitWorkspacePaneContent
            repo={presentationRepo}
            detail={detail}
            workspacePaneId="workspace"
            workspacePaneTabModel={workspacePaneTabModel}
          />
        </BranchActionSurfaceContext>
      </TerminalSessionReadContext>,
    )

    const upstreamButton = container.querySelector<HTMLButtonElement>('[data-upstream-link=""]')
    const commitButton = container.querySelector<HTMLButtonElement>('[data-commit-link=""]')

    expect(upstreamButton).not.toBeNull()
    expect(commitButton).not.toBeNull()

    await act(async () => {
      upstreamButton?.click()
      await Promise.resolve()
    })
    expect(repoClientMocks.openRepoUrl).toHaveBeenCalledWith(REPO_ID, repo.workspaceRuntimeId, {
      type: 'branch',
      branch: 'main',
      remote: 'origin/team',
    })

    repoClientMocks.openRepoUrl.mockClear()

    await act(async () => {
      commitButton?.click()
      await Promise.resolve()
    })
    expect(repoClientMocks.openRepoUrl).toHaveBeenCalledWith(REPO_ID, repo.workspaceRuntimeId, {
      type: 'commit',
      hash: 'ecff955e65e045ee673dc730c06a9a7350d8a558',
    })
  })

  test('hides the copy patch button on the changes row when copyPatchAction.visible is false', () => {
    const worktreePath = '/tmp/visibility-worktree'
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [
        createBranchSnapshot('feature/hidden', {
          worktree: { path: worktreePath, isPrimary: false, isLocked: false },
        }),
      ],
      currentBranchName: 'feature/hidden',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: {
        'feature/hidden': [staticEntry('status')],
      },
      status: [
        {
          path: worktreePath,
          branch: 'feature/hidden',
          isMain: false,
          entries: [{ x: 'M', y: ' ', path: 'src/example.ts' }],
        },
      ],
    })
    const detail = getTestGitWorkspacePanePresentation(gitWorkspacePaneProjection(repo))

    const { container } = renderInJsdom(
      <TerminalSessionReadContext value={emptyTerminalReadContext}>
        <BranchActionSurfaceContext
          value={branchActionSurfaceWithCopyPatch({
            label: 'status.copy-patch',
            title: 'status.copy-patch-title',
            disabled: false,
            visible: false,
            onSelect: vi.fn(),
          })}
        >
          <GitWorkspacePaneContentHarness
            repo={gitWorkspacePaneProjection(repo)}
            detail={detail}
            workspacePaneId="workspace"
          />
        </BranchActionSurfaceContext>
      </TerminalSessionReadContext>,
    )

    expect(container.textContent).toContain('branch-status.changes-count')
    expect(container.querySelector('button[aria-label="status.copy-patch-title"]')).toBeNull()
  })

  test('renders the changes panel with status entries and tab labelling', () => {
    const worktreePath = '/tmp/changes-panel-worktree'
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [
        createBranchSnapshot('feature/changes-panel', {
          worktree: { path: worktreePath, isPrimary: false, isLocked: false },
        }),
      ],
      currentBranchName: 'feature/changes-panel',
      preferredWorkspacePaneTab: 'changes',
      workspacePaneTabsByBranch: {
        'feature/changes-panel': [staticEntry('status'), staticEntry('changes')],
      },
      status: [
        {
          path: worktreePath,
          branch: 'feature/changes-panel',
          isMain: false,
          entries: [
            { x: 'M', y: ' ', path: 'src/alpha.ts' },
            { x: '?', y: '?', path: 'src/beta.ts' },
          ],
        },
      ],
    })
    const presentationRepo = gitWorkspacePaneProjection(repo)
    const detail = getTestGitWorkspacePanePresentation(presentationRepo)
    const workspacePaneTabModel = preferenceBackedWorkspacePaneTabModel(REPO_ID, 'feature/changes-panel')

    const { container } = renderInJsdom(
      <TerminalSessionReadContext value={emptyTerminalReadContext}>
        <BranchActionSurfaceContext value={defaultBranchActionSurface()}>
          <GitWorkspacePaneContent
            repo={presentationRepo}
            detail={detail}
            workspacePaneId="workspace"
            workspacePaneTabModel={workspacePaneTabModel}
          />
        </BranchActionSurfaceContext>
      </TerminalSessionReadContext>,
    )

    const panel = container.querySelector('#workspace-changes-panel')
    expect(panel).not.toBeNull()
    expect(panel?.getAttribute('role')).toBe('tabpanel')
    expect(panel?.getAttribute('aria-labelledby')).toBe('workspace-changes-tab')
    expect(panel?.querySelector('[aria-label="M "]')).not.toBeNull()
    expect(panel?.querySelector('[aria-label="??"]')).not.toBeNull()
    expect(panel?.querySelector('[aria-label="src/alpha.ts"]')).not.toBeNull()
    expect(panel?.querySelector('[aria-label="src/beta.ts"]')).not.toBeNull()
  })

  test('keeps stale changes visible and retries status from the query owner callback', () => {
    const worktreePath = '/tmp/stale-changes-panel-worktree'
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [
        createBranchSnapshot('feature/stale-changes', {
          worktree: { path: worktreePath, isPrimary: false, isLocked: false },
        }),
      ],
      currentBranchName: 'feature/stale-changes',
      preferredWorkspacePaneTab: 'changes',
      workspacePaneTabsByBranch: {
        'feature/stale-changes': [staticEntry('changes')],
      },
      status: [
        {
          path: worktreePath,
          branch: 'feature/stale-changes',
          isMain: false,
          entries: [{ x: 'M', y: ' ', path: 'src/stale.ts' }],
        },
      ],
    })
    const presentationRepo = gitWorkspacePaneProjection(repo)
    const detail = buildGitWorkspacePanePresentation(
      presentationRepo,
      {
        loading: false,
        error: 'status failed',
        stale: true,
      },
      undefined,
      { state: 'empty', stale: false, error: null, retrying: false, retry: vi.fn() },
    )
    const onRetryStatus = vi.fn()

    const { container } = renderInJsdom(
      <TerminalSessionReadContext value={emptyTerminalReadContext}>
        <BranchActionSurfaceContext value={defaultBranchActionSurface()}>
          <GitWorkspacePaneContentHarness
            repo={presentationRepo}
            detail={detail}
            workspacePaneId="workspace"
            onRetryStatus={onRetryStatus}
          />
        </BranchActionSurfaceContext>
      </TerminalSessionReadContext>,
    )

    expect(container.textContent).toContain('status.stale-title')
    expect(container.querySelector('[aria-label="src/stale.ts"]')).not.toBeNull()
    act(() => screen.getByRole('button', { name: 'error.try-again' }).click())
    expect(onRetryStatus).toHaveBeenCalledOnce()
  })

  test('renders branch status for a selected branch without a worktree', () => {
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [
        createBranchSnapshot('feature/no-worktree', {
          tracking: 'origin/feature/no-worktree',
          lastCommitHash: 'abc1234000000000000000000000000000000000',
          lastCommitShortHash: 'abc1234',
          lastCommitMessage: 'Update placeholder branch',
          lastCommitAuthor: 'Example Author',
          lastCommitDate: '2026-01-01T00:00:00.000Z',
        }),
      ],
      currentBranchName: 'feature/no-worktree',
      preferredWorkspacePaneTab: 'status',
    })
    const detail = getTestGitWorkspacePanePresentation(gitWorkspacePaneProjection(repo))

    const { container } = renderInJsdom(
      <TerminalSessionReadContext value={emptyTerminalReadContext}>
        <BranchActionSurfaceContext value={defaultBranchActionSurface()}>
          <GitWorkspacePaneContentHarness
            repo={gitWorkspacePaneProjection(repo)}
            detail={detail}
            workspacePaneId="workspace"
          />
        </BranchActionSurfaceContext>
      </TerminalSessionReadContext>,
    )

    expect(container.querySelector('#workspace-status-panel')).not.toBeNull()
    expect(container.textContent).toContain('feature/no-worktree')
    expect(container.textContent).toContain('branch-status.worktree.none')
    expect(container.textContent).not.toContain('workspace-pane-tabs.empty')
  })

  test('renders branch history as a linear commit graph', async () => {
    repoClientMocks.getRepoLog.mockResolvedValue([
      {
        hash: '78c150a000000000000000000000000000000000',
        shortHash: '78c150a',
        refs: 'HEAD -> fix/w-tab, origin/main, origin/fix/w-tab, origin/HEAD, main',
        message: 'Fix branch navigator name truncation',
        author: 'Example Author',
        date: '2026-06-21T00:00:00.000Z',
      },
      {
        hash: '1111111000000000000000000000000000000000',
        shortHash: '1111111',
        refs: '',
        message: 'Start history graph',
        author: 'Example Author',
        date: '2026-06-20T00:00:00.000Z',
      },
    ])
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [createBranchSnapshot('feature/history')],
      currentBranchName: 'feature/history',
      preferredWorkspacePaneTab: 'history',
      workspacePaneTabsByBranch: { 'feature/history': [staticEntry('status'), staticEntry('history')] },
    })
    const detail = getTestGitWorkspacePanePresentation(gitWorkspacePaneProjection(repo))

    const { container } = renderInJsdom(
      <TerminalSessionReadContext value={emptyTerminalReadContext}>
        <GitWorkspacePaneContentHarness
          repo={gitWorkspacePaneProjection(repo)}
          detail={detail}
          workspacePaneId="workspace"
        />
      </TerminalSessionReadContext>,
    )
    await flushAsyncWork()
    await flushAsyncWork()

    expect(repoClientMocks.getRepoLog).toHaveBeenCalledWith(
      REPO_ID,
      repo.workspaceRuntimeId,
      'feature/history',
      expect.objectContaining({ count: 150 }),
    )
    await waitFor(() => {
      expect(container.querySelector('[data-history-commit-graph=""]')).not.toBeNull()
    })
    const rows = Array.from(container.querySelectorAll('[data-history-commit-row=""]'))
    expect(rows).toHaveLength(2)
    expect(rows[0]?.textContent).toContain('78c150a')
    expect(rows[0]?.textContent).toContain('Fix branch navigator name truncation')
    const headRef = rows[0]?.querySelector('[data-history-log-ref-token="HEAD -> fix/w-tab"]')
    expect(headRef).not.toBeNull()
    expect(headRef?.getAttribute('data-history-log-ref-remotes')).toBe('origin')
    const mainRef = rows[0]?.querySelector('[data-history-log-ref-token="main"]')
    expect(mainRef).not.toBeNull()
    expect(mainRef?.getAttribute('data-history-log-ref-remotes')).toBe('origin')
    const hashButton = rows[0]?.querySelector('[data-history-log-hash=""]') as HTMLButtonElement | null
    await act(async () => {
      hashButton?.click()
    })
    expect(repoClientMocks.openRepoUrl).toHaveBeenCalledWith(REPO_ID, repo.workspaceRuntimeId, {
      type: 'commit',
      hash: '78c150a000000000000000000000000000000000',
    })
    expect(rows[1]?.textContent).toContain('1111111')
    expect(rows[1]?.textContent).toContain('Start history graph')
  })

  test('labels worktree history panels with the static tab id', async () => {
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [
        createBranchSnapshot('feature/history', {
          worktree: { path: '/tmp/history-worktree', isPrimary: false, isLocked: false },
        }),
      ],
      currentBranchName: 'feature/history',
      preferredWorkspacePaneTab: 'history',
      workspacePaneTabsByBranch: { 'feature/history': [staticEntry('status'), staticEntry('history')] },
    })
    const detail = getTestGitWorkspacePanePresentation(gitWorkspacePaneProjection(repo))

    const { container } = renderInJsdom(
      <TerminalSessionReadContext value={emptyTerminalReadContext}>
        <GitWorkspacePaneContentHarness
          repo={gitWorkspacePaneProjection(repo)}
          detail={detail}
          workspacePaneId="workspace"
        />
      </TerminalSessionReadContext>,
    )
    await flushAsyncWork()

    expect(container.querySelector('#workspace-history-panel')?.getAttribute('aria-labelledby')).toBe(
      'workspace-history-tab',
    )
  })

  test('shows an error state when branch history cannot be read', async () => {
    repoClientMocks.getRepoLog.mockRejectedValue(new Error('error.failed-read-repo'))
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [createBranchSnapshot('feature/history')],
      currentBranchName: 'feature/history',
      preferredWorkspacePaneTab: 'history',
      workspacePaneTabsByBranch: { 'feature/history': [staticEntry('history')] },
    })
    const detail = getTestGitWorkspacePanePresentation(gitWorkspacePaneProjection(repo))

    const { container } = renderInJsdom(
      <TerminalSessionReadContext value={emptyTerminalReadContext}>
        <GitWorkspacePaneContentHarness
          repo={gitWorkspacePaneProjection(repo)}
          detail={detail}
          workspacePaneId="workspace"
        />
      </TerminalSessionReadContext>,
    )
    await flushAsyncWork()

    await waitFor(() => {
      expect(container.textContent).toContain('error.failed-read-repo')
    })
    expect(container.textContent).not.toContain('log.empty-for-branch')
  })
})
