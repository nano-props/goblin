// @vitest-environment jsdom

import { seedRepoWithReadModelForTest, createBranchSnapshot } from '#/web/test-utils/repo-store.ts'
import { waitFor } from '@testing-library/vue'
import { flushTestUpdates } from '#/test-utils/render.tsx'
import { VueQueryClientScope } from '#/web/test-utils/VueQueryClientScope.tsx'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { waitForNextMacrotask } from '#/test-utils/microtasks.ts'
import { WorkspacePane } from '#/web/components/workspace-pane/WorkspacePane.tsx'
import {
  TerminalSessionCommandScope,
  TerminalSessionReadScope,
} from '#/web/components/terminal/terminal-session-context.ts'
import type { TerminalSessionReadContextValue } from '#/web/components/terminal/types.ts'
import type { AppNavigationActions } from '#/web/app-navigation-actions.ts'
import { AppNavigationProvider } from '#/web/app-navigation.tsx'
import { terminalProjectionHydrationStore } from '#/web/stores/terminal-projection-hydration.ts'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'
import { installWorkspacePaneTabsTestBridge } from '#/web/test-utils/workspace-pane-bridge.ts'
import { appQueryClient } from '#/web/app-query-client.ts'
import { workspacePaneRuntimeTabEntry, workspacePaneStaticTabEntry } from '#/shared/workspace-pane.ts'
import { formatTerminalFilesystemTargetKeyForPath } from '#/shared/terminal-filesystem-target-key.ts'
import { setWorkspacePaneTabsForTargetQueryData } from '#/web/test-utils/workspace-pane-tabs.ts'
import { preferredWorkspacePaneTabForTarget } from '#/web/stores/workspaces/workspace-pane-preferences.ts'
import { runCloseWorkspacePaneTabCommand } from '#/web/commands/workspace-commands.ts'
import {
  REPO_ID,
  gitWorktreeFilesystemTarget,
  navigationWithStore,
  presentationOptions,
  render,
  routeNavigation,
  terminalCommandContext,
  terminalReadContext,
  terminalReadContextWithSession,
  terminalReadContextWithSessions,
} from '#/web/test-utils/workspace-pane.tsx'

const responsiveMocks = vi.hoisted(() => ({ compact: false }))
vi.mock('#/web/hooks/useResponsiveUiMode.tsx', () => ({
  useIsCompactUi: () => ({
    get value() {
      return responsiveMocks.compact
    },
  }),
}))

beforeEach(() => {
  responsiveMocks.compact = false
})

describe('WorkspacePane route synchronization', () => {
  test('renders a stale terminal URL as an empty pane without navigating', async () => {
    const worktreePath = '/tmp/repo-workspace-container-repo-a'
    const branchName = 'feature/a'
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [
        createBranchSnapshot(branchName, { worktree: { path: worktreePath, isPrimary: false, isLocked: false } }),
      ],
      currentBranchName: branchName,
      preferredWorkspacePaneTab: 'terminal',
      workspacePaneTabsByBranch: {
        [branchName]: [
          workspacePaneStaticTabEntry('status'),
          workspacePaneRuntimeTabEntry('terminal', 'term-111111111111111111111'),
        ],
      },
    })
    terminalProjectionHydrationStore.getState().markProjectionReady(REPO_ID, repo.workspaceRuntimeId)
    const terminalFilesystemTargetKey = formatTerminalFilesystemTargetKeyForPath(REPO_ID, worktreePath)
    const readContext = terminalReadContextWithSession(terminalFilesystemTargetKey, 'term-111111111111111111111')
    const route = routeNavigation()
    const { container } = render(
      <VueQueryClientScope client={appQueryClient}>
        <AppNavigationProvider value={navigationWithStore(route)}>
          <TerminalSessionCommandScope value={terminalCommandContext}>
            <TerminalSessionReadScope value={readContext}>
              <WorkspacePane
                workspaceId={REPO_ID}
                currentBranchName={branchName}
                workspacePaneRouteContext={{
                  kind: 'routed',
                  route: { kind: 'terminal', terminalSessionId: 'missing-session' },
                }}
              />
            </TerminalSessionReadScope>
          </TerminalSessionCommandScope>
        </AppNavigationProvider>
      </VueQueryClientScope>,
    )

    expect(container.textContent).toContain('workspace-pane-tabs.empty')
    expect(route.openRepoBranch).not.toHaveBeenCalled()
    expect(route.openRepoBranchTerminal).not.toHaveBeenCalled()
    expect(workspacesStore.getState().navigationHistoryByWorkspace[REPO_ID]).toBeUndefined()
  })

  test('does not navigate a missing branch route after terminal metadata changes', async () => {
    const worktreePath = '/tmp/repo-workspace-rejected-branch-reconciliation'
    const branchName = 'feature/rejected-reconciliation'
    const retainedSessionId = 'term-111111111111111111111'
    const missingSessionId = 'term-222222222222222222222'
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [
        createBranchSnapshot(branchName, { worktree: { path: worktreePath, isPrimary: false, isLocked: false } }),
      ],
      currentBranchName: branchName,
      workspacePaneTabsByBranch: {
        [branchName]: [workspacePaneRuntimeTabEntry('terminal', retainedSessionId)],
      },
    })
    terminalProjectionHydrationStore.getState().markProjectionReady(REPO_ID, repo.workspaceRuntimeId)
    const terminalFilesystemTargetKey = formatTerminalFilesystemTargetKeyForPath(REPO_ID, worktreePath)
    const actions = navigationWithStore()
    const commitWorkspacePaneRoute = vi.fn<AppNavigationActions['commitWorkspacePaneRoute']>(async () => false)
    actions.commitWorkspacePaneRoute = commitWorkspacePaneRoute
    const workspace = (readContext: TerminalSessionReadContextValue) => (
      <VueQueryClientScope client={appQueryClient}>
        <AppNavigationProvider value={actions}>
          <TerminalSessionCommandScope value={terminalCommandContext}>
            <TerminalSessionReadScope value={readContext}>
              <WorkspacePane
                workspaceId={REPO_ID}
                currentBranchName={branchName}
                workspacePaneRouteContext={{
                  kind: 'routed',
                  route: { kind: 'terminal', terminalSessionId: missingSessionId },
                }}
              />
            </TerminalSessionReadScope>
          </TerminalSessionCommandScope>
        </AppNavigationProvider>
      </VueQueryClientScope>
    )

    const { rerender } = render(
      workspace(
        terminalReadContextWithSessions(terminalFilesystemTargetKey, [retainedSessionId], retainedSessionId, {
          sessionTitles: { [retainedSessionId]: 'shell before metadata update' },
        }),
      ),
    )
    await flushTestUpdates(async () => {
      await Promise.resolve()
    })
    expect(commitWorkspacePaneRoute).not.toHaveBeenCalled()

    await flushTestUpdates(async () => {
      await rerender(
        workspace(
          terminalReadContextWithSessions(terminalFilesystemTargetKey, [retainedSessionId], retainedSessionId, {
            sessionTitles: { [retainedSessionId]: 'shell after metadata update' },
          }),
        ),
      )
      await Promise.resolve()
    })

    expect(commitWorkspacePaneRoute).not.toHaveBeenCalled()
  })

  test('syncs a routed terminal session into the projection-owned terminal selection', async () => {
    const worktreePath = '/tmp/repo-workspace-container-repo-a'
    const branchName = 'feature/a'
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [
        createBranchSnapshot(branchName, { worktree: { path: worktreePath, isPrimary: false, isLocked: false } }),
      ],
      currentBranchName: branchName,
      preferredWorkspacePaneTab: 'terminal',
      workspacePaneTabsByBranch: {
        [branchName]: [
          workspacePaneRuntimeTabEntry('terminal', 'term-111111111111111111111'),
          workspacePaneRuntimeTabEntry('terminal', 'term-222222222222222222222'),
        ],
      },
    })
    terminalProjectionHydrationStore.getState().markProjectionReady(REPO_ID, repo.workspaceRuntimeId)
    const terminalFilesystemTargetKey = formatTerminalFilesystemTargetKeyForPath(REPO_ID, worktreePath)
    workspacesStore.getState().setSelectedTerminal(terminalFilesystemTargetKey, 'term-111111111111111111111')
    const route = routeNavigation()

    render(
      <VueQueryClientScope client={appQueryClient}>
        <AppNavigationProvider value={navigationWithStore(route)}>
          <TerminalSessionCommandScope value={terminalCommandContext}>
            <TerminalSessionReadScope
              value={terminalReadContextWithSessions(terminalFilesystemTargetKey, [
                'term-111111111111111111111',
                'term-222222222222222222222',
              ])}
            >
              <WorkspacePane
                workspaceId={REPO_ID}
                currentBranchName={branchName}
                workspacePaneRouteContext={{
                  kind: 'routed',
                  route: { kind: 'terminal', terminalSessionId: 'term-222222222222222222222' },
                }}
              />
            </TerminalSessionReadScope>
          </TerminalSessionCommandScope>
        </AppNavigationProvider>
      </VueQueryClientScope>,
    )

    await waitFor(() => {
      expect(
        workspacesStore.getState().selectedTerminalSessionIdByTerminalFilesystemTarget[terminalFilesystemTargetKey],
      ).toBe('term-222222222222222222222')
    })
    expect(route.openRepoBranchTerminal).not.toHaveBeenCalled()
  })

  test('does not sync a routed terminal session before terminal projection verifies the route', async () => {
    const worktreePath = '/tmp/repo-workspace-container-repo-a'
    const branchName = 'feature/a'
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [
        createBranchSnapshot(branchName, { worktree: { path: worktreePath, isPrimary: false, isLocked: false } }),
      ],
      currentBranchName: branchName,
      preferredWorkspacePaneTab: 'terminal',
      workspacePaneTabsByBranch: {
        [branchName]: [
          workspacePaneRuntimeTabEntry('terminal', 'term-111111111111111111111'),
          workspacePaneRuntimeTabEntry('terminal', 'term-222222222222222222222'),
        ],
      },
    })
    const terminalFilesystemTargetKey = formatTerminalFilesystemTargetKeyForPath(REPO_ID, worktreePath)
    workspacesStore.getState().setSelectedTerminal(terminalFilesystemTargetKey, 'term-222222222222222222222')
    const route = routeNavigation()

    render(
      <VueQueryClientScope client={appQueryClient}>
        <AppNavigationProvider value={navigationWithStore(route)}>
          <TerminalSessionCommandScope value={terminalCommandContext}>
            <TerminalSessionReadScope
              value={terminalReadContextWithSessions(terminalFilesystemTargetKey, [
                'term-111111111111111111111',
                'term-222222222222222222222',
              ])}
            >
              <WorkspacePane
                workspaceId={REPO_ID}
                currentBranchName={branchName}
                workspacePaneRouteContext={{
                  kind: 'routed',
                  route: { kind: 'terminal', terminalSessionId: 'term-111111111111111111111' },
                }}
              />
            </TerminalSessionReadScope>
          </TerminalSessionCommandScope>
        </AppNavigationProvider>
      </VueQueryClientScope>,
    )

    await flushTestUpdates(async () => {
      await Promise.resolve()
    })

    expect(route.openRepoBranchTerminal).not.toHaveBeenCalled()
    expect(workspacesStore.getState().navigationHistoryByWorkspace[REPO_ID]).toBeUndefined()
    expect(
      workspacesStore.getState().selectedTerminalSessionIdByTerminalFilesystemTarget[terminalFilesystemTargetKey],
    ).toBe('term-222222222222222222222')
  })

  test('syncs a routed static tab after the branch projection appears', async () => {
    const branchName = 'feature/cold-route'

    render(
      <VueQueryClientScope client={appQueryClient}>
        <AppNavigationProvider value={navigationWithStore()}>
          <TerminalSessionCommandScope value={terminalCommandContext}>
            <TerminalSessionReadScope value={terminalReadContext}>
              <WorkspacePane
                workspaceId={REPO_ID}
                currentBranchName={branchName}
                workspacePaneRouteContext={{ kind: 'routed', route: { kind: 'static', tab: 'history' } }}
              />
            </TerminalSessionReadScope>
          </TerminalSessionCommandScope>
        </AppNavigationProvider>
      </VueQueryClientScope>,
    )

    await flushTestUpdates(() => {
      seedRepoWithReadModelForTest({
        id: REPO_ID,
        branchSnapshots: [createBranchSnapshot(branchName)],
        currentBranchName: branchName,
        preferredWorkspacePaneTab: 'status',
        workspacePaneTabsByBranch: {
          [branchName]: [workspacePaneStaticTabEntry('status'), workspacePaneStaticTabEntry('history')],
        },
      })
    })

    await waitFor(() => {
      const repo = workspacesStore.getState().workspaces[REPO_ID]
      expect(
        repo &&
          preferredWorkspacePaneTabForTarget(repo.ui, {
            kind: 'git-branch' as const,
            workspaceId: REPO_ID,
            branchName,
          }),
      ).toBe('history')
    })
  })

  test('syncs a routed bare branch as an empty workspace pane preference', async () => {
    const branchName = 'feature/empty-route'
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [createBranchSnapshot(branchName)],
      currentBranchName: branchName,
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: {
        [branchName]: [workspacePaneStaticTabEntry('status'), workspacePaneStaticTabEntry('history')],
      },
    })

    render(
      <VueQueryClientScope client={appQueryClient}>
        <AppNavigationProvider value={navigationWithStore()}>
          <TerminalSessionCommandScope value={terminalCommandContext}>
            <TerminalSessionReadScope value={terminalReadContext}>
              <WorkspacePane
                workspaceId={REPO_ID}
                currentBranchName={branchName}
                workspacePaneRouteContext={{ kind: 'routed', route: null }}
              />
            </TerminalSessionReadScope>
          </TerminalSessionCommandScope>
        </AppNavigationProvider>
      </VueQueryClientScope>,
    )

    await waitFor(() => {
      const repo = workspacesStore.getState().workspaces[REPO_ID]
      expect(
        repo &&
          preferredWorkspacePaneTabForTarget(repo.ui, {
            kind: 'git-branch' as const,
            workspaceId: REPO_ID,
            branchName,
          }),
      ).toBeNull()
    })
  })

  test('uses the persisted workspace pane tab when the pane has no active route context', async () => {
    const branchName = 'feature/inactive-route'
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [
        createBranchSnapshot(branchName, {
          worktree: { path: '/tmp/repo-workspace-inactive-worktree', isPrimary: false, isLocked: false },
        }),
      ],
      currentBranchName: branchName,
      preferredWorkspacePaneTab: 'files',
      workspacePaneTabsByBranch: {
        [branchName]: [workspacePaneStaticTabEntry('status'), workspacePaneStaticTabEntry('files')],
      },
    })
    const route = routeNavigation()

    const { container } = render(
      <VueQueryClientScope client={appQueryClient}>
        <AppNavigationProvider value={navigationWithStore(route)}>
          <TerminalSessionCommandScope value={terminalCommandContext}>
            <TerminalSessionReadScope value={terminalReadContext}>
              <WorkspacePane
                workspaceId={REPO_ID}
                currentBranchName={branchName}
                workspacePaneRouteContext={{ kind: 'inactive' }}
              />
            </TerminalSessionReadScope>
          </TerminalSessionCommandScope>
        </AppNavigationProvider>
      </VueQueryClientScope>,
    )

    expect(container.textContent).not.toContain('workspace-pane-tabs.empty')
    expect(container.querySelector('[id$="-files-panel"]')).not.toBeNull()
    expect(route.openRepoBranch).not.toHaveBeenCalled()
  })

  test('defers stale static route replacement while active tab close is pending', async () => {
    const branchName = 'feature/close-route-race'
    const worktreePath = '/tmp/close-route-race-worktree'
    const route = routeNavigation()
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [
        createBranchSnapshot(branchName, { worktree: { path: worktreePath, isPrimary: false, isLocked: false } }),
      ],
      currentBranchName: branchName,
      preferredWorkspacePaneTab: 'files',
      workspacePaneTabsByBranch: {
        [branchName]: [workspacePaneStaticTabEntry('status'), workspacePaneStaticTabEntry('files')],
      },
      status: [{ path: worktreePath, branch: branchName, isMain: false, entries: [] }],
    })
    const actions = navigationWithStore(route)
    let resolveCommit!: (tabs: Array<ReturnType<typeof workspacePaneStaticTabEntry>>) => void
    let resolveCommitStarted!: () => void
    const commitStarted = new Promise<void>((resolve) => {
      resolveCommitStarted = resolve
    })
    installWorkspacePaneTabsTestBridge({
      updateWorkspaceTabs: () => {
        resolveCommitStarted()
        return new Promise((resolve) => {
          resolveCommit = resolve
        })
      },
    })

    render(
      <VueQueryClientScope client={appQueryClient}>
        <AppNavigationProvider value={actions}>
          <TerminalSessionCommandScope value={terminalCommandContext}>
            <TerminalSessionReadScope value={terminalReadContext}>
              <WorkspacePane
                workspaceId={REPO_ID}
                currentBranchName={branchName}
                workspacePaneRouteContext={{ kind: 'routed', route: { kind: 'static', tab: 'files' } }}
              />
            </TerminalSessionReadScope>
          </TerminalSessionCommandScope>
        </AppNavigationProvider>
      </VueQueryClientScope>,
    )
    const filesHistoryEntry = {
      workspaceId: REPO_ID,
      route: {
        kind: 'branch' as const,
        branchName,
        workspacePaneTab: 'files' as const,
        terminalFilesystemTargetKey: formatTerminalFilesystemTargetKeyForPath(REPO_ID, worktreePath),
        terminalSessionId: null,
      },
    }
    await waitFor(() => {
      expect(workspacesStore.getState().navigationHistoryByWorkspace[REPO_ID]?.current).toEqual(filesHistoryEntry)
    })
    vi.mocked(route.openRepoBranch).mockClear()
    vi.mocked(route.openRepoBranchTab).mockClear()

    const closePromise = runCloseWorkspacePaneTabCommand({
      workspaceId: REPO_ID,
      target: {
        routeTarget: { kind: 'git-branch', workspaceId: REPO_ID, branchName },
        workspacePaneRoute: { kind: 'static', tab: 'files' },
        filesystemTarget: gitWorktreeFilesystemTarget(repo, worktreePath, branchName),
      },
      navigation: actions,
    })
    await commitStarted

    await flushTestUpdates(() => {
      setWorkspacePaneTabsForTargetQueryData({
        workspaceId: REPO_ID,
        workspaceRuntimeId: repo.workspaceRuntimeId,
        branchName,
        worktreePath,
        tabs: [workspacePaneStaticTabEntry('status')],
      })
    })
    await waitForNextMacrotask()

    expect(route.openRepoBranch).not.toHaveBeenCalled()
    expect(route.openRepoBranchTab).not.toHaveBeenCalled()
    expect(workspacesStore.getState().navigationHistoryByWorkspace[REPO_ID]?.current).toEqual(filesHistoryEntry)

    resolveCommit([workspacePaneStaticTabEntry('status')])

    await expect(closePromise).resolves.toBe(true)
    expect(route.openRepoBranchTab).toHaveBeenCalledWith(REPO_ID, branchName, 'status', presentationOptions())
  })

  test('renders an unrenderable static URL as an empty pane without navigating', async () => {
    const branchName = 'feature/no-worktree'
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [createBranchSnapshot(branchName)],
      currentBranchName: branchName,
      preferredWorkspacePaneTab: 'changes',
      workspacePaneTabsByBranch: {
        [branchName]: [workspacePaneStaticTabEntry('status')],
      },
    })
    const route = routeNavigation()

    const { container } = render(
      <VueQueryClientScope client={appQueryClient}>
        <AppNavigationProvider value={navigationWithStore(route)}>
          <TerminalSessionCommandScope value={terminalCommandContext}>
            <TerminalSessionReadScope value={terminalReadContext}>
              <WorkspacePane
                workspaceId={REPO_ID}
                currentBranchName={branchName}
                workspacePaneRouteContext={{ kind: 'routed', route: { kind: 'static', tab: 'changes' } }}
              />
            </TerminalSessionReadScope>
          </TerminalSessionCommandScope>
        </AppNavigationProvider>
      </VueQueryClientScope>,
    )

    expect(container.textContent).toContain('workspace-pane-tabs.empty')
    expect(route.openRepoBranch).not.toHaveBeenCalled()
    expect(route.openRepoBranchTab).not.toHaveBeenCalled()
    expect(workspacesStore.getState().navigationHistoryByWorkspace[REPO_ID]).toBeUndefined()
    const repo = workspacesStore.getState().workspaces[REPO_ID]
    expect(
      repo &&
        preferredWorkspacePaneTabForTarget(repo.ui, {
          kind: 'git-branch' as const,
          workspaceId: REPO_ID,
          branchName,
        }),
    ).toBe('changes')
  })
})
