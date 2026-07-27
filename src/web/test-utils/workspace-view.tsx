// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useFakeTimers } from '#/test-utils/timers.ts'
import { act, cleanup } from '@testing-library/react'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { WorkspaceView } from '#/web/components/WorkspaceView.tsx'
import {
  resetWorkspacesStore,
  seedRepoShellForTest,
  seedRepoWithReadModelForTest,
  createRepoBranch,
  setWorkspaceProbeForTest,
} from '#/web/test-utils/bridge.ts'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import { WORKSPACE_PANE_TRANSITION_MS } from '#/web/components/workspace-motion.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import * as repoDataQuery from '#/web/repo-query-runtime.ts'

const responsiveMocks = vi.hoisted(() => ({
  mode: 'default' as 'default' | 'compact',
}))
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

vi.mock('#/web/hooks/useResponsiveUiMode.tsx', () => ({
  useResponsiveUiMode: () => responsiveMocks.mode,
  useIsCompactUi: () => responsiveMocks.mode === 'compact',
}))

vi.mock('#/web/hooks/useRepoToasts.tsx', () => ({
  useRepoToasts: restoreWorkspaceTabsMocks.useRepoToasts,
}))

vi.mock('#/web/hooks/useRestoreWorkspaceTabsOnView.ts', () => ({
  useRestoreWorkspaceTabsOnView: restoreWorkspaceTabsMocks.useRestoreWorkspaceTabsOnView,
}))

vi.mock('#/web/components/BranchNavigator.tsx', () => ({
  BranchNavigator: ({ repoId }: { repoId: string }) => (
    <button
      type="button"
      data-testid="branch-navigator"
      onClick={() => {
        branchNavigatorMocks.activate(repoId)
      }}
    >
      branch
    </button>
  ),
}))

vi.mock('#/web/components/workspace-pane/WorkspacePane.tsx', async () => {
  // Vitest hoists mock factories before this test module's imports, so load
  // the context hook inside the factory that defines the mock.
  const { useWorkspacePaneTabStripScrollMemoryController } =
    await import('#/web/components/workspace-pane/workspace-pane-tab-strip-scroll-memory.tsx')
  const scrollMemoryKey = 'runtime-1\0workspace-1\0branch\0feature-a'
  return {
    WorkspacePane: ({
      currentBranchName,
      workspacePaneRouteContext,
      shortcutsEnabled = true,
      toolbarTrafficLightOffset = false,
    }: {
      currentBranchName?: string | null
      workspacePaneRouteContext?:
        | { kind: 'workspace-root'; route: { kind: string } | null }
        | { kind: 'routed'; route: { kind: string } | null }
        | { kind: 'inactive' }
      shortcutsEnabled?: boolean
      toolbarTrafficLightOffset?: boolean
    }) => {
      const scrollMemory = useWorkspacePaneTabStripScrollMemoryController()
      return (
        <div
          data-testid="workspace-pane"
          data-current-branch-name={currentBranchName ?? ''}
          data-workspace-pane-route-kind={
            workspacePaneRouteContext?.kind === 'routed'
              ? (workspacePaneRouteContext.route?.kind ?? 'bare')
              : workspacePaneRouteContext?.kind === 'workspace-root'
                ? (workspacePaneRouteContext.route?.kind ?? 'workspace-root')
                : (workspacePaneRouteContext?.kind ?? 'inactive')
          }
          data-shortcuts-enabled={shortcutsEnabled ? 'true' : 'false'}
          data-traffic-light-offset={toolbarTrafficLightOffset ? 'true' : 'false'}
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
  }
})

vi.mock('#/web/components/workspace-pages/CreateWorktreePagePane.tsx', () => ({
  CreateWorktreePagePane: ({
    compact,
    onCancel,
    onCreated,
  }: {
    compact?: boolean
    onCancel: () => void
    onCreated: (branchName: string) => void
  }) => (
    <div data-testid="create-worktree-page" data-compact={compact ? 'true' : 'false'}>
      <button
        type="button"
        data-testid="create-worktree-cancel"
        onClick={() => {
          createWorktreePageMocks.cancel()
          onCancel()
        }}
      />
      <button
        type="button"
        data-testid="create-worktree-created"
        onClick={() => {
          createWorktreePageMocks.created('feature/new-worktree')
          onCreated('feature/new-worktree')
        }}
      />
    </div>
  ),
}))

vi.mock('#/web/components/workspace-pages/WorkspaceDashboardPane.tsx', () => ({
  WorkspaceDashboardPane: ({ compact, onBack }: { compact?: boolean; onBack?: () => void }) => (
    <div data-testid="workspace-dashboard-page" data-compact={compact ? 'true' : 'false'}>
      <button
        type="button"
        data-testid="workspace-dashboard-back"
        aria-label="workspace.back-to-workspace-navigator"
        onClick={onBack}
      />
    </div>
  ),
}))

vi.mock('#/web/components/WorkspacePickerHost.tsx', () => ({
  WorkspacePickerHost: () => <div data-testid="workspace-picker" />,
}))

vi.mock('#/web/components/repo-toolbar/RepoToolbarActions.tsx', () => ({
  BranchFilterAction: () => <div data-testid="branch-filter-action" />,
  CreateWorktreeRowAction: () => <button data-testid="create-worktree-row-action" type="button" />,
  RepoSyncAction: () => <div data-testid="repo-sync-action" />,
}))

vi.mock('#/web/components/workspace-layout/WorkspaceDashboardRowAction.tsx', () => ({
  WorkspaceDashboardRowAction: ({
    onOpenDashboard,
    selected = false,
  }: {
    onOpenDashboard?: () => void
    selected?: boolean
  }) => (
    <button
      data-testid="dashboard-row-action"
      data-selected={selected ? 'true' : 'false'}
      type="button"
      onClick={onOpenDashboard}
    />
  ),
}))

vi.mock('#/web/components/WorkspaceZenModeToggle.tsx', () => ({
  WorkspaceZenModeToggle: (props: React.ComponentProps<'button'>) => (
    <button type="button" {...props}>
      zen
    </button>
  ),
}))

vi.mock('#/web/components/WorkspaceNavigationControls.tsx', () => ({
  WorkspaceNavigationControls: ({
    repoId,
    zenRevealTriggerEnabled,
    onZenRevealTriggerEnter,
  }: {
    repoId?: string
    zenRevealTriggerEnabled?: boolean
    onZenRevealTriggerEnter?: () => void
  }) => (
    <div data-testid="workspace-navigation-controls" data-repo-id={repoId} className="pointer-events-auto">
      <span
        data-testid="zen-mode-sidebar-trigger-surface"
        data-zen-reveal-surface={zenRevealTriggerEnabled ? '' : undefined}
      >
        <button type="button" data-testid="zen-mode-sidebar-trigger" onMouseEnter={onZenRevealTriggerEnter}>
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
  ),
}))

vi.mock('#/web/components/Layout.tsx', () => ({
  WorkspaceSplitLayout: ({
    mode,
    sidebarCollapsed,
    sidebarPane,
    workspacePane,
  }: {
    mode?: 'split' | 'single-pane'
    sidebarCollapsed?: boolean
    sidebarPane: React.ReactNode
    workspacePane: React.ReactNode
  }) => (
    <div
      data-testid="workspace-layout"
      data-mode={mode ?? 'split'}
      data-sidebar-collapsed={sidebarCollapsed ? 'true' : 'false'}
    >
      {mode === 'single-pane' ? (
        workspacePane
      ) : (
        <>
          {sidebarPane}
          {workspacePane}
        </>
      )}
    </div>
  ),
  WorkspaceLayoutPane: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CompactWorkspaceLayout: ({
    activePane,
    sidebarPane,
    workspacePane,
  }: {
    activePane: 'navigator' | 'workspace'
    sidebarPane: React.ReactNode
    workspacePane: React.ReactNode
  }) => (
    <div data-compact-workspace="" data-active-pane={activePane}>
      <div data-compact-workspace-pane="navigator" aria-hidden={activePane === 'workspace' ? 'true' : undefined}>
        {sidebarPane}
      </div>
      <div data-compact-workspace-pane="workspace" aria-hidden={activePane === 'navigator' ? 'true' : undefined}>
        {workspacePane}
      </div>
    </div>
  ),
  EmptyState: ({ title, body }: { title: React.ReactNode; body?: React.ReactNode }) => (
    <div data-testid="empty-state">
      {title}
      {body}
    </div>
  ),
}))

const REPO_ID = workspaceIdForTest('goblin+file:///tmp/repo-view-test')

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
  restoreWorkspaceTabsMocks.useRestoreWorkspaceTabsOnView.mockReturnValue({ state: { phase: 'idle' }, retry: vi.fn() })
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
function render(element: React.ReactNode) {
  return renderInJsdom(element)
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
  const repo = useWorkspacesStore.getState().workspaces[repoId]
  if (!repo) throw new Error(`missing repo ${repoId}`)
  if (repo.capability.kind !== 'git') throw new Error(`expected Git repo ${repoId}`)
  const dataLoads = {
    ...repo.capability.git.dataLoads,
    repoReadModel: {
      ...repo.capability.git.dataLoads.repoReadModel,
      phase: 'loading' as const,
      loadedAt: null,
      error: null,
      stale: false,
    },
  }
  useWorkspacesStore.setState({
    workspaces: {
      [repoId]: {
        ...repo,
        capability: {
          ...repo.capability,
          git: { ...repo.capability.git, dataLoads },
        },
      },
    },
  })
}

function setRepoUnavailable(repoId: string) {
  const repo = useWorkspacesStore.getState().workspaces[repoId]
  if (!repo) throw new Error(`missing repo ${repoId}`)
  useWorkspacesStore.setState({
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
