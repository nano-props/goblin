import {
  resetWorkspacesStore,
  seedRepoWithReadModelForTest,
  createBranchSnapshot,
} from '#/web/test-utils/repo-store.ts'
import { flushTestUpdates } from '#/test-utils/render.tsx'
import { defineComponent } from 'vue'
import type { VNode } from 'vue'
import type { ComponentProps } from 'vue-component-type-helpers'
import { QueryClient } from '@tanstack/vue-query'
import { VueQueryClientScope } from '#/web/test-utils/VueQueryClientScope.tsx'
import { afterEach, beforeEach, vi } from 'vitest'
import { waitForNextMacrotask } from '#/test-utils/microtasks.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { mockFetch } from '#/test-utils/fetch-mock.ts'
import { workspaceExternalAppRecentKey, workspaceExternalAppTargetForWorktree } from '#/shared/workspace-settings.ts'
import { GitWorkspacePaneToolbar } from '#/web/components/repo-workspace/GitWorkspacePaneToolbar.tsx'
import {
  WorkspaceExternalAppLauncher,
  useWorkspaceExternalAppItems,
} from '#/web/components/workspace-pane/WorkspaceExternalAppLauncher.tsx'
import {
  gitWorktreePaneFilesystemTarget,
  type WorkspacePaneFilesystemTarget,
} from '#/web/workspace-pane/workspace-pane-filesystem-target.ts'
import {
  getCurrentGitWorkspacePanePresentation as buildGitWorkspacePanePresentation,
  type GitWorkspacePaneProjection,
} from '#/web/components/repo-workspace/model.ts'
import { useGitWorkspacePaneTabModel } from '#/web/workspace-pane/use-workspace-pane-tab-model.ts'
import { formatTerminalFilesystemTargetKeyForPath } from '#/shared/terminal-filesystem-target-key.ts'
import {
  EMPTY_TERMINAL_SNAPSHOT,
  TerminalSessionCommandScope,
  TerminalSessionReadScope,
} from '#/web/components/terminal/terminal-session-context.ts'
import type {
  WorkspacePaneStaticTabType,
  WorkspacePaneTabEntry,
  WorkspacePaneTabType,
} from '#/shared/workspace-pane.ts'
import {
  isWorkspacePaneStaticTabType,
  workspacePaneStaticTabEntry,
  workspacePaneRuntimeTabEntry,
} from '#/shared/workspace-pane.ts'
import type {
  TerminalSessionContextValue,
  TerminalSessionReadContextValue,
  TerminalSessionSummary,
  TerminalDescriptor,
  TerminalFilesystemTargetSnapshot,
} from '#/web/components/terminal/types.ts'
import type { AppNavigationActions } from '#/web/app-navigation-actions.ts'
import { AppNavigationProvider } from '#/web/app-navigation.tsx'
import { setClientBridgeForTests } from '#/web/client-bridge.ts'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'
import { terminalProjectionHydrationStore } from '#/web/stores/terminal-projection-hydration.ts'
import type { WorkspacePaneRoute } from '#/web/App.tsx'
import {
  terminalExecutionPath,
  terminalPresentationBranch,
  terminalSessionCoordinates,
  type TerminalSessionBase,
} from '#/shared/terminal-types.ts'
import { canonicalWorkspaceLocator } from '#/shared/workspace-locator.ts'
import { hostInfoStore } from '#/web/stores/host-info.ts'
import { installWorkspacePaneTabsTestBridge } from '#/web/test-utils/workspace-pane-bridge.ts'
import type { WorkspaceState } from '#/web/stores/workspaces/types.ts'
import type { RepoRemoteInfo } from '#/shared/git-types.ts'
import { workspacePaneTabsTargetForRepoBranch } from '#/web/stores/workspaces/workspace-pane-preferences.ts'
import { getRepoSnapshotQueryData, getRepoWorktreeStatusQueryData } from '#/web/repo-query-cache.ts'
import { readWorkspacePaneTabsForTarget } from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import { setWorkspacePaneTabsForTargetQueryData } from '#/web/test-utils/workspace-pane-tabs.ts'
import { workspacePaneStaticTabsFromEntries } from '#/web/workspace-pane/workspace-pane-tabs.ts'
import { setTerminalSessionCommandBridge } from '#/web/components/terminal/terminal-session-command-bridge.ts'
import { renderInJsdom as renderInJsdomWithoutWorkspaceView } from '#/test-utils/render.tsx'
import { WorkspacePaneTabStripScrollMemoryProvider } from '#/web/components/workspace-pane/workspace-pane-tab-strip-scroll-memory.tsx'
import { terminalSessionContextWithCreatedAdmissionForTest } from '#/web/test-utils/terminal-session-context.ts'
import { defaultSettingsSnapshot } from '#/shared/settings-defaults.ts'
import { settingsSnapshotQueryKey } from '#/web/settings-query-cache.ts'
import type { WorkspaceSettingsEntry } from '#/shared/workspace-settings.ts'
import {
  observeWorkspacePaneRouteForTest,
  observedAppNavigationActionsForTest,
  seedInitialObservedWorkspacePaneRouteForTest,
  type ObservedBranchRouteNavigationForTest,
  type ObservedAppNavigationActionsForTest,
  type AppNavigationOverridesForTest,
} from '#/web/test-utils/workspace-pane-navigation.ts'

// RTL has no reusable harness for Git toolbar routing, tab state, and external-app settings.
const hoistedToolbarResponsiveMocks = vi.hoisted(() => ({ compactUi: false }))
const hoistedRuntimeExternalAppSettings = vi.hoisted(() => ({
  value: {
    terminalAvailable: true,
    terminalAppAvailability: { ghostty: true, terminal: true, windowsTerminal: false },
    editorAvailable: true,
    editorAppAvailability: { vscode: true },
  },
}))
const hoistedAppShellMocks = vi.hoisted(() => ({
  openExternalUrl: vi.fn(),
}))
const hoistedWorkspaceExternalAppMocks = vi.hoisted(() => ({
  openWorkspaceTerminal: vi.fn(async () => ({ ok: true, message: '' })),
  openWorkspaceEditor: vi.fn(async () => ({ ok: true, message: '' })),
  openWorkspaceInFinder: vi.fn(async () => ({ ok: true, message: '' })),
}))
const hoistedToastMocks = vi.hoisted(() => ({
  error: vi.fn(),
  warning: vi.fn(),
}))

export const toolbarResponsiveMocks = hoistedToolbarResponsiveMocks
export const runtimeExternalAppSettings = hoistedRuntimeExternalAppSettings
const appShellMocks = hoistedAppShellMocks
export const workspaceExternalAppMocks = hoistedWorkspaceExternalAppMocks
export const toastMocks = hoistedToastMocks
let workspacePaneTabsTestBridge: ReturnType<typeof installWorkspacePaneTabsTestBridge>

vi.mock('#/web/hooks/useResponsiveUiMode.tsx', () => ({
  useIsCompactUi: () => ({
    get value() {
      return hoistedToolbarResponsiveMocks.compactUi
    },
  }),
}))

vi.mock('#/web/runtime-settings-external-apps.ts', () => ({
  useExternalAppSettings: () => ({
    get value() {
      return hoistedRuntimeExternalAppSettings.value
    },
  }),
}))

vi.mock('#/web/app-shell-client.ts', () => ({
  openExternalUrl: hoistedAppShellMocks.openExternalUrl,
}))

vi.mock('#/web/workspace-external-app-client.ts', () => ({
  openWorkspaceTerminal: hoistedWorkspaceExternalAppMocks.openWorkspaceTerminal,
  openWorkspaceEditor: hoistedWorkspaceExternalAppMocks.openWorkspaceEditor,
  openWorkspaceInFinder: hoistedWorkspaceExternalAppMocks.openWorkspaceInFinder,
}))

vi.stubGlobal('requestAnimationFrame', ((cb: FrameRequestCallback) => {
  cb(0)
  return 1
}) as typeof requestAnimationFrame)

vi.mock('vue-sonner', () => ({
  toast: {
    error: hoistedToastMocks.error,
    warning: hoistedToastMocks.warning,
  },
}))

export const REPO_ID = workspaceIdForTest('goblin+file:///workspace')
export const WORKTREE_PATH = '/tmp/goblin-repo-workspace-toolbar-worktree'
toolbarResponsiveMocks.compactUi = false

export function renderInJsdom(element: VNode) {
  return renderInJsdomWithoutWorkspaceView(element, { wrapper: WorkspacePaneTabStripScrollMemoryProvider })
}

export function defaultRuntimeExternalAppSettings() {
  return {
    terminalAvailable: true,
    terminalAppAvailability: { ghostty: true, terminal: true, windowsTerminal: false },
    editorAvailable: true,
    editorAppAvailability: { vscode: true },
  }
}

type GitWorkspacePaneToolbarHarnessProps = Omit<
  ComponentProps<typeof GitWorkspacePaneToolbar>,
  'workspacePaneTabModel'
> & { workspacePaneRoute: WorkspacePaneRoute | null | undefined }

const GitWorkspacePaneToolbarHarness = defineComponent<GitWorkspacePaneToolbarHarnessProps>({
  name: 'GitWorkspacePaneToolbarHarness',
  props: ['repo', 'detail', 'workspacePaneId', 'workspacePaneRoute', 'trafficLightOffset', 'onBackToBranchNavigator'],

  setup(props) {
    const workspacePaneTabModel = useGitWorkspacePaneTabModel(
      () => props.repo,
      () => props.detail,
      () => props.workspacePaneRoute,
    )
    return () => (
      <GitWorkspacePaneToolbar
        repo={props.repo}
        detail={props.detail}
        workspacePaneId={props.workspacePaneId}
        workspacePaneRoute={props.workspacePaneRoute}
        workspacePaneTabModel={workspacePaneTabModel.value}
        trafficLightOffset={props.trafficLightOffset}
        onBackToBranchNavigator={props.onBackToBranchNavigator}
      />
    )
  },
})

function getTestGitWorkspacePanePresentation(repo: GitWorkspacePaneProjection) {
  return buildGitWorkspacePanePresentation(repo, { loading: false, error: null, stale: false }, undefined, {
    state: 'empty',
    stale: false,
    error: null,
    retrying: false,
    retry: () => {},
  })
}

export function gitWorkspacePaneProjection(repo: WorkspaceState): GitWorkspacePaneProjection {
  if (repo.capability.kind !== 'git') throw new Error('expected Git workspace fixture')
  const snapshot = getRepoSnapshotQueryData(repo.id, repo.workspaceRuntimeId)
  if (!snapshot) throw new Error('missing repository snapshot')
  return {
    ...repo,
    ui: { ...repo.ui, currentBranchName: snapshot.branches[0]?.name ?? null },
    branchAction: repo.capability.git.operations.branchAction,
    snapshot,
    status: getRepoWorktreeStatusQueryData(repo.id, repo.workspaceRuntimeId)?.status,
    probe: repo.capability.probe,
    remoteLifecycle: repo.admission.kind === 'remote' ? repo.admission.lifecycle : null,
  }
}

beforeEach(() => {
  toolbarResponsiveMocks.compactUi = false
  runtimeExternalAppSettings.value = defaultRuntimeExternalAppSettings()
  appShellMocks.openExternalUrl.mockReset()
  workspaceExternalAppMocks.openWorkspaceTerminal.mockReset()
  workspaceExternalAppMocks.openWorkspaceTerminal.mockImplementation(async () => ({ ok: true, message: '' }))
  workspaceExternalAppMocks.openWorkspaceEditor.mockReset()
  workspaceExternalAppMocks.openWorkspaceEditor.mockImplementation(async () => ({ ok: true, message: '' }))
  workspaceExternalAppMocks.openWorkspaceInFinder.mockReset()
  workspaceExternalAppMocks.openWorkspaceInFinder.mockImplementation(async () => ({ ok: true, message: '' }))
  hostInfoStore.setState({
    snapshot: { homeDir: '/Users/tester', platform: 'darwin', hostname: 'test-host', pid: 1 },
    status: 'ready',
    error: null,
  })
  resetWorkspacesStore()
  workspacePaneTabsTestBridge = installWorkspacePaneTabsTestBridge()
  // T6.1: the toolbar reads `isInitialSyncInFlight` from
  // terminalProjectionHydrationStore; existing tests assume the repo has been
  // synced. Mark ready by default so the "+ New" button renders; the
  // loading-state test skips this and expects the same button to be busy.
  terminalProjectionHydrationStore.setState({
    hydrationByWorkspace: new Map(),
    lastSuccessfulRecoveryByWorkspace: new Map(),
  })
})

afterEach(() => {
  toastMocks.error.mockClear()
  toastMocks.warning.mockClear()
  appShellMocks.openExternalUrl.mockReset()
  workspaceExternalAppMocks.openWorkspaceInFinder.mockReset()
  hostInfoStore.setState({
    snapshot: { homeDir: '/Users/tester', platform: 'darwin', hostname: 'test-host', pid: 1 },
    status: 'ready',
    error: null,
  })
  setClientBridgeForTests(null)
  setTerminalSessionCommandBridge(null)
})

export const WorkspaceExternalAppLauncherHarness = defineComponent<{ target: WorkspacePaneFilesystemTarget }>({
  name: 'WorkspaceExternalAppLauncherHarness',
  props: ['target'],
  setup(props) {
    const items = useWorkspaceExternalAppItems(() => props.target)
    return () =>
      items.value.length > 0 ? <WorkspaceExternalAppLauncher target={props.target} items={items.value} /> : null
  },
})

export function renderToolbar(options: {
  terminalCount: number
  changeCount?: number
  navigation: ObservedAppNavigationActionsForTest
  preferredWorkspacePaneTab?: WorkspacePaneTabType
  workspacePaneStaticTabs?: WorkspacePaneStaticTabType[]
  workspacePaneTabs?: WorkspacePaneTabEntry[]
  worktree?: boolean
  collapsed?: boolean
  createPending?: boolean
  trafficLightOffset?: boolean
  remote?: Partial<RepoRemoteInfo>
  workspaceRuntimeId?: string
  /**
   * When true, do NOT mark the repo ready before mounting. The toolbar
   * reads `isInitialSyncInFlight` from the store and renders the
   * New Terminal button in a busy state.
   */
  loading?: boolean
  /**
   * Pre-seed the settings snapshot's `workspaceSettings` field so the
   * workspace external app launcher reads from server-backed state
   * without an HTTP round trip. Defaults to an empty array.
   */
  seedWorkspaceSettings?: WorkspaceSettingsEntry[]
}): {
  container: HTMLElement
  terminalTab: HTMLButtonElement
  rerender: ReturnType<typeof renderInJsdom>['rerender']
  rerenderWorktreePath: (worktreePath: string) => void
  queryClient: QueryClient
  mocks: {
    createTerminal: ReturnType<typeof vi.fn>
    selectTerminal: ReturnType<typeof vi.fn>
    scrollToBottom: ReturnType<typeof vi.fn>
    closeTerminalByDescriptor: ReturnType<typeof vi.fn>
    showRepoBranchWorkspacePaneTab: ReturnType<typeof vi.fn>
    showRepoBranchTerminalSession: ReturnType<typeof vi.fn>
  }
} {
  const branchName = options.worktree === false ? 'feature/no-worktree' : 'feature/worktree'
  const branch = createBranchSnapshot(
    branchName,
    options.worktree === false ? {} : { worktree: { path: WORKTREE_PATH, isPrimary: false, isLocked: false } },
  )
  const repo = seedRepoWithReadModelForTest({
    id: REPO_ID,
    workspaceRuntimeId: options.workspaceRuntimeId,
    branchSnapshots: [branch],
    currentBranchName: branchName,
    preferredWorkspacePaneTab: options.preferredWorkspacePaneTab ?? 'status',
    workspacePaneTabsByBranch:
      options.workspacePaneTabs || options.workspacePaneStaticTabs
        ? {
            [branchName]:
              options.workspacePaneTabs ?? options.workspacePaneStaticTabs?.map((type) => staticEntry(type)) ?? [],
          }
        : undefined,
    status:
      options.changeCount && options.changeCount > 0
        ? [
            {
              path: WORKTREE_PATH,
              branch: branchName,
              isMain: false,
              entries: Array.from({ length: options.changeCount }, (_, index) => ({
                x: 'M',
                y: ' ',
                path: `src/file-${index}.ts`,
              })),
            },
          ]
        : [],
    remote: options.remote,
  })
  // Mark the repo as already-synced so the toolbar renders the normal
  // "+ New" button. Loading-state tests pass `loading: true` to skip this.
  if (!options.loading) {
    terminalProjectionHydrationStore.getState().markProjectionReady(REPO_ID, repo.workspaceRuntimeId)
  }
  const detail = getTestGitWorkspacePanePresentation(gitWorkspacePaneProjection(repo))
  const sessions: TerminalSessionSummary[] = Array.from({ length: options.terminalCount }, (_, index) => ({
    type: 'terminal',
    terminalSessionId: `term-${String(index + 1).repeat(21)}`,
    terminalFilesystemTargetKey: formatTerminalFilesystemTargetKeyForPath(REPO_ID, WORKTREE_PATH),
    index: index + 1,
    title: `term-${index + 1}`,
    fullTitle: `full-term-${index + 1}`,
    phase: 'open' as const,
    selected: index === 0,
    hasBell: false,
    hasRecentOutput: false,
  }))
  const preferredWorkspacePaneTab = options.preferredWorkspacePaneTab ?? 'status'
  const workspacePaneRoute = workspacePaneRouteForPreferredTab(preferredWorkspacePaneTab, sessions)
  const selectedDescriptor: TerminalDescriptor | null = sessions[0]
    ? {
        terminalSessionId: sessions[0].terminalSessionId,
        index: sessions[0].index,
        target: {
          kind: 'git-worktree' as const,
          workspaceId: canonicalWorkspaceLocator(REPO_ID)!,
          workspaceRuntimeId: repo.workspaceRuntimeId,
          root: canonicalWorkspaceLocator(`goblin+file://${WORKTREE_PATH}`)!,
        },
        presentation: { kind: 'git-worktree' as const, head: { kind: 'branch' as const, branchName: branchName } },
      }
    : null
  const terminalFilesystemTargetSnapshot: TerminalFilesystemTargetSnapshot = {
    terminalFilesystemTargetKey: formatTerminalFilesystemTargetKeyForPath(REPO_ID, WORKTREE_PATH),
    selectedDescriptor,
    sessions,
    count: options.terminalCount,
    bellCount: sessions.filter((session) => session.hasBell).length,
    outputActiveCount: 0,
    createPending: options.createPending ?? false,
  }
  const terminalSnapshot = EMPTY_TERMINAL_SNAPSHOT
  const readContext: TerminalSessionReadContextValue = {
    terminalFilesystemTargetSnapshot: () => terminalFilesystemTargetSnapshot,
    subscribeTerminalFilesystemTarget: () => () => {},
    workspaceBellCount: () => 0,
    subscribeWorkspaceBellCount: () => () => {},
    workspaceTerminalSessions: () => [],
    subscribeWorkspaceTerminalSessions: () => () => {},
    snapshot: () => terminalSnapshot,
    subscribeSnapshot: () => () => {},
  }
  const createTerminal = vi.fn(async (base: TerminalSessionBase) => {
    const terminalSessionId = 'term-111111111111111111111'
    const coordinates = terminalSessionCoordinates(base)
    const branchName = terminalPresentationBranch(base.presentation)
    if (!branchName) throw new Error('expected Git worktree terminal fixture')
    workspacePaneTabsTestBridge.addRuntimeTab({
      workspaceId: coordinates.workspaceId,
      workspaceRuntimeId: coordinates.workspaceRuntimeId,
      branchName,
      worktreePath: terminalExecutionPath(base.target),
      terminalSessionId,
    })
    return terminalSessionId
  })
  const selectTerminal = vi.fn()
  const scrollToBottom = vi.fn()
  const closeTerminalByDescriptor = vi.fn(async () => ({ kind: 'committed' as const, projection: 'applied' as const }))
  const showRepoBranchWorkspacePaneTab = vi.fn(options.navigation.showRepoBranchWorkspacePaneTab)
  const showRepoBranchTerminalSession = vi.fn(options.navigation.showRepoBranchTerminalSession)
  const commandContext: TerminalSessionContextValue = terminalSessionContextWithCreatedAdmissionForTest({
    createTerminal,
    selectTerminal,
    scrollToBottom,
    clearBell: vi.fn(() => false),
    closeTerminalByDescriptor,
    attach: vi.fn(),
    detach: vi.fn(),
    restart: vi.fn(),
    findNext: vi.fn(() => ({ resultIndex: -1, resultCount: 0, found: false })),
    findPrevious: vi.fn(() => ({ resultIndex: -1, resultCount: 0, found: false })),
    clearSearch: vi.fn(),
    takeover: vi.fn(),
    focusTerminal: vi.fn(),
  })
  setTerminalSessionCommandBridge({
    terminalFilesystemTargetSnapshot: readContext.terminalFilesystemTargetSnapshot,
    createTerminal,
    createTerminalWithAdmission: commandContext.createTerminalWithAdmission,
    selectTerminal,
    focusTerminal: commandContext.focusTerminal,
    closeTerminalByDescriptor,
  })

  const queryClient = new QueryClient()
  const workspacePaneTabs = options.workspacePaneTabs ?? [
    ...(options.workspacePaneStaticTabs?.map((type) => staticEntry(type)) ?? [staticEntry('status')]),
    ...sessions.map((session) => terminalEntry(session.terminalSessionId)),
  ]
  if (workspacePaneTabs) {
    const workspaceRuntimeId = workspacesStore.getState().workspaces[REPO_ID]!.workspaceRuntimeId
    const workspacePaneTabsQueryInput = {
      workspaceId: REPO_ID,
      workspaceRuntimeId,
      branchName,
      worktreePath: options.worktree === false ? null : WORKTREE_PATH,
      tabs: workspacePaneTabs,
    }
    setWorkspacePaneTabsForTargetQueryData(workspacePaneTabsQueryInput)
    setWorkspacePaneTabsForTargetQueryData(workspacePaneTabsQueryInput, queryClient)
  }
  queryClient.setQueryData(
    settingsSnapshotQueryKey(),
    defaultSettingsSnapshot({ workspaceSettings: options.seedWorkspaceSettings ?? [] }),
  )
  const navigation = navigationWith({
    ...options.navigation,
    showRepoBranchWorkspacePaneTab,
    showRepoBranchTerminalSession,
  })
  const { container, rerender } = renderInJsdom(
    <VueQueryClientScope client={queryClient}>
      <AppNavigationProvider value={navigation}>
        <TerminalSessionCommandScope value={commandContext}>
          <TerminalSessionReadScope value={readContext}>
            <GitWorkspacePaneToolbarHarness
              repo={gitWorkspacePaneProjection(repo)}
              detail={detail}
              workspacePaneId="workspace"
              workspacePaneRoute={workspacePaneRoute}
              trafficLightOffset={options.trafficLightOffset}
            />
          </TerminalSessionReadScope>
        </TerminalSessionCommandScope>
      </AppNavigationProvider>
    </VueQueryClientScope>,
  )

  const rerenderWorktreePath = async (worktreePath: string) => {
    const nextBranch = createBranchSnapshot(branchName, {
      worktree: { path: worktreePath, isPrimary: false, isLocked: false },
    })
    const nextRepo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      workspaceRuntimeId: repo.workspaceRuntimeId,
      branchSnapshots: [nextBranch],
      currentBranchName: branchName,
      preferredWorkspacePaneTab,
    })
    const nextTabsInput = {
      workspaceId: REPO_ID,
      workspaceRuntimeId: repo.workspaceRuntimeId,
      branchName,
      worktreePath,
      tabs: workspacePaneTabs,
    }
    setWorkspacePaneTabsForTargetQueryData(nextTabsInput)
    setWorkspacePaneTabsForTargetQueryData(nextTabsInput, queryClient)
    observeWorkspacePaneRouteForTest({
      workspaceId: REPO_ID,
      workspaceRuntimeId: repo.workspaceRuntimeId,
      branchName,
      worktreePath,
      route: workspacePaneRoute,
    })
    await rerender(
      <VueQueryClientScope client={queryClient}>
        <AppNavigationProvider value={navigation}>
          <TerminalSessionCommandScope value={commandContext}>
            <TerminalSessionReadScope value={readContext}>
              <GitWorkspacePaneToolbarHarness
                repo={gitWorkspacePaneProjection(nextRepo)}
                detail={getTestGitWorkspacePanePresentation(gitWorkspacePaneProjection(nextRepo))}
                workspacePaneId="workspace"
                workspacePaneRoute={workspacePaneRoute}
                trafficLightOffset={options.trafficLightOffset}
              />
            </TerminalSessionReadScope>
          </TerminalSessionCommandScope>
        </AppNavigationProvider>
      </VueQueryClientScope>,
    )
  }

  const tabSelector =
    options.worktree === false
      ? '#workspace-status-tab'
      : options.terminalCount > 0
        ? '[data-workspace-pane-tab-tooltip-id="terminal:term-111111111111111111111"] button[role="tab"]'
        : 'button[aria-label="terminal.new"]'
  const tab = container.querySelector<HTMLButtonElement>(tabSelector)
  if (!tab && !options.loading && !options.createPending) throw new Error('missing terminal tab')
  return {
    container,
    terminalTab: tab as HTMLButtonElement,
    rerender,
    rerenderWorktreePath,
    queryClient,
    mocks: {
      createTerminal,
      selectTerminal,
      scrollToBottom,
      closeTerminalByDescriptor,
      showRepoBranchWorkspacePaneTab,
      showRepoBranchTerminalSession,
    },
  }
}

function workspacePaneRouteForPreferredTab(
  preferredTab: WorkspacePaneTabType,
  sessions: readonly TerminalSessionSummary[],
): WorkspacePaneRoute | null {
  if (preferredTab === 'terminal') {
    return { kind: 'terminal', terminalSessionId: sessions[0]?.terminalSessionId ?? 'pending-terminal' }
  }
  return isWorkspacePaneStaticTabType(preferredTab) ? { kind: 'static', tab: preferredTab } : null
}

export function navigationWith(overrides: AppNavigationOverridesForTest): ObservedAppNavigationActionsForTest {
  seedInitialObservedWorkspacePaneRouteForTest()
  return observedAppNavigationActionsForTest({
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

export async function flush() {
  await waitForNextMacrotask()
}

export async function openPopover(trigger: HTMLButtonElement) {
  await flushTestUpdates(() => {
    trigger.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
    trigger.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }))
  })
}

export function closeButtonFor(container: HTMLElement, identity: string): HTMLElement | null {
  const chrome = container.querySelector(`[data-workspace-pane-tab-tooltip-id="${identity}"]`)
  if (!chrome) return null
  return chrome.querySelector('[data-toolbar-tab-close-action]')
}

export function openTabsFor(branchName: string): WorkspacePaneStaticTabType[] {
  return workspacePaneStaticTabsFromEntries(tabsFor(branchName))
}

export function tabsFor(branchName: string): WorkspacePaneTabEntry[] {
  const repo = workspacesStore.getState().workspaces[REPO_ID]
  const target = repo
    ? workspacePaneTabsTargetForRepoBranch(
        {
          workspaceId: repo.id,
          branches: getRepoSnapshotQueryData(repo.id, repo.workspaceRuntimeId)?.branches ?? [],
        },
        branchName,
      )
    : null
  return target ? readWorkspacePaneTabsForTarget({ ...target, workspaceRuntimeId: repo.workspaceRuntimeId }) : []
}

export function workspaceRuntimeIdForTest(): string {
  const repo = workspacesStore.getState().workspaces[REPO_ID]
  if (!repo) throw new Error(`expected seeded repo ${REPO_ID}`)
  return repo.workspaceRuntimeId
}

export function staticEntry(type: WorkspacePaneStaticTabType): WorkspacePaneTabEntry {
  return workspacePaneStaticTabEntry(type)
}

export function terminalEntry(id: string): WorkspacePaneTabEntry {
  return workspacePaneRuntimeTabEntry('terminal', id)
}

export function installRecentAppFetch(
  initialSnapshot: object,
  options: { failPost?: boolean; beforePostResponse?: Promise<void> } = {},
): ReturnType<typeof vi.fn> {
  let currentSnapshot = initialSnapshot
  return mockFetch(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    if (url.endsWith('/api/settings/workspace-external-app-recent')) {
      await options.beforePostResponse
      if (options.failPost) {
        return new Response(JSON.stringify({ ok: false }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        })
      }
      const body = init?.body
        ? (JSON.parse(init.body as string) as { itemId: string; targetKey: string; workspaceId: string })
        : null
      if (body) {
        currentSnapshot = {
          ...(currentSnapshot as Record<string, unknown>),
          workspaceSettings: [
            {
              workspaceId: body.workspaceId,
              workspaceExternalAppRecent: { byTarget: { [body.targetKey]: body.itemId } },
            },
          ],
        }
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    if (url.endsWith('/api/settings') && (!init?.method || init.method === 'GET')) {
      return new Response(JSON.stringify(currentSnapshot), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    throw new Error(`unexpected fetch in test: ${url}`)
  })
}

export function externalAppTargetKey(worktreePath: string): string {
  const target = workspaceExternalAppTargetForWorktree(REPO_ID, worktreePath)
  if (!target) throw new Error('invalid external app target fixture')
  return workspaceExternalAppRecentKey(target)
}

/**
 * Build a fresh `QueryClient` whose settings snapshot cache already
 * contains the given `workspaceSettings`. Used by the worktree-scope test
 * which renders `WorkspaceExternalAppLauncherHarness` directly (it doesn't go
 * through `renderToolbar`).
 */
export function seededQueryClientWithWorkspaceSettings(workspaceSettings: WorkspaceSettingsEntry[]): QueryClient {
  const queryClient = new QueryClient()
  queryClient.setQueryData(settingsSnapshotQueryKey(), defaultSettingsSnapshot({ workspaceSettings }))
  return queryClient
}

export function externalAppLauncherTarget(repo: WorkspaceState, worktreePath: string) {
  const projection = gitWorkspacePaneProjection(repo)
  if (projection.probe.status !== 'ready') throw new Error('expected ready Git workspace fixture')
  return gitWorktreePaneFilesystemTarget({
    workspaceId: repo.id,
    workspaceRuntimeId: repo.workspaceRuntimeId,
    worktreePath,
    head: { kind: 'branch', branchName: 'feature/worktree' },
    capabilities: projection.probe.capabilities,
  })
}
