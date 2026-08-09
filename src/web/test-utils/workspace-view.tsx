// @vitest-environment jsdom

import { seedRepoWithReadModelForTest, createRepoBranch, resetWorkspacesStore } from '#/web/test-utils/repo-store.ts'
import { afterEach, beforeEach, vi } from 'vitest'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { WorkspaceView } from '#/web/components/WorkspaceView.tsx'
import { AppNavigationProvider } from '#/web/app-navigation.tsx'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'
import { appNavigationActionsForTest } from '#/web/test-utils/app-navigation.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { appQueryClient } from '#/web/app-query-client.ts'
import { repoSnapshotQueryKey } from '#/web/repo-query-keys.ts'
import type { AppNavigationGeneration } from '#/web/app-navigation-lifecycle.ts'
import type { ButtonHTMLAttributes, FunctionalComponent, VNode, VNodeChild } from 'vue'

const responsiveMocks = vi.hoisted(() => {
  type ResponsiveMode = 'default' | 'compact'
  let mode: ResponsiveMode = 'default'
  let publish = (_mode: ResponsiveMode) => {}
  return {
    get mode() {
      return mode
    },
    set mode(next: ResponsiveMode) {
      mode = next
      publish(next)
    },
    connect(nextPublish: (next: ResponsiveMode) => void) {
      publish = nextPublish
      publish(mode)
    },
  }
})
const branchNavigatorMocks = vi.hoisted(() => ({
  activate: vi.fn<(repoId: string) => void>(),
}))
const createWorktreePageMocks = vi.hoisted(() => ({
  cancel: vi.fn<() => void>(),
  created: vi.fn<(branchName: string) => void>(),
}))
const restoreWorkspaceTabsMocks = vi.hoisted(() => ({
  useRestoreWorkspaceTabsOnView: vi.fn(),
  useRepoToasts: vi.fn(),
}))
const workspacePaneMocks = vi.hoisted(() => ({
  scrollMemoryProbe: false,
}))

vi.mock('#/web/hooks/useResponsiveUiMode.tsx', async () => {
  // Vitest hoists this factory, so create the reactive test source inside it.
  const { computed, ref } = await import('vue')
  const mode = ref(responsiveMocks.mode)
  responsiveMocks.connect((next) => {
    mode.value = next
  })
  return {
    useResponsiveUiMode: () => mode,
    useIsCompactUi: () => computed(() => mode.value === 'compact'),
  }
})

vi.mock('#/web/hooks/useRepoToasts.tsx', () => ({
  useRepoToasts: restoreWorkspaceTabsMocks.useRepoToasts,
}))

vi.mock('#/web/hooks/useRestoreWorkspaceTabsOnView.ts', () => ({
  useRestoreWorkspaceTabsOnView: restoreWorkspaceTabsMocks.useRestoreWorkspaceTabsOnView,
}))

vi.mock('#/web/components/BranchNavigator.tsx', () => {
  const BranchNavigator: FunctionalComponent<{ repoId: string }> = (props) => (
    <button
      type="button"
      data-testid="branch-navigator"
      onClick={() => {
        branchNavigatorMocks.activate(props.repoId)
      }}
    >
      branch
    </button>
  )
  BranchNavigator.props = ['repoId']
  return { BranchNavigator }
})

vi.mock('#/web/components/workspace-pane/WorkspacePane.tsx', async () => {
  // Vitest hoists mock factories before this test module's imports, so load
  // the context hook inside the factory that defines the mock.
  const { useWorkspacePaneTabStripScrollMemoryController } =
    await import('#/web/components/workspace-pane/workspace-pane-tab-strip-scroll-memory.tsx')
  const { defineComponent } = await import('vue')
  const scrollMemoryKey = 'runtime-1\0workspace-1\0branch\0feature-a'
  interface WorkspacePaneMockProps {
    currentBranchName?: string | null
    workspacePaneRouteContext?:
      | { kind: 'workspace-root'; route: { kind: string; tab?: string } | null }
      | { kind: 'routed'; route: { kind: string; tab?: string } | null }
      | { kind: 'inactive' }
    shortcutsEnabled?: boolean
    toolbarTrafficLightOffset?: boolean
  }
  return {
    WorkspacePane: defineComponent<WorkspacePaneMockProps>({
      props: ['currentBranchName', 'workspacePaneRouteContext', 'shortcutsEnabled', 'toolbarTrafficLightOffset'],
      setup(props) {
        const scrollMemory = useWorkspacePaneTabStripScrollMemoryController()
        return () => (
          <div
            data-testid="workspace-pane"
            data-current-branch-name={props.currentBranchName ?? ''}
            data-workspace-pane-route-kind={
              props.workspacePaneRouteContext?.kind === 'routed'
                ? (props.workspacePaneRouteContext.route?.kind ?? 'bare')
                : props.workspacePaneRouteContext?.kind === 'workspace-root'
                  ? (props.workspacePaneRouteContext.route?.kind ?? 'workspace-root')
                  : (props.workspacePaneRouteContext?.kind ?? 'inactive')
            }
            data-workspace-pane-route-tab={
              props.workspacePaneRouteContext?.kind !== 'inactive' &&
              props.workspacePaneRouteContext?.route?.kind === 'static'
                ? (props.workspacePaneRouteContext.route.tab ?? '')
                : ''
            }
            data-shortcuts-enabled={props.shortcutsEnabled !== false ? 'true' : 'false'}
            data-traffic-light-offset={props.toolbarTrafficLightOffset ? 'true' : 'false'}
          >
            {workspacePaneMocks.scrollMemoryProbe ? (
              <>
                <button
                  type="button"
                  data-testid="workspace-pane-scroll-memory-write"
                  onClick={() => scrollMemory.write(scrollMemoryKey, 180)}
                />
                <span data-testid="workspace-pane-scroll-memory-value">{scrollMemory.read(scrollMemoryKey)}</span>
              </>
            ) : null}
          </div>
        )
      },
    }),
  }
})

vi.mock('#/web/components/workspace-pages/CreateWorktreePagePane.tsx', () => {
  const CreateWorktreePagePane: FunctionalComponent<{
    compact?: boolean
    onCancel: () => void
    onCreated: (branchName: string, navigationGeneration: AppNavigationGeneration) => void
  }> = (props) => (
    <div data-testid="create-worktree-page" data-compact={props.compact ? 'true' : 'false'}>
      <button
        type="button"
        data-testid="create-worktree-cancel"
        onClick={() => {
          createWorktreePageMocks.cancel()
          props.onCancel()
        }}
      />
      <button
        type="button"
        data-testid="create-worktree-created"
        onClick={() => {
          createWorktreePageMocks.created('feature/new-worktree')
          props.onCreated('feature/new-worktree', 1)
        }}
      />
    </div>
  )
  CreateWorktreePagePane.props = ['compact', 'onCancel', 'onCreated']
  return { CreateWorktreePagePane }
})

vi.mock('#/web/components/workspace-pages/WorkspaceDashboardPane.tsx', () => {
  const WorkspaceDashboardPane: FunctionalComponent<{ compact?: boolean; onBack?: () => void }> = (props) => (
    <div data-testid="workspace-dashboard-page" data-compact={props.compact ? 'true' : 'false'}>
      <button
        type="button"
        data-testid="workspace-dashboard-back"
        aria-label="workspace.back-to-workspace-navigator"
        onClick={props.onBack}
      />
    </div>
  )
  WorkspaceDashboardPane.props = ['compact', 'onBack']
  return { WorkspaceDashboardPane }
})

vi.mock('#/web/components/WorkspacePickerHost.tsx', () => ({
  WorkspacePickerHost: () => <div data-testid="workspace-picker" />,
}))

vi.mock('#/web/components/repo-toolbar/RepoToolbarActions.tsx', () => ({
  BranchFilterAction: () => <div data-testid="branch-filter-action" />,
  CreateWorktreeRowAction: () => <button data-testid="create-worktree-row-action" type="button" />,
  RepoSyncAction: () => <div data-testid="repo-sync-action" />,
}))

vi.mock('#/web/components/workspace-layout/WorkspaceDashboardRowAction.tsx', () => {
  const WorkspaceDashboardRowAction: FunctionalComponent<{
    onOpenDashboard?: () => void
    selected?: boolean
  }> = (props) => (
    <button
      data-testid="dashboard-row-action"
      data-selected={props.selected ? 'true' : 'false'}
      type="button"
      onClick={props.onOpenDashboard}
    />
  )
  WorkspaceDashboardRowAction.props = ['onOpenDashboard', 'selected']
  return { WorkspaceDashboardRowAction }
})

vi.mock('#/web/components/WorkspaceZenModeToggle.tsx', () => ({
  WorkspaceZenModeToggle: (props: ButtonHTMLAttributes) => (
    <button {...props} type={props.type ?? 'button'}>
      zen
    </button>
  ),
}))

vi.mock('#/web/components/WorkspaceNavigationControls.tsx', () => {
  const WorkspaceNavigationControls: FunctionalComponent<{
    workspaceId?: string
    zenRevealTriggerEnabled?: boolean
    onZenRevealTriggerEnter?: () => void
  }> = (props) => (
    <div data-testid="workspace-navigation-controls" data-workspace-id={props.workspaceId} class="pointer-events-auto">
      <span
        data-testid="zen-mode-sidebar-trigger-surface"
        data-zen-reveal-surface={props.zenRevealTriggerEnabled ? '' : undefined}
      >
        <button type="button" data-testid="zen-mode-sidebar-trigger" onMouseenter={props.onZenRevealTriggerEnter}>
          zen
        </button>
      </span>
      <button type="button" disabled>
        back
      </button>
      <button type="button" disabled>
        forward
      </button>
    </div>
  )
  WorkspaceNavigationControls.props = ['workspaceId', 'zenRevealTriggerEnabled', 'onZenRevealTriggerEnter']
  return { WorkspaceNavigationControls }
})

vi.mock('#/web/components/Layout.tsx', () => {
  const WorkspaceSplitLayout: FunctionalComponent<{
    mode?: 'split' | 'single-pane'
    sidebarCollapsed?: boolean
    sidebarPane: VNodeChild
    workspacePane: VNodeChild
  }> = (props) => (
    <div
      data-testid="workspace-layout"
      data-mode={props.mode ?? 'split'}
      data-sidebar-collapsed={props.sidebarCollapsed ? 'true' : 'false'}
    >
      {props.mode === 'single-pane' ? (
        props.workspacePane
      ) : (
        <>
          {props.sidebarPane}
          {props.workspacePane}
        </>
      )}
    </div>
  )
  WorkspaceSplitLayout.props = ['mode', 'sidebarCollapsed', 'sidebarPane', 'workspacePane']

  const WorkspaceLayoutPane: FunctionalComponent = (_props, { slots }) => <div>{slots.default?.()}</div>

  const CompactWorkspaceLayout: FunctionalComponent<{
    activePane: 'navigator' | 'workspace'
    sidebarPane: VNodeChild
    workspacePane: VNodeChild
  }> = (props) => (
    <div data-compact-workspace="" data-active-pane={props.activePane}>
      <div data-compact-workspace-pane="navigator" aria-hidden={props.activePane === 'workspace' ? 'true' : undefined}>
        {props.sidebarPane}
      </div>
      <div data-compact-workspace-pane="workspace" aria-hidden={props.activePane === 'navigator' ? 'true' : undefined}>
        {props.workspacePane}
      </div>
    </div>
  )
  CompactWorkspaceLayout.props = ['activePane', 'sidebarPane', 'workspacePane']

  const EmptyState: FunctionalComponent<{ title: VNodeChild; body?: VNodeChild }> = (props) => (
    <div data-testid="empty-state">
      {props.title}
      {props.body}
    </div>
  )
  EmptyState.props = ['title', 'body']

  return { WorkspaceSplitLayout, WorkspaceLayoutPane, CompactWorkspaceLayout, EmptyState }
})

const REPO_ID = workspaceIdForTest('goblin+file:///tmp/repo-view-test')
const workspaceViewNavigation = appNavigationActionsForTest()
const WorkspaceViewTestScope: FunctionalComponent = (_props, { slots }) => (
  <AppNavigationProvider value={workspaceViewNavigation}>{slots.default?.()}</AppNavigationProvider>
)

function filesystemWorkspaceProbe() {
  return {
    status: 'ready' as const,
    capabilities: {
      files: { read: true as const, write: true },
      terminal: { available: true as const },
      git: { status: 'unavailable' as const },
    },
    diagnostics: [],
  }
}

function branchWorkspaceView(branchName = 'feature/a') {
  return (
    <WorkspaceView
      workspaceId={REPO_ID}
      routeView={{ kind: 'branch', workspaceId: REPO_ID, branchName, workspacePaneRoute: null }}
    />
  )
}

beforeEach(() => {
  responsiveMocks.mode = 'default'
  workspacePaneMocks.scrollMemoryProbe = false
  resetWorkspacesStore()
  seedRepoWithReadModelForTest({
    id: REPO_ID,
    branches: [createRepoBranch('main'), createRepoBranch('feature/a')],
    currentBranchName: null,
  })
  branchNavigatorMocks.activate.mockImplementation(() => {})
  restoreWorkspaceTabsMocks.useRestoreWorkspaceTabsOnView.mockClear()
  restoreWorkspaceTabsMocks.useRepoToasts.mockClear()
  restoreWorkspaceTabsMocks.useRestoreWorkspaceTabsOnView.mockReturnValue({
    state: { value: { phase: 'idle' } },
    retry: vi.fn(),
  })
})

afterEach(() => {
  branchNavigatorMocks.activate.mockReset()
  createWorktreePageMocks.cancel.mockReset()
  createWorktreePageMocks.created.mockReset()
  vi.restoreAllMocks()
})

// RTL has no reusable harness for WorkspaceView routing, responsive layout, and Zen reveal behavior.
export {
  responsiveMocks,
  branchNavigatorMocks,
  createWorktreePageMocks,
  restoreWorkspaceTabsMocks,
  workspacePaneMocks,
  REPO_ID,
  filesystemWorkspaceProbe,
  branchWorkspaceView,
  render,
  branchNavigator,
  buttonByTestId,
  buttonByLabel,
  workspacePane,
  workspaceLayout,
  compactWorkspace,
  compactPane,
  zenModeSidebarHitArea,
  zenModeSidebarDragPlate,
  zenModeSidebarReveal,
  zenModeSidebarLayer,
  zenModeSidebarResizeHandle,
  zenModeSidebarTrigger,
  zenModeSidebarTriggerSurface,
  workspaceNavigationControls,
  zenModeToggleOverlay,
  mockZenRevealLayout,
  domRect,
  setReadModelLoading,
  setRepoUnavailable,
}
function render(element: VNode) {
  return renderInJsdom(element, { wrapper: WorkspaceViewTestScope })
}

function branchNavigator(container: HTMLElement): HTMLButtonElement | null {
  return container.querySelector<HTMLButtonElement>('[data-testid="branch-navigator"]')
}

function buttonByTestId(container: HTMLElement, testId: string): HTMLButtonElement | null {
  return container.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)
}

function buttonByLabel(container: HTMLElement, label: string): HTMLButtonElement | null {
  return container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
}

function workspacePane(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>('[data-testid="workspace-pane"]')
}

function workspaceLayout(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>('[data-testid="workspace-layout"]')
}

function compactWorkspace(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>('[data-compact-workspace]')
}

function compactPane(container: HTMLElement, pane: 'navigator' | 'workspace'): HTMLElement | null {
  return container.querySelector<HTMLElement>(`[data-compact-workspace-pane="${pane}"]`)
}

function zenModeSidebarHitArea(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>('[data-testid="zen-mode-sidebar-hit-area"]')
}

function zenModeSidebarDragPlate(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>('[data-testid="zen-mode-sidebar-drag-plate"]')
}

function zenModeSidebarReveal(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>('[data-testid="zen-mode-sidebar-reveal"]')
}

function zenModeSidebarLayer(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>('[data-testid="zen-mode-sidebar-layer"]')
}

function zenModeSidebarResizeHandle(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>('[data-testid="zen-mode-sidebar-resize-handle"]')
}

function zenModeSidebarTrigger(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>('[data-testid="zen-mode-sidebar-trigger"]')
}

function zenModeSidebarTriggerSurface(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>('[data-testid="zen-mode-sidebar-trigger-surface"]')
}

function workspaceNavigationControls(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>('[data-testid="workspace-navigation-controls"]')
}

function zenModeToggleOverlay(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>('[data-testid="zen-mode-toggle-overlay"]')
}

function mockZenRevealLayout(
  container: HTMLElement,
  {
    panelLeft = 0,
    panelWidth = 360,
    panelTop = 0,
    panelHeight = 800,
    hostLeft = 0,
    hostTop = 0,
    hostWidth = 1000,
    hostHeight = 800,
  }: {
    panelLeft?: number
    panelWidth?: number
    panelTop?: number
    panelHeight?: number
    hostLeft?: number
    hostTop?: number
    hostWidth?: number
    hostHeight?: number
  },
) {
  const layer = zenModeSidebarLayer(container)
  const reveal = zenModeSidebarReveal(container)
  if (!layer || !reveal) throw new Error('missing zen reveal')

  Object.defineProperty(layer, 'getBoundingClientRect', {
    configurable: true,
    value: () => domRect({ left: hostLeft, top: hostTop, width: hostWidth, height: hostHeight }),
  })
  Object.defineProperty(reveal, 'getBoundingClientRect', {
    configurable: true,
    value: () => domRect({ left: panelLeft, top: panelTop, width: panelWidth, height: panelHeight }),
  })
  Object.defineProperty(reveal, 'offsetWidth', {
    configurable: true,
    value: panelWidth,
  })
}

function domRect({ left, top, width, height }: { left: number; top: number; width: number; height: number }) {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
  }
}

function setReadModelLoading(repoId: string) {
  const repo = workspacesStore.getState().workspaces[repoId]
  if (!repo) throw new Error(`missing repo ${repoId}`)
  appQueryClient.removeQueries({
    queryKey: repoSnapshotQueryKey(repo.id, repo.workspaceRuntimeId),
    exact: true,
  })
}

function setRepoUnavailable(repoId: string) {
  const repo = workspacesStore.getState().workspaces[repoId]
  if (!repo) throw new Error(`missing repo ${repoId}`)
  workspacesStore.setState({
    workspaces: {
      [repoId]: {
        ...repo,
        capability: {
          kind: 'unavailable',
          probe: { status: 'unavailable', reason: 'error.workspace-path-not-found' },
        },
      },
    },
  })
}
