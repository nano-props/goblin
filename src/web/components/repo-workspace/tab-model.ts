import type {
  WorkspacePaneRuntimeTabEntry,
  WorkspacePaneRuntimeTabType,
  WorkspacePaneStaticTabType,
  WorkspacePaneTabEntry,
  WorkspacePaneTabType,
} from '#/shared/workspace-pane.ts'
import {
  WORKSPACE_PANE_RUNTIME_TAB_TYPES,
  isWorkspacePaneRuntimeTabEntry,
  isWorkspacePaneRuntimeTabType,
  workspacePaneRuntimeTabIdentity,
  workspacePaneRuntimeTabSessionId,
} from '#/shared/workspace-pane.ts'
import { resolveRenderableWorkspacePaneTab } from '#/web/lib/workspace-pane-tab.ts'
import type { WorkspacePaneRuntimeProjectionPhase } from '#/web/workspace-pane/workspace-pane-runtime-state.ts'
import type {
  WorkspacePaneRuntimeTabSummary,
  WorkspacePaneTabSummary,
} from '#/web/components/workspace-pane/workspace-pane-tab-summary.ts'
import {
  workspacePanePendingRuntimeTabIdentity,
  workspacePaneRuntimeTabSummaryIdentity,
  workspacePaneRuntimeTabSummarySessionId,
} from '#/web/components/workspace-pane/workspace-pane-tab-summary.ts'
import { normalizeWorkspacePaneTabs } from '#/web/workspace-pane/workspace-pane-tabs.ts'
import {
  type WorkspacePaneRuntimeTabAvailabilityByType,
  workspacePaneStaticTabProvider,
  workspacePaneTabProvider,
} from '#/web/components/workspace-pane/tab-providers.ts'
import { workspacePaneRuntimeTabTargetKey } from '#/web/workspace-pane/workspace-pane-runtime-tab-target-key.ts'
import {
  workspacePaneRuntimeTabTargetKeyByType,
  type WorkspacePaneRuntimeTabTargetKeyByType,
} from '#/web/workspace-pane/workspace-pane-runtime-tab-providers.ts'

export type RepoWorkspaceTabKind = 'static' | 'runtime' | 'pending'

interface RepoWorkspaceTabBase {
  identity: string
  type: WorkspacePaneTabType
  kind: RepoWorkspaceTabKind
}

export interface RepoWorkspaceStaticTab extends RepoWorkspaceTabBase {
  type: WorkspacePaneStaticTabType
  kind: 'static'
  view: null
}

export interface RepoWorkspaceRuntimeTab extends RepoWorkspaceTabBase {
  type: WorkspacePaneRuntimeTabType
  kind: 'runtime'
  runtimeType: WorkspacePaneRuntimeTabType
  view: WorkspacePaneRuntimeTabSummary
  sessionId: string
}

export interface RepoWorkspacePendingTab extends RepoWorkspaceTabBase {
  type: WorkspacePaneRuntimeTabType
  kind: 'pending'
  runtimeType: WorkspacePaneRuntimeTabType
  view: null
  busy: true
  selected: true
}

export type RepoWorkspaceMaterializedTab = RepoWorkspaceStaticTab | RepoWorkspaceRuntimeTab
export type RepoWorkspaceTab = RepoWorkspaceMaterializedTab | RepoWorkspacePendingTab

export interface RepoWorkspaceRuntimeTabState {
  type: WorkspacePaneRuntimeTabType
  createPending: boolean
  projectionPhase: WorkspacePaneRuntimeProjectionPhase
  projectionErrorMessage?: string
  selectedSessionId: string | null
}

export type RepoWorkspaceRuntimeTabStateByType = Record<WorkspacePaneRuntimeTabType, RepoWorkspaceRuntimeTabState>
export type RepoWorkspaceRuntimeViewsByType = Record<WorkspacePaneRuntimeTabType, WorkspacePaneRuntimeTabSummary[]>
export type RepoWorkspaceTabEntriesProjectionPhase = 'pending' | 'ready' | 'failed'

export interface RepoWorkspaceRuntimeTabStateInput {
  createPending?: boolean
  projectionPhase?: WorkspacePaneRuntimeProjectionPhase
  projectionErrorMessage?: string
  selectedSessionId?: string | null
}

export type RepoWorkspaceRuntimeTabStateInputByType = Partial<
  Record<WorkspacePaneRuntimeTabType, RepoWorkspaceRuntimeTabStateInput>
>

export type RepoWorkspaceSelection =
  | {
      kind: 'materialized-tab'
      tab: WorkspacePaneTabType
      materializedTab: RepoWorkspaceMaterializedTab
    }
  | {
      /** Render a runtime host even though no materialized runtime tab exists yet. */
      kind: 'runtime-host'
      tab: WorkspacePaneRuntimeTabType
      runtimeType: WorkspacePaneRuntimeTabType
      materializedTab: null
    }

export interface RepoWorkspaceTabModel {
  repoId: string
  branchName: string | null
  worktreePath: string | null
  runtimeTabTargetKeyByType: WorkspacePaneRuntimeTabTargetKeyByType
  runtimeTabTargetKey: string | null
  /** Runtime-tab lifecycle, pending, and selection state keyed by runtime type. */
  runtimeTabStateByType: RepoWorkspaceRuntimeTabStateByType
  /** Live runtime session views keyed by server-owned runtime type. */
  runtimeViewsByType: RepoWorkspaceRuntimeViewsByType
  /** Single target-scoped mixed workspace pane tab list. */
  tabEntries: WorkspacePaneTabEntry[]
  /** Hydration state for the target-scoped tab-entry projection. */
  tabEntriesProjectionPhase: RepoWorkspaceTabEntriesProjectionPhase
  /** Open static workspace pane tabs derived from tabEntries. */
  staticTabs: WorkspacePaneStaticTabType[]
  /** Live runtime session views owned by server-side runtime features. */
  runtimeViews: WorkspacePaneTabSummary[]
  tabs: RepoWorkspaceTab[]
  /** The render target for the workspace pane body. */
  selection: RepoWorkspaceSelection | null
  /** The selected tab, when a body can be rendered. */
  renderedTab: WorkspacePaneTabType | null
  /** The selected materialized tab, when one exists in the tab strip. */
  activeTab: RepoWorkspaceMaterializedTab | null
}

export interface RepoWorkspaceTabModelInput {
  repoId: string
  branchName: string | null
  worktreePath: string | null
  preferredTab: WorkspacePaneTabType | null
  tabEntries: readonly WorkspacePaneTabEntry[]
  tabEntriesProjectionPhase?: RepoWorkspaceTabEntriesProjectionPhase
  runtimeTabViews: readonly WorkspacePaneTabSummary[]
  runtimeTabStateByType: RepoWorkspaceRuntimeTabStateInputByType
}

export function createRepoWorkspaceTabModel(input: RepoWorkspaceTabModelInput): RepoWorkspaceTabModel {
  const tabEntries = input.branchName ? normalizeWorkspacePaneTabs(input.tabEntries) : []
  const worktreePath = input.branchName ? input.worktreePath : null
  const runtimeTabTargetKeyByType = workspacePaneRuntimeTabTargetKeyByType({ repoRoot: input.repoId, worktreePath })
  const runtimeTabTargetKey = workspacePaneRuntimeTabTargetKey({ repoRoot: input.repoId, worktreePath })
  const hasWorktree = !!worktreePath
  const runtimeTabStateByType = runtimeTabStateByTypeFromInput(input)
  const runtimeViews = input.runtimeTabViews.filter((view) => !!runtimeTabTargetKeyByType[view.type])
  const runtimeViewsByType = runtimeViewsByTypeFromViews(runtimeViews)
  const materializedTabs = materializedWorkspacePaneTabs({
    tabEntries,
    runtimeViews,
    hasWorktree,
  })
  const staticTabs = materializedTabs.flatMap((tab) => (tab.kind === 'static' ? [tab.type] : []))
  const candidateTab = input.preferredTab
    ? resolveRenderableWorkspacePaneTab(input.preferredTab, {
        hasWorktree,
        runtimeTabAvailabilityByType: runtimeTabAvailabilityByTypeForTabs(materializedTabs, runtimeTabStateByType),
      })
    : null
  const materializedActiveTab = candidateTab
    ? activeRepoWorkspaceTab(materializedTabs, candidateTab, runtimeTabStateByType)
    : null
  const selection =
    input.preferredTab === null ? null : workspacePaneSelection(candidateTab, materializedActiveTab, materializedTabs)
  const pendingTab =
    selection?.kind === 'runtime-host' && runtimeTabStateByType[selection.runtimeType].createPending
      ? pendingRuntimeWorkspacePaneTab(selection.runtimeType)
      : null
  const tabs = pendingTab ? [...materializedTabs, pendingTab] : materializedTabs

  return {
    repoId: input.repoId,
    branchName: input.branchName,
    worktreePath,
    runtimeTabTargetKeyByType,
    runtimeTabTargetKey,
    runtimeTabStateByType,
    runtimeViewsByType,
    tabEntries,
    tabEntriesProjectionPhase: input.tabEntriesProjectionPhase ?? 'ready',
    staticTabs,
    runtimeViews,
    tabs,
    selection,
    renderedTab: selection?.tab ?? null,
    activeTab: selection?.kind === 'materialized-tab' ? selection.materializedTab : null,
  }
}

export function nextRepoWorkspaceTabAfterClose(
  tabs: readonly RepoWorkspaceTab[],
  closingIdentity: string,
  openerIdentity?: string | null,
): RepoWorkspaceMaterializedTab | null {
  const index = tabs.findIndex((tab) => tab.identity === closingIdentity)
  if (index === -1) return null
  // Chrome-style opener preference: if the tab that opened this one is still
  // open, reactivate it before falling back to the nearest neighbor.
  if (openerIdentity) {
    const opener = tabs.find((tab) => tab.identity === openerIdentity)
    if (opener && isMaterializedRepoWorkspaceTab(opener)) return opener
  }
  return nextSelectableRepoWorkspaceTab(tabs, index, 1) ?? nextSelectableRepoWorkspaceTab(tabs, index, -1)
}

export function adjacentRepoWorkspaceTab(
  tabs: readonly RepoWorkspaceTab[],
  activeIdentity: string | null | undefined,
  direction: 1 | -1,
): RepoWorkspaceMaterializedTab | null {
  if (tabs.length === 0) return null
  if (!activeIdentity) return null
  const activeIndex = tabs.findIndex((tab) => tab.identity === activeIdentity)
  if (activeIndex === -1) return null
  for (let offset = 1; offset < tabs.length; offset += 1) {
    const nextIndex = (activeIndex + direction * offset + tabs.length) % tabs.length
    const tab = tabs[nextIndex]
    if (tab && isMaterializedRepoWorkspaceTab(tab)) return tab
  }
  return null
}

function staticWorkspacePaneTab(type: WorkspacePaneStaticTabType): RepoWorkspaceStaticTab {
  const provider = workspacePaneStaticTabProvider(type)
  return {
    identity: provider.identity(),
    type,
    kind: 'static',
    view: null,
  }
}

function runtimeWorkspacePaneTab(view: WorkspacePaneRuntimeTabSummary): RepoWorkspaceRuntimeTab {
  const sessionId = workspacePaneRuntimeTabSummarySessionId(view)
  return {
    identity: workspacePaneRuntimeTabSummaryIdentity(view),
    type: view.type,
    kind: 'runtime' as const,
    runtimeType: view.type,
    view,
    sessionId,
  }
}

function pendingRuntimeWorkspacePaneTab(type: WorkspacePaneRuntimeTabType): RepoWorkspacePendingTab {
  return {
    identity: workspacePanePendingRuntimeTabIdentity(type),
    type,
    kind: 'pending',
    runtimeType: type,
    view: null,
    busy: true,
    selected: true,
  }
}

function nextSelectableRepoWorkspaceTab(
  tabs: readonly RepoWorkspaceTab[],
  index: number,
  direction: 1 | -1,
): RepoWorkspaceMaterializedTab | null {
  for (let offset = 1; offset < tabs.length; offset += 1) {
    const tab = tabs[index + direction * offset]
    if (!tab) return null
    if (isMaterializedRepoWorkspaceTab(tab)) return tab
  }
  return null
}

function isMaterializedRepoWorkspaceTab(tab: RepoWorkspaceTab): tab is RepoWorkspaceMaterializedTab {
  return tab.kind !== 'pending'
}

export function isRepoWorkspaceRuntimeTab(tab: RepoWorkspaceTab): tab is RepoWorkspaceRuntimeTab {
  return tab.kind === 'runtime'
}

export function repoWorkspaceRuntimeTabSessionId(
  tab: RepoWorkspaceTab | null | undefined,
  type: WorkspacePaneRuntimeTabType,
): string | null {
  return tab?.kind === 'runtime' && tab.runtimeType === type ? tab.sessionId : null
}

export function repoWorkspaceTabModelBlocksTabInteraction(
  model: Pick<RepoWorkspaceTabModel, 'runtimeTabStateByType'>,
): boolean {
  return WORKSPACE_PANE_RUNTIME_TAB_TYPES.some((type) => model.runtimeTabStateByType[type].createPending)
}

function materializedWorkspacePaneTabs(input: {
  tabEntries: readonly WorkspacePaneTabEntry[]
  runtimeViews: readonly WorkspacePaneRuntimeTabSummary[]
  hasWorktree: boolean
}): RepoWorkspaceMaterializedTab[] {
  const runtimeViewByIdentity = new Map(
    input.runtimeViews.map((view) => [workspacePaneRuntimeTabSummaryIdentity(view), view]),
  )
  const seenRuntimeTabs = new Set<string>()
  const tabs: RepoWorkspaceMaterializedTab[] = []

  for (const entry of input.tabEntries) {
    if (!isWorkspacePaneRuntimeTabEntry(entry)) {
      if (!workspacePaneTabProvider(entry.type).canOpen({ hasWorktree: input.hasWorktree })) continue
      tabs.push(staticWorkspacePaneTab(entry.type))
      continue
    }
    if (!workspacePaneTabProvider(entry.type).canOpen({ hasWorktree: input.hasWorktree })) continue
    const identity = runtimeTabEntryIdentity(entry)
    const runtimeView = runtimeViewByIdentity.get(identity)
    if (!runtimeView || seenRuntimeTabs.has(identity)) continue
    seenRuntimeTabs.add(identity)
    tabs.push(runtimeWorkspacePaneTab(runtimeView))
  }

  return tabs
}

function workspacePaneSelection(
  renderableTab: WorkspacePaneTabType | null,
  activeTab: RepoWorkspaceMaterializedTab | null,
  materializedTabs: readonly RepoWorkspaceMaterializedTab[],
): RepoWorkspaceSelection | null {
  if (activeTab) return { kind: 'materialized-tab', tab: activeTab.type, materializedTab: activeTab }
  // Runtime-host is reserved for the "actively waiting" states: the user
  // wants a server-owned runtime tab but no session exists yet, so the
  // runtime affordance and host remain mounted.
  if (isWorkspacePaneRuntimeTabType(renderableTab)) {
    return { kind: 'runtime-host', tab: renderableTab, runtimeType: renderableTab, materializedTab: null }
  }
  // Generic fallback: the preferred tab is unrenderable (no backing tab)
  // so surface the first materialized tab instead of landing on an empty pane.
  const firstTab = materializedTabs[0]
  if (firstTab) return { kind: 'materialized-tab', tab: firstTab.type, materializedTab: firstTab }
  return null
}

function activeRepoWorkspaceTab(
  tabs: readonly RepoWorkspaceMaterializedTab[],
  renderableTab: WorkspacePaneTabType,
  runtimeTabStateByType: RepoWorkspaceRuntimeTabStateByType,
): RepoWorkspaceMaterializedTab | null {
  if (isWorkspacePaneRuntimeTabType(renderableTab)) {
    const selectedSessionId = runtimeTabStateByType[renderableTab].selectedSessionId
    if (selectedSessionId) {
      const selected = tabs.find(
        (tab) => tab.kind === 'runtime' && tab.type === renderableTab && tab.sessionId === selectedSessionId,
      )
      if (selected) return selected
    }
    return tabs.find((tab) => tab.kind === 'runtime' && tab.type === renderableTab) ?? null
  }
  return tabs.find((tab) => tab.type === renderableTab) ?? null
}

function runtimeTabEntryIdentity(entry: WorkspacePaneRuntimeTabEntry): string {
  return workspacePaneRuntimeTabIdentity(entry.type, workspacePaneRuntimeTabSessionId(entry))
}

function runtimeTabStateByTypeFromInput(input: RepoWorkspaceTabModelInput): RepoWorkspaceRuntimeTabStateByType {
  const runtimeTabStateByType: Partial<RepoWorkspaceRuntimeTabStateByType> = {}
  for (const type of WORKSPACE_PANE_RUNTIME_TAB_TYPES) {
    const state = input.runtimeTabStateByType[type]
    runtimeTabStateByType[type] = {
      type,
      createPending: state?.createPending ?? false,
      projectionPhase: state?.projectionPhase ?? 'pending',
      projectionErrorMessage: state?.projectionErrorMessage,
      selectedSessionId: state?.selectedSessionId ?? null,
    }
  }
  return runtimeTabStateByType as RepoWorkspaceRuntimeTabStateByType
}

function runtimeViewsByTypeFromViews(
  views: readonly WorkspacePaneRuntimeTabSummary[],
): RepoWorkspaceRuntimeViewsByType {
  const runtimeViewsByType: Partial<RepoWorkspaceRuntimeViewsByType> = {}
  for (const type of WORKSPACE_PANE_RUNTIME_TAB_TYPES) runtimeViewsByType[type] = []
  for (const view of views) runtimeViewsByType[view.type]?.push(view)
  return runtimeViewsByType as RepoWorkspaceRuntimeViewsByType
}

function runtimeTabAvailabilityByTypeForTabs(
  tabs: readonly RepoWorkspaceMaterializedTab[],
  runtimeTabStateByType: RepoWorkspaceRuntimeTabStateByType,
): WorkspacePaneRuntimeTabAvailabilityByType {
  const sessionCountByType = new Map<WorkspacePaneRuntimeTabType, number>()
  for (const tab of tabs) {
    if (!isRepoWorkspaceRuntimeTab(tab)) continue
    sessionCountByType.set(tab.runtimeType, (sessionCountByType.get(tab.runtimeType) ?? 0) + 1)
  }
  const runtimeTabAvailabilityByType: WorkspacePaneRuntimeTabAvailabilityByType = {}
  for (const type of WORKSPACE_PANE_RUNTIME_TAB_TYPES) {
    const state = runtimeTabStateByType[type]
    runtimeTabAvailabilityByType[type] = {
      sessionCount: sessionCountByType.get(type) ?? 0,
      createPending: state.createPending,
      projectionPhase: state.projectionPhase,
    }
  }
  return runtimeTabAvailabilityByType
}
