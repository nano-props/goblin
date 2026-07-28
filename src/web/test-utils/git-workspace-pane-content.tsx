import type { ComponentProps } from 'react'
import { resetWorkspacesStore } from '#/web/test-utils/repo-store.ts'
import { act } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, vi } from 'vitest'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { GitWorkspacePaneContent } from '#/web/components/repo-workspace/GitWorkspacePaneContent.tsx'
import { gitWorktreePaneFilesystemTarget } from '#/web/workspace-pane/workspace-pane-filesystem-target.ts'
import {
  getCurrentGitWorkspacePanePresentation as buildGitWorkspacePanePresentation,
  type GitWorkspacePaneProjection,
} from '#/web/components/repo-workspace/model.ts'
import { useGitWorkspacePaneTabModel } from '#/web/workspace-pane/use-workspace-pane-tab-model.ts'
import { readRepoBranchQueryProjection } from '#/web/repo-branch-read-model.ts'
import type { BranchCopyPatchAction } from '#/web/hooks/branch-action-state.ts'
import {
  useTerminalSessionReadContext,
  EMPTY_TERMINAL_SNAPSHOT,
  EMPTY_TERMINAL_FILESYSTEM_TARGET_SNAPSHOT,
} from '#/web/components/terminal/terminal-session-context.ts'
import type {
  TerminalSessionContextValue,
  TerminalSessionSummary,
  TerminalSessionReadContextValue,
  TerminalFilesystemTargetSnapshot,
} from '#/web/components/terminal/types.ts'
import { installWorkspacePaneTabsTestBridge } from '#/web/test-utils/workspace-pane-bridge.ts'
import { setClientBridgeForTests } from '#/web/client-bridge.ts'
import { useTerminalProjectionHydrationStore } from '#/web/stores/terminal-projection-hydration.ts'
import type { WorkspacePaneStaticTabType, WorkspacePaneTabType } from '#/shared/workspace-pane.ts'
import {
  isWorkspacePaneStaticTabType,
  workspacePaneStaticTabEntry,
  workspacePaneRuntimeTabEntry,
} from '#/shared/workspace-pane.ts'
import type { WorkspacePaneRoute } from '#/web/App.tsx'
import {
  observedPrimaryWindowNavigationActionsForTest,
  type PrimaryWindowNavigationOverridesForTest,
} from '#/web/test-utils/workspace-pane-navigation.ts'
import { formatTerminalFilesystemTargetKeyForPath } from '#/shared/terminal-filesystem-target-key.ts'
import { preferredWorkspacePaneTabForTarget } from '#/web/stores/workspaces/workspace-pane-preferences.ts'
import {
  workspacePanePreferenceTargetOptions,
  workspacePaneTabTargetForBranch,
} from '#/web/workspace-pane/workspace-pane-tab-target.ts'
import { terminalSessionContextForTest } from '#/web/test-utils/terminal-session-context.ts'
import type { PrimaryWindowNavigationActions } from '#/web/primary-window-navigation.tsx'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import type { WorkspaceState } from '#/web/stores/workspaces/types.ts'

// RTL has no reusable harness for Git content routing, query state, and terminal/filesystem contexts.
export let workspacePaneTabsTestBridge: ReturnType<typeof installWorkspacePaneTabsTestBridge>

const hoistedRepoClientMocks = vi.hoisted(() => ({
  getRepoLog: vi.fn(),
  openRepoUrl: vi.fn(),
}))
const hoistedFiletreeClientMocks = vi.hoisted(() => ({
  getWorkspaceFilesystemTree: vi.fn(),
  getWorkspaceFileViewer: vi.fn(),
}))
const hoistedResponsiveMocks = vi.hoisted(() => ({ compact: false }))
vi.mock('#/web/hooks/useResponsiveUiMode.tsx', () => ({
  useIsCompactUi: () => hoistedResponsiveMocks.compact,
}))
vi.mock('#/web/repo-client.ts', () => ({
  getRepoLog: hoistedRepoClientMocks.getRepoLog,
  openRepoUrl: hoistedRepoClientMocks.openRepoUrl,
}))
vi.mock('#/web/workspace-filesystem-client.ts', () => ({
  getWorkspaceFilesystemTree: hoistedFiletreeClientMocks.getWorkspaceFilesystemTree,
  getWorkspaceFileViewer: hoistedFiletreeClientMocks.getWorkspaceFileViewer,
}))
export const REPO_ID = workspaceIdForTest('goblin+file:///tmp/goblin-repo-workspace-content-repo')

type GitWorkspacePaneContentHarnessProps = Omit<
  ComponentProps<typeof GitWorkspacePaneContent>,
  'workspacePaneTabModel'
> & {
  workspacePaneRouteMode?: 'preference-route' | 'bare-branch'
}

export function GitWorkspacePaneContentHarness(props: GitWorkspacePaneContentHarnessProps) {
  return (
    <QueryClientProvider client={primaryWindowQueryClient}>
      <GitWorkspacePaneContentInner {...props} />
    </QueryClientProvider>
  )
}

function GitWorkspacePaneContentInner(props: GitWorkspacePaneContentHarnessProps) {
  const { workspacePaneRouteMode, ...contentProps } = props
  const workspacePaneRoute = useHarnessWorkspacePaneRoute(props)
  const workspacePaneTabModel = useGitWorkspacePaneTabModel(contentProps.repo, contentProps.detail, workspacePaneRoute)
  return <GitWorkspacePaneContent {...contentProps} workspacePaneTabModel={workspacePaneTabModel} />
}

function useHarnessWorkspacePaneRoute(
  props: GitWorkspacePaneContentHarnessProps,
): WorkspacePaneRoute | null | undefined {
  if (props.workspacePaneRouteMode === 'bare-branch') return null
  const branch = props.detail.branch
  const preferredTab = preferredWorkspacePaneTabForTarget(
    props.repo.ui,
    branch
      ? branch.worktree?.path
        ? {
            kind: 'git-worktree' as const,
            workspaceId: props.repo.id,
            worktreePath: branch.worktree.path,
          }
        : { kind: 'git-branch' as const, workspaceId: props.repo.id, branchName: branch.name }
      : null,
  )
  const readContext = useTerminalSessionReadContext()
  if (preferredTab === 'terminal') {
    const terminalFilesystemTargetKey = branch?.worktree?.path
      ? formatTerminalFilesystemTargetKeyForPath(props.repo.id, branch.worktree.path)
      : null
    const terminalFilesystemTargetSnapshot = terminalFilesystemTargetKey
      ? readContext.terminalFilesystemTargetSnapshot(terminalFilesystemTargetKey)
      : null
    return {
      kind: 'terminal',
      terminalSessionId:
        terminalFilesystemTargetSnapshot?.selectedDescriptor?.terminalSessionId ??
        terminalFilesystemTargetSnapshot?.sessions.find((session) => session.selected)?.terminalSessionId ??
        terminalFilesystemTargetSnapshot?.sessions[0]?.terminalSessionId ??
        'pending-terminal',
    }
  }
  return workspacePaneRouteForStaticPreferredTab(preferredTab)
}

function workspacePaneRouteForStaticPreferredTab(tab: WorkspacePaneTabType | null): WorkspacePaneRoute | null {
  return isWorkspacePaneStaticTabType(tab) ? { kind: 'static', tab } : null
}

export function getTestGitWorkspacePanePresentation(repo: GitWorkspacePaneProjection) {
  return buildGitWorkspacePanePresentation(repo, { loading: false, error: null, stale: false })
}

export function gitWorkspacePaneProjection(repo: WorkspaceState): GitWorkspacePaneProjection {
  if (repo.capability.kind !== 'git') throw new Error('expected Git workspace fixture')
  const branchModel = readRepoBranchQueryProjection(repo)
  if (!branchModel) throw new Error('missing branch read model')
  const currentBranchName = branchModel.currentBranch || branchModel.branches[0]?.name || null
  return {
    ...repo,
    ui: { ...repo.ui, currentBranchName },
    branchAction: repo.capability.git.operations.branchAction,
    branchModel,
    probe: repo.capability.probe,
    remote: repo.capability.git.remote,
    remoteLifecycle: repo.admission.kind === 'remote' ? repo.admission.lifecycle : null,
  }
}

export function preferenceBackedWorkspacePaneTabModel(repoId: WorkspaceId, branchName: string) {
  const model = workspacePaneTabTargetForBranch(repoId, branchName, workspacePanePreferenceTargetOptions)
  if (!model) throw new Error('missing preference-backed workspace pane tab model')
  return model
}

beforeEach(() => {
  hoistedResponsiveMocks.compact = false
  primaryWindowQueryClient.clear()
  resetWorkspacesStore()
  workspacePaneTabsTestBridge = installWorkspacePaneTabsTestBridge()
  useTerminalProjectionHydrationStore.setState({
    hydrationByWorkspace: new Map(),
    lastSuccessfulRecoveryByWorkspace: new Map(),
  })
  hoistedRepoClientMocks.getRepoLog.mockResolvedValue([])
  hoistedRepoClientMocks.openRepoUrl.mockResolvedValue({ ok: true, message: '' })
  hoistedFiletreeClientMocks.getWorkspaceFilesystemTree.mockResolvedValue({ nodes: [], truncated: false })
  hoistedFiletreeClientMocks.getWorkspaceFileViewer.mockResolvedValue({
    viewer: 'bat',
    shell: 'posix',
    executionRoot: '/tmp/repo',
  })
})

afterEach(() => {
  setClientBridgeForTests(null)
})

export const repoClientMocks = hoistedRepoClientMocks
export const filetreeClientMocks = hoistedFiletreeClientMocks
export const responsiveMocks = hoistedResponsiveMocks

export function branchActionSurfaceWithCopyPatch(
  copyPatchAction: Pick<BranchCopyPatchAction, 'label' | 'title' | 'disabled' | 'visible' | 'onSelect'>,
) {
  return {
    mainItems: [],
    destructiveItems: [],
    copyPatchAction,
  }
}

export function defaultBranchActionSurface() {
  return branchActionSurfaceWithCopyPatch({
    label: 'status.copy-patch',
    title: 'status.copy-patch-title',
    disabled: false,
    visible: false,
    onSelect: () => false,
  })
}

export const emptyWorktreeSnapshot = EMPTY_TERMINAL_FILESYSTEM_TARGET_SNAPSHOT
const emptyTerminalSnapshot = EMPTY_TERMINAL_SNAPSHOT

export const emptyTerminalReadContext: TerminalSessionReadContextValue = {
  terminalFilesystemTargetSnapshot: () => emptyWorktreeSnapshot,
  subscribeTerminalFilesystemTarget: () => () => {},
  workspaceBellCount: () => 0,
  subscribeWorkspaceBellCount: () => () => {},
  snapshot: () => emptyTerminalSnapshot,
  subscribeSnapshot: () => () => {},
}

export function gitWorktreeFilesystemTarget(repo: WorkspaceState, rootPath: string, branchName: string) {
  if (repo.capability.kind !== 'git') throw new Error('expected Git workspace fixture')
  return gitWorktreePaneFilesystemTarget({
    workspaceId: repo.id,
    workspaceRuntimeId: repo.workspaceRuntimeId,
    worktreePath: rootPath,
    head: { kind: 'branch', branchName },
    capabilities: repo.capability.probe.capabilities,
  })
}

export function terminalCommandContextWith(
  overrides: Partial<TerminalSessionContextValue> = {},
): TerminalSessionContextValue {
  return terminalSessionContextForTest({
    createTerminal: vi.fn(async () => 'term-111111111111111111111'),
    selectTerminal: vi.fn(),
    scrollToBottom: vi.fn(),
    scrollLines: vi.fn(),
    clearBell: vi.fn(() => false),
    closeTerminalByDescriptor: vi.fn(async () => true),
    attach: vi.fn(),
    detach: vi.fn(),
    restart: vi.fn(),
    findNext: vi.fn(() => ({ resultIndex: -1, resultCount: 0, found: false })),
    findPrevious: vi.fn(() => ({ resultIndex: -1, resultCount: 0, found: false })),
    clearSearch: vi.fn(),
    takeover: vi.fn(async () => true),
    focusTerminal: vi.fn(),
    ...overrides,
  })
}

export async function flushAsyncWork() {
  await act(async () => {
    await Promise.resolve()
  })
}

export function staticEntry(type: WorkspacePaneStaticTabType) {
  return workspacePaneStaticTabEntry(type)
}

export function terminalEntry(id: string) {
  return workspacePaneRuntimeTabEntry('terminal', id)
}

export function navigationWith(overrides: PrimaryWindowNavigationOverridesForTest): PrimaryWindowNavigationActions {
  return observedPrimaryWindowNavigationActionsForTest({
    activateWorkspace: () => {},
    closeWorkspace: async () => ({ ok: true }),
    cycleWorkspace: () => {},
    selectRepoBranch: () => true,
    showRepoBranchEmptyWorkspacePane: () => true,
    showRepoBranchWorkspacePaneTab: () => true,
    showRepoBranchTerminalSession: () => true,
    goBack: () => {},
    goForward: () => {},
    openSettings: () => {},
    openCreateWorktree: () => {},
    ...overrides,
  })
}

export function terminalSession(
  terminalSessionId: string,
  index: number,
  selected: boolean,
  terminalFilesystemTargetKey: string,
): TerminalSessionSummary {
  return {
    type: 'terminal',
    terminalSessionId,
    terminalFilesystemTargetKey,
    index,
    title: terminalSessionId,
    phase: 'open',
    selected,
    hasBell: false,
    hasRecentOutput: false,
  }
}
