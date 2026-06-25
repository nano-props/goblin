import { FileText, GitBranch, History, Terminal, type LucideIcon } from 'lucide-react'
import type {
  WorkspacePaneStaticViewType,
  WorkspacePaneTabOrderEntry,
  WorkspacePaneView,
  WorkspacePaneViewScope,
} from '#/shared/workspace-pane.ts'
import {
  workspacePaneViewScope,
  workspacePaneStaticTabOrderEntry,
  workspacePaneTerminalTabOrderEntry,
} from '#/shared/workspace-pane.ts'
import type { WorkspacePaneViewSummary } from '#/web/components/terminal/types.ts'

type T = (key: string, params?: Record<string, string | number>) => string

export type WorkspacePaneTabScope = WorkspacePaneViewScope
export type WorkspacePaneTabProviderKind = 'static' | 'runtime'

export interface WorkspacePaneTabAvailabilityContext {
  hasWorktree: boolean
  terminalSessionCount?: number
  terminalCreatePending?: boolean
  terminalSyncReady?: boolean
}

export interface WorkspacePaneStaticTabMetadataInput {
  t: T
  branchName: string
  statusCount: number
}

export interface WorkspacePaneRuntimeTabMetadataInput {
  t: T
  branchName: string
  statusCount: number
  view: WorkspacePaneViewSummary
}

export interface WorkspacePanePendingTabMetadataInput {
  t: T
  terminalCreatePending: boolean
  terminalSyncReady: boolean
}

export interface WorkspacePanePanelLabel {
  labelledById?: string
  label?: string
}

export abstract class WorkspacePaneTabProvider<TType extends WorkspacePaneView = WorkspacePaneView> {
  readonly type: TType
  readonly icon: LucideIcon
  abstract readonly kind: WorkspacePaneTabProviderKind
  abstract readonly refreshOnOpen: boolean

  constructor(input: { type: TType; icon: LucideIcon }) {
    this.type = input.type
    this.icon = input.icon
  }

  get scope(): WorkspacePaneTabScope {
    return workspacePaneViewScope(this.type)
  }

  get requiresWorktree(): boolean {
    return this.scope === 'worktree'
  }

  identity(id: string = this.type): string {
    return `${this.type}:${id}`
  }

  panelId(workspacePaneId: string): string {
    return `${workspacePaneId}-${this.type}-panel`
  }

  canOpen(context: WorkspacePaneTabAvailabilityContext): boolean {
    return !this.requiresWorktree || context.hasWorktree
  }

  isRenderable(context: WorkspacePaneTabAvailabilityContext): boolean {
    return this.canOpen(context)
  }
}

export abstract class WorkspacePaneStaticTabProvider<
  TType extends WorkspacePaneStaticViewType = WorkspacePaneStaticViewType,
> extends WorkspacePaneTabProvider<TType> {
  readonly kind = 'static' as const

  buttonId(workspacePaneId: string): string {
    return `${workspacePaneId}-${this.type}-tab`
  }

  orderEntry(): Extract<WorkspacePaneTabOrderEntry, { type: TType }> {
    return workspacePaneStaticTabOrderEntry(this.type) as Extract<WorkspacePaneTabOrderEntry, { type: TType }>
  }

  abstract label(input: WorkspacePaneStaticTabMetadataInput): string
  abstract tooltip(input: WorkspacePaneStaticTabMetadataInput): string

  closeLabel(input: WorkspacePaneStaticTabMetadataInput): string {
    return input.t('workspace-pane-views.close-named', { name: this.label({ ...input, statusCount: 0 }) })
  }
}

class StatusWorkspacePaneTabProvider extends WorkspacePaneStaticTabProvider<'status'> {
  readonly refreshOnOpen = true

  constructor() {
    super({ type: 'status', icon: GitBranch })
  }

  label(input: WorkspacePaneStaticTabMetadataInput): string {
    return input.t('tab.status')
  }

  tooltip(input: WorkspacePaneStaticTabMetadataInput): string {
    return branchScopedViewTooltip({ kind: 'status', ...input })
  }
}

class ChangesWorkspacePaneTabProvider extends WorkspacePaneStaticTabProvider<'changes'> {
  readonly refreshOnOpen = true

  constructor() {
    super({ type: 'changes', icon: FileText })
  }

  label(input: WorkspacePaneStaticTabMetadataInput): string {
    const count = input.statusCount
    const labelKey = count > 0 ? 'tab.changes-with-count' : 'tab.changes'
    if (count > 0) return input.t(labelKey, { count })
    return input.t(labelKey)
  }

  tooltip(input: WorkspacePaneStaticTabMetadataInput): string {
    return input.t('workspace-pane-views.changes-tooltip', { count: input.statusCount })
  }
}

class HistoryWorkspacePaneTabProvider extends WorkspacePaneStaticTabProvider<'history'> {
  readonly refreshOnOpen = false

  constructor() {
    super({ type: 'history', icon: History })
  }

  label(input: WorkspacePaneStaticTabMetadataInput): string {
    return input.t('tab.log')
  }

  tooltip(input: WorkspacePaneStaticTabMetadataInput): string {
    return branchScopedViewTooltip({ kind: 'history', ...input })
  }
}

export class TerminalWorkspacePaneTabProvider extends WorkspacePaneTabProvider<'terminal'> {
  readonly kind = 'runtime' as const
  readonly refreshOnOpen = false

  constructor() {
    super({ type: 'terminal', icon: Terminal })
  }

  orderEntry(id: string): Extract<WorkspacePaneTabOrderEntry, { type: 'terminal' }> {
    return workspacePaneTerminalTabOrderEntry(id)
  }

  buttonId(workspacePaneId: string, index: number): string {
    return index <= 0 ? `${workspacePaneId}-workspace-pane-view` : `${workspacePaneId}-workspace-pane-view-${index}`
  }

  override isRenderable(context: WorkspacePaneTabAvailabilityContext): boolean {
    if (!this.canOpen(context)) return false
    if (!context.terminalSyncReady || context.terminalCreatePending) return true
    return (context.terminalSessionCount ?? 0) > 0
  }

  label(input: WorkspacePaneRuntimeTabMetadataInput): string {
    return input.view.title
  }

  tooltip(input: WorkspacePaneRuntimeTabMetadataInput): string {
    return input.view.originalTitle ?? input.view.fullTitle ?? input.view.title
  }

  closeLabel(input: WorkspacePaneRuntimeTabMetadataInput): string {
    return input.t('terminal.close-named', { name: input.view.title })
  }

  pendingLabel(input: WorkspacePanePendingTabMetadataInput): string {
    const pendingLabelKey = input.terminalCreatePending || input.terminalSyncReady
      ? 'terminal.opening'
      : 'terminal.loading'
    return input.t(pendingLabelKey)
  }
}

const BRANCH_SCOPED_VIEW_TOOLTIP_KEYS: Record<'status' | 'history', string> = {
  status: 'workspace-pane-views.status-tooltip',
  history: 'workspace-pane-views.history-tooltip',
}

function branchScopedViewTooltip(input: WorkspacePaneStaticTabMetadataInput & { kind: 'status' | 'history' }): string {
  const fallbackKey = input.kind === 'status' ? 'tab.status' : 'tab.log'
  if (!input.branchName) return input.t(fallbackKey)
  return input.t(BRANCH_SCOPED_VIEW_TOOLTIP_KEYS[input.kind], { branch: input.branchName })
}

export const statusWorkspacePaneTabProvider = new StatusWorkspacePaneTabProvider()
export const changesWorkspacePaneTabProvider = new ChangesWorkspacePaneTabProvider()
export const historyWorkspacePaneTabProvider = new HistoryWorkspacePaneTabProvider()
export const terminalWorkspacePaneTabProvider = new TerminalWorkspacePaneTabProvider()

const STATIC_WORKSPACE_PANE_TAB_PROVIDERS = [
  statusWorkspacePaneTabProvider,
  changesWorkspacePaneTabProvider,
  historyWorkspacePaneTabProvider,
] as const

const STATIC_WORKSPACE_PANE_TAB_PROVIDER_BY_TYPE: Record<
  WorkspacePaneStaticViewType,
  WorkspacePaneStaticTabProvider
> = {
  status: statusWorkspacePaneTabProvider,
  changes: changesWorkspacePaneTabProvider,
  history: historyWorkspacePaneTabProvider,
}

export const workspacePaneTabProviders = [
  ...STATIC_WORKSPACE_PANE_TAB_PROVIDERS,
  terminalWorkspacePaneTabProvider,
] as const

export function workspacePaneStaticTabProviders(): readonly WorkspacePaneStaticTabProvider[] {
  return STATIC_WORKSPACE_PANE_TAB_PROVIDERS
}

export function workspacePaneStaticTabProvider(type: WorkspacePaneStaticViewType): WorkspacePaneStaticTabProvider {
  return STATIC_WORKSPACE_PANE_TAB_PROVIDER_BY_TYPE[type]
}

export function workspacePaneTabProvider(type: WorkspacePaneView): WorkspacePaneTabProvider {
  if (type === 'terminal') return terminalWorkspacePaneTabProvider
  return workspacePaneStaticTabProvider(type)
}

export function isWorkspacePaneStaticTabProvider(
  provider: WorkspacePaneTabProvider,
): provider is WorkspacePaneStaticTabProvider {
  return provider.kind === 'static'
}
