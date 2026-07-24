import {
  WORKSPACE_PANE_RUNTIME_TAB_TYPES,
  isWorkspacePaneRuntimeTabEntry,
  isWorkspacePaneRuntimeTabType,
  workspacePaneTabEntryIdentity,
  workspacePaneRuntimeTabIdentity,
  workspacePaneRuntimeTabSessionId,
  type WorkspacePaneRuntimeTabEntry,
  type WorkspacePaneRuntimeTabType,
  type WorkspacePaneStaticTabType,
  type WorkspacePaneTabEntry,
  type WorkspacePaneTabType,
} from '#/shared/workspace-pane.ts'
import {
  runtimeWorkspacePaneTarget,
  workspacePaneTabsTargetWorktreePath,
  type WorkspacePaneTabsTarget,
} from '#/shared/workspace-pane-tabs-target.ts'
import { gitHeadBranch, type GitHead } from '#/shared/git-head.ts'
import { parseCanonicalWorkspaceLocator, type WorkspaceId } from '#/shared/workspace-locator.ts'
import { terminalGitWorktreePresentation, type TerminalSessionBase } from '#/shared/terminal-types.ts'

import { resolveRenderableWorkspacePaneTab } from '#/web/lib/workspace-pane-tab.ts'
import type { WorkspacePaneRuntimeProjectionPhase } from '#/web/workspace-pane/workspace-pane-runtime-state.ts'
import type {
  WorkspacePaneRuntimeTabSummary,
  WorkspacePaneTabSummary,
} from '#/web/workspace-pane/workspace-pane-tab-summary.ts'
import {
  workspacePanePendingRuntimeTabIdentity,
  workspacePaneRuntimeTabSummaryIdentity,
  workspacePaneRuntimeTabSummarySessionId,
} from '#/web/workspace-pane/workspace-pane-tab-summary.ts'
import { normalizeWorkspacePaneTabs } from '#/web/workspace-pane/workspace-pane-tabs.ts'
import {
  type WorkspacePaneRuntimeTabAvailabilityByType,
  workspacePaneStaticTabProvider,
  workspacePaneTabProvider,
} from '#/web/workspace-pane/tab-providers.ts'
import { workspacePaneRuntimeTabTargetKey } from '#/web/workspace-pane/workspace-pane-runtime-tab-target-key.ts'
import {
  gitWorktreeFilesystemExecutionTarget,
  workspaceRootFilesystemExecutionTarget,
} from '#/shared/workspace-runtime.ts'
import {
  workspacePaneRuntimeTabTargetKeyByType,
  type WorkspacePaneRuntimeTabTargetKeyByType,
} from '#/web/workspace-pane/workspace-pane-runtime-tab-providers.ts'

export type WorkspacePaneModelTarget = WorkspacePaneTabsTarget | { kind: 'inactive'; workspaceId: WorkspaceId }

/** Stable identity for presentation targets; excludes projected tab/view metadata. */
export function workspacePaneModelTargetIdentityKey(target: WorkspacePaneModelTarget): string {
  if (target.kind === 'inactive') return `inactive\0${target.workspaceId}`
  if (target.kind === 'workspace-root') return `workspace-root\0${target.workspaceId}`
  if (target.kind === 'git-branch') return `git-branch\0${target.workspaceId}\0${target.branchName}`
  return `git-worktree\0${target.workspaceId}\0${target.worktreePath}`
}

export type WorkspacePaneTabKind = 'static' | 'runtime' | 'pending'

interface WorkspacePaneTabBase {
  identity: string
  type: WorkspacePaneTabType
  kind: WorkspacePaneTabKind
}

export interface WorkspacePaneStaticTab extends WorkspacePaneTabBase {
  type: WorkspacePaneStaticTabType
  kind: 'static'
  view: null
}

export interface WorkspacePaneRuntimeTab extends WorkspacePaneTabBase {
  type: WorkspacePaneRuntimeTabType
  kind: 'runtime'
  runtimeType: WorkspacePaneRuntimeTabType
  view: WorkspacePaneRuntimeTabSummary
  sessionId: string
}

export interface WorkspacePanePendingTab extends WorkspacePaneTabBase {
  type: WorkspacePaneRuntimeTabType
  kind: 'pending'
  runtimeType: WorkspacePaneRuntimeTabType
  view: null
  busy: true
  selected: true
}

export type WorkspacePaneMaterializedTab = WorkspacePaneStaticTab | WorkspacePaneRuntimeTab
export type WorkspacePaneTab = WorkspacePaneMaterializedTab | WorkspacePanePendingTab

export interface WorkspacePaneRuntimeTabState {
  type: WorkspacePaneRuntimeTabType
  createPending: boolean
  projectionPhase: WorkspacePaneRuntimeProjectionPhase
  projectionErrorMessage?: string
  selectedSessionId: string | null
}

export type WorkspacePaneRuntimeTabStateByType = Record<WorkspacePaneRuntimeTabType, WorkspacePaneRuntimeTabState>
export type WorkspacePaneRuntimeViewsByType = Record<WorkspacePaneRuntimeTabType, WorkspacePaneRuntimeTabSummary[]>
export type WorkspacePaneTabEntriesProjectionPhase = 'pending' | 'ready' | 'failed'
export type WorkspacePaneRequestedRuntimeSessionByType = Partial<Record<WorkspacePaneRuntimeTabType, string | null>>

export interface WorkspacePaneRuntimeTabStateInput {
  createPending?: boolean
  projectionPhase?: WorkspacePaneRuntimeProjectionPhase
  projectionErrorMessage?: string
  selectedSessionId?: string | null
}

export type WorkspacePaneRuntimeTabStateInputByType = Partial<
  Record<WorkspacePaneRuntimeTabType, WorkspacePaneRuntimeTabStateInput>
>

export type WorkspacePaneSelection =
  | {
      kind: 'materialized-tab'
      tab: WorkspacePaneTabType
      materializedTab: WorkspacePaneMaterializedTab
    }
  | {
      /** Render a runtime host even though no materialized runtime tab exists yet. */
      kind: 'runtime-host'
      tab: WorkspacePaneRuntimeTabType
      runtimeType: WorkspacePaneRuntimeTabType
      materializedTab: null
    }

export interface WorkspacePaneTabModel {
  workspaceId: WorkspaceId
  workspaceRuntimeId: string
  /** URL family owned by the current pane. Kept separate from paneTarget because
   * a branch route may persist tabs against its checked-out worktree target. */
  routeTarget: WorkspacePaneModelTarget
  branchName: string | null
  worktreePath: string | null
  paneTarget: WorkspacePaneModelTarget
  runtimeTabTargetKeyByType: WorkspacePaneRuntimeTabTargetKeyByType
  runtimeTabTargetKey: string | null
  /** Runtime-tab lifecycle, pending, and selection state keyed by runtime type. */
  runtimeTabStateByType: WorkspacePaneRuntimeTabStateByType
  /** Live runtime session views keyed by server-owned runtime type. */
  runtimeViewsByType: WorkspacePaneRuntimeViewsByType
  /** Single target-scoped mixed workspace pane tab list. */
  tabEntries: WorkspacePaneTabEntry[]
  /** Hydration state for the target-scoped tab-entry projection. */
  tabEntriesProjectionPhase: WorkspacePaneTabEntriesProjectionPhase
  /** Open static workspace pane tabs derived from tabEntries. */
  staticTabs: WorkspacePaneStaticTabType[]
  /** Live runtime session views owned by server-side runtime features. */
  runtimeViews: WorkspacePaneTabSummary[]
  tabs: WorkspacePaneTab[]
  /** The render target for the workspace pane body. */
  selection: WorkspacePaneSelection | null
  /** The selected tab, when a body can be rendered. */
  renderedTab: WorkspacePaneTabType | null
  /** The selected materialized tab, when one exists in the tab strip. */
  activeTab: WorkspacePaneMaterializedTab | null
  /** Canonical selected entry, independent of whether its live runtime view has projected. */
  selectedEntry: WorkspacePaneTabEntry | null
  selectedIdentity: string | null
}

/** Derives terminal execution from the model's authoritative pane target. */
export function workspacePaneTerminalBaseForTabModel(
  model: Pick<WorkspacePaneTabModel, 'workspaceRuntimeId' | 'paneTarget' | 'branchName'>,
): TerminalSessionBase | null {
  if (model.paneTarget.kind === 'inactive' || model.paneTarget.kind === 'git-branch') return null
  const target = runtimeWorkspacePaneTarget(model.paneTarget, model.workspaceRuntimeId)
  if (!target) return null
  if (target.kind === 'workspace-root') return { target, presentation: { kind: 'workspace-root' } }
  if (target.kind === 'git-worktree') {
    return { target, presentation: terminalGitWorktreePresentation(model.branchName) }
  }
  return null
}

export interface WorkspacePaneTabModelInput {
  workspaceId: WorkspaceId
  workspaceRuntimeId: string
  routeTarget: WorkspacePaneModelTarget
  paneTarget: WorkspacePaneModelTarget
  worktreeHead?: GitHead
  preferredTab: WorkspacePaneTabType | null
  /**
   * Persisted preferences may fall back to the first materialized tab when
   * their preferred tab no longer has backing state. Explicit route requests
   * must not: a route miss is an empty pane until reconciliation replaces the
   * URL with the bare branch route.
   */
  allowPreferredTabFallback?: boolean
  tabEntries: readonly WorkspacePaneTabEntry[]
  tabEntriesProjectionPhase?: WorkspacePaneTabEntriesProjectionPhase
  runtimeTabViews: readonly WorkspacePaneTabSummary[]
  runtimeTabStateByType: WorkspacePaneRuntimeTabStateInputByType
  requestedSessionIdByRuntimeType?: WorkspacePaneRequestedRuntimeSessionByType
}

export function createWorkspacePaneTabModel(input: WorkspacePaneTabModelInput): WorkspacePaneTabModel {
  const worktreePath = paneTargetFilesystemPath(input.paneTarget)
  const filesystemTarget =
    input.paneTarget.kind === 'workspace-root'
      ? workspaceRootFilesystemExecutionTarget(input.workspaceId, input.workspaceRuntimeId)
      : input.paneTarget.kind === 'git-worktree'
        ? gitWorktreeFilesystemExecutionTarget(
            input.workspaceId,
            input.workspaceRuntimeId,
            input.paneTarget.worktreePath,
          )
        : null
  const branchName = paneTargetPresentationBranch(input.paneTarget, input.worktreeHead)
  const normalizedTabEntries =
    input.paneTarget.kind === 'inactive'
      ? []
      : normalizeWorkspacePaneTabs(input.tabEntries, { hasWorktree: worktreePath !== null })
  const tabEntries =
    input.paneTarget.kind === 'git-worktree' && input.worktreeHead?.kind === 'detached'
      ? normalizedTabEntries.filter(
          (entry) => isWorkspacePaneRuntimeTabEntry(entry) || entry.type === 'status' || entry.type === 'files',
        )
      : normalizedTabEntries
  const runtimeTabTargetKeyByType = workspacePaneRuntimeTabTargetKeyByType({
    workspaceId: input.workspaceId,
    workspaceRuntimeId: input.workspaceRuntimeId,
    filesystemTarget,
  })
  const runtimeTabTargetKey = workspacePaneRuntimeTabTargetKey({
    workspaceId: input.workspaceId,
    workspaceRuntimeId: input.workspaceRuntimeId,
    filesystemTarget,
  })
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
    ? activeWorkspacePaneTab(
        materializedTabs,
        candidateTab,
        runtimeTabStateByType,
        input.requestedSessionIdByRuntimeType,
      )
    : null
  const selection =
    input.preferredTab === null
      ? null
      : workspacePaneSelection({
          renderableTab: candidateTab,
          activeTab: materializedActiveTab,
          materializedTabs,
          runtimeTabStateByType,
          allowFallback: input.allowPreferredTabFallback ?? true,
        })
  const pendingTab =
    selection?.kind === 'runtime-host' && runtimeTabStateByType[selection.runtimeType].createPending
      ? pendingRuntimeWorkspacePaneTab(selection.runtimeType)
      : null
  const tabs = pendingTab ? [...materializedTabs, pendingTab] : materializedTabs
  const selectedEntry = selectedWorkspacePaneTabEntry({
    selection,
    tabEntries,
    runtimeTabStateByType,
    requestedSessionIdByRuntimeType: input.requestedSessionIdByRuntimeType,
  })

  return {
    workspaceId: input.workspaceId,
    workspaceRuntimeId: input.workspaceRuntimeId,
    routeTarget: input.routeTarget,
    branchName,
    worktreePath,
    paneTarget: input.paneTarget,
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
    selectedEntry,
    selectedIdentity: selectedEntry ? workspacePaneTabEntryIdentity(selectedEntry) : null,
  }
}

function paneTargetFilesystemPath(target: WorkspacePaneModelTarget): string | null {
  if (target.kind === 'inactive' || target.kind === 'git-branch') return null
  if (target.kind === 'git-worktree') return workspacePaneTabsTargetWorktreePath(target)
  return parseCanonicalWorkspaceLocator(target.workspaceId)?.path ?? null
}

function paneTargetPresentationBranch(
  target: WorkspacePaneModelTarget,
  worktreeHead: GitHead | undefined,
): string | null {
  if (target.kind === 'git-branch') return target.branchName
  return target.kind === 'git-worktree' && worktreeHead ? gitHeadBranch(worktreeHead) : null
}

export function nextWorkspacePaneTabEntryAfterClose(
  entries: readonly WorkspacePaneTabEntry[],
  closingIdentity: string,
  openerIdentity?: string | null,
): WorkspacePaneTabEntry | null {
  const index = entries.findIndex((entry) => workspacePaneTabEntryIdentity(entry) === closingIdentity)
  if (index === -1) return null
  if (openerIdentity) {
    const opener = entries.find((entry) => workspacePaneTabEntryIdentity(entry) === openerIdentity)
    if (opener) return opener
  }
  return entries[index + 1] ?? entries[index - 1] ?? null
}

export function adjacentWorkspacePaneTab(
  tabs: readonly WorkspacePaneTab[],
  activeIdentity: string | null | undefined,
  direction: 1 | -1,
): WorkspacePaneMaterializedTab | null {
  if (tabs.length === 0) return null
  if (!activeIdentity) return null
  const activeIndex = tabs.findIndex((tab) => tab.identity === activeIdentity)
  if (activeIndex === -1) return null
  for (let offset = 1; offset < tabs.length; offset += 1) {
    const nextIndex = (activeIndex + direction * offset + tabs.length) % tabs.length
    const tab = tabs[nextIndex]
    if (tab && isMaterializedWorkspacePaneTab(tab)) return tab
  }
  return null
}

function staticWorkspacePaneTab(type: WorkspacePaneStaticTabType): WorkspacePaneStaticTab {
  const provider = workspacePaneStaticTabProvider(type)
  return {
    identity: provider.identity(),
    type,
    kind: 'static',
    view: null,
  }
}

function runtimeWorkspacePaneTab(view: WorkspacePaneRuntimeTabSummary): WorkspacePaneRuntimeTab {
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

function pendingRuntimeWorkspacePaneTab(type: WorkspacePaneRuntimeTabType): WorkspacePanePendingTab {
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

function nextSelectableWorkspacePaneTab(
  tabs: readonly WorkspacePaneTab[],
  index: number,
  direction: 1 | -1,
): WorkspacePaneMaterializedTab | null {
  for (let offset = 1; offset < tabs.length; offset += 1) {
    const tab = tabs[index + direction * offset]
    if (!tab) return null
    if (isMaterializedWorkspacePaneTab(tab)) return tab
  }
  return null
}

export function isMaterializedWorkspacePaneTab(tab: WorkspacePaneTab): tab is WorkspacePaneMaterializedTab {
  return tab.kind !== 'pending'
}

export function isWorkspacePaneRuntimeTab(tab: WorkspacePaneTab): tab is WorkspacePaneRuntimeTab {
  return tab.kind === 'runtime'
}

export function materializedWorkspacePaneRuntimeTabSessionId(
  tab: WorkspacePaneTab | null | undefined,
  type: WorkspacePaneRuntimeTabType,
): string | null {
  return tab?.kind === 'runtime' && tab.runtimeType === type ? tab.sessionId : null
}

export function workspacePaneTabModelBlocksTabInteraction(
  model: Pick<WorkspacePaneTabModel, 'runtimeTabStateByType'>,
): boolean {
  return WORKSPACE_PANE_RUNTIME_TAB_TYPES.some((type) => model.runtimeTabStateByType[type].createPending)
}

function materializedWorkspacePaneTabs(input: {
  tabEntries: readonly WorkspacePaneTabEntry[]
  runtimeViews: readonly WorkspacePaneRuntimeTabSummary[]
  hasWorktree: boolean
}): WorkspacePaneMaterializedTab[] {
  const runtimeViewByIdentity = new Map(
    input.runtimeViews.map((view) => [workspacePaneRuntimeTabSummaryIdentity(view), view]),
  )
  const seenRuntimeTabs = new Set<string>()
  const tabs: WorkspacePaneMaterializedTab[] = []

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

function workspacePaneSelection({
  renderableTab,
  activeTab,
  materializedTabs,
  runtimeTabStateByType,
  allowFallback,
}: {
  renderableTab: WorkspacePaneTabType | null
  activeTab: WorkspacePaneMaterializedTab | null
  materializedTabs: readonly WorkspacePaneMaterializedTab[]
  runtimeTabStateByType: WorkspacePaneRuntimeTabStateByType
  allowFallback: boolean
}): WorkspacePaneSelection | null {
  if (activeTab) return { kind: 'materialized-tab', tab: activeTab.type, materializedTab: activeTab }
  // Runtime-host is reserved for the "actively waiting" states: the user
  // wants a server-owned runtime tab but no session exists yet, so the
  // runtime affordance and host remain mounted.
  if (isWorkspacePaneRuntimeTabType(renderableTab)) {
    const runtimeState = runtimeTabStateByType[renderableTab]
    if (!allowFallback && runtimeState.projectionPhase === 'ready' && !runtimeState.createPending) return null
    return { kind: 'runtime-host', tab: renderableTab, runtimeType: renderableTab, materializedTab: null }
  }
  if (!allowFallback) return null
  // Generic fallback: the preferred tab is unrenderable (no backing tab)
  // so surface the first materialized tab instead of landing on an empty pane.
  const firstTab = materializedTabs[0]
  if (firstTab) return { kind: 'materialized-tab', tab: firstTab.type, materializedTab: firstTab }
  return null
}

function selectedWorkspacePaneTabEntry(input: {
  selection: WorkspacePaneSelection | null
  tabEntries: readonly WorkspacePaneTabEntry[]
  runtimeTabStateByType: WorkspacePaneRuntimeTabStateByType
  requestedSessionIdByRuntimeType: WorkspacePaneRequestedRuntimeSessionByType | undefined
}): WorkspacePaneTabEntry | null {
  const materializedTab = input.selection?.materializedTab
  if (materializedTab) {
    return input.tabEntries.find((entry) => workspacePaneTabEntryIdentity(entry) === materializedTab.identity) ?? null
  }
  if (input.selection?.kind !== 'runtime-host') return null
  const runtimeType = input.selection.runtimeType
  const requestedSessionId = input.requestedSessionIdByRuntimeType?.[runtimeType]
  const selectedSessionId =
    requestedSessionId !== undefined ? requestedSessionId : input.runtimeTabStateByType[runtimeType].selectedSessionId
  if (!selectedSessionId) return null
  return (
    input.tabEntries.find(
      (entry) =>
        isWorkspacePaneRuntimeTabEntry(entry) &&
        entry.type === runtimeType &&
        entry.runtimeSessionId === selectedSessionId,
    ) ?? null
  )
}

function activeWorkspacePaneTab(
  tabs: readonly WorkspacePaneMaterializedTab[],
  renderableTab: WorkspacePaneTabType,
  runtimeTabStateByType: WorkspacePaneRuntimeTabStateByType,
  requestedSessionIdByRuntimeType: WorkspacePaneRequestedRuntimeSessionByType | undefined,
): WorkspacePaneMaterializedTab | null {
  if (isWorkspacePaneRuntimeTabType(renderableTab)) {
    const requestedSessionId = requestedSessionIdByRuntimeType?.[renderableTab]
    if (requestedSessionId !== undefined) {
      return requestedSessionId
        ? (tabs.find(
            (tab) => tab.kind === 'runtime' && tab.type === renderableTab && tab.sessionId === requestedSessionId,
          ) ?? null)
        : null
    }
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

function runtimeTabStateByTypeFromInput(input: WorkspacePaneTabModelInput): WorkspacePaneRuntimeTabStateByType {
  const runtimeTabStateByType: Partial<WorkspacePaneRuntimeTabStateByType> = {}
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
  return runtimeTabStateByType as WorkspacePaneRuntimeTabStateByType
}

function runtimeViewsByTypeFromViews(
  views: readonly WorkspacePaneRuntimeTabSummary[],
): WorkspacePaneRuntimeViewsByType {
  const runtimeViewsByType: Partial<WorkspacePaneRuntimeViewsByType> = {}
  for (const type of WORKSPACE_PANE_RUNTIME_TAB_TYPES) runtimeViewsByType[type] = []
  for (const view of views) runtimeViewsByType[view.type]?.push(view)
  return runtimeViewsByType as WorkspacePaneRuntimeViewsByType
}

function runtimeTabAvailabilityByTypeForTabs(
  tabs: readonly WorkspacePaneMaterializedTab[],
  runtimeTabStateByType: WorkspacePaneRuntimeTabStateByType,
): WorkspacePaneRuntimeTabAvailabilityByType {
  const sessionCountByType = new Map<WorkspacePaneRuntimeTabType, number>()
  for (const tab of tabs) {
    if (!isWorkspacePaneRuntimeTab(tab)) continue
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
