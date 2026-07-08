import { Diff, FolderTree, GitBranch, History, Terminal, type LucideIcon } from 'lucide-react'
import type {
  WorkspacePaneRuntimeTabType,
  WorkspacePaneStaticTabType,
  WorkspacePaneTabEntry,
  WorkspacePaneTabType,
  WorkspacePaneTabScope,
} from '#/shared/workspace-pane.ts'
import {
  isWorkspacePaneRuntimeTabType,
  workspacePaneRuntimeTabEntry,
  workspacePaneRuntimeTabIdentity,
  workspacePaneTabScope,
  workspacePaneStaticTabId,
  workspacePaneStaticTabEntry,
} from '#/shared/workspace-pane.ts'
import type { WorkspacePaneTabSummary } from '#/web/workspace-pane/workspace-pane-tab-summary.ts'
import type { WorkspacePaneRuntimeProjectionPhase } from '#/web/workspace-pane/workspace-pane-runtime-state.ts'

type T = (key: string, params?: Record<string, string | number>) => string

export type WorkspacePaneTabProviderKind = 'static' | 'runtime'

export interface WorkspacePaneRuntimeTabAvailability {
  sessionCount: number
  createPending: boolean
  projectionPhase: WorkspacePaneRuntimeProjectionPhase
}

export type WorkspacePaneRuntimeTabAvailabilityByType = Partial<
  Record<WorkspacePaneRuntimeTabType, WorkspacePaneRuntimeTabAvailability>
>

export interface WorkspacePaneTabAvailabilityContext {
  hasWorktree: boolean
  runtimeTabAvailabilityByType?: WorkspacePaneRuntimeTabAvailabilityByType
}

export interface WorkspacePaneStaticTabMetadataInput {
  t: T
  branchName: string
  statusCount: number
}

export interface WorkspacePaneRuntimeTabMetadataInput<
  TType extends WorkspacePaneRuntimeTabType = WorkspacePaneRuntimeTabType,
> {
  t: T
  branchName: string
  statusCount: number
  view: Extract<WorkspacePaneTabSummary, { type: TType }>
}

export interface WorkspacePanePendingTabMetadataInput {
  t: T
  createPending: boolean
  projectionPhase: WorkspacePaneRuntimeProjectionPhase
}

export interface WorkspacePaneRuntimeTabAttention {
  attention: boolean
  attentionLabelKey?: string
}

export interface WorkspacePaneRuntimeTabAttentionInput<
  TType extends WorkspacePaneRuntimeTabType = WorkspacePaneRuntimeTabType,
> {
  view: Extract<WorkspacePaneTabSummary, { type: TType }>
}

export interface WorkspacePanePanelLabel {
  labelledById?: string
  label?: string
}

export interface WorkspacePaneTabCloseInput {
  repoId: string
  branchName: string | null
  runtimeSessionId?: string
  closeStaticTab?: (
    repoId: string,
    type: WorkspacePaneStaticTabType,
    branchName: string,
  ) => boolean | void | Promise<boolean | void>
}

export abstract class WorkspacePaneTabProvider<TType extends WorkspacePaneTabType = WorkspacePaneTabType> {
  readonly type: TType
  readonly icon: LucideIcon
  abstract readonly kind: WorkspacePaneTabProviderKind
  abstract readonly refreshOnOpen: boolean

  constructor(input: { type: TType; icon: LucideIcon }) {
    this.type = input.type
    this.icon = input.icon
  }

  get scope(): WorkspacePaneTabScope {
    return workspacePaneTabScope(this.type)
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

  abstract close(input: WorkspacePaneTabCloseInput): Promise<boolean>

  closeWorktree(input: WorkspacePaneTabCloseInput): Promise<boolean> {
    return this.close(input)
  }
}

export abstract class WorkspacePaneStaticTabProvider<
  TType extends WorkspacePaneStaticTabType = WorkspacePaneStaticTabType,
> extends WorkspacePaneTabProvider<TType> {
  readonly kind = 'static' as const

  override identity(): string {
    return workspacePaneStaticTabId(this.type)
  }

  buttonId(workspacePaneId: string): string {
    return `${workspacePaneId}-${this.type}-tab`
  }

  tabEntry(): Extract<WorkspacePaneTabEntry, { type: TType }> {
    return workspacePaneStaticTabEntry(this.type) as Extract<WorkspacePaneTabEntry, { type: TType }>
  }

  abstract label(input: WorkspacePaneStaticTabMetadataInput): string
  abstract tooltip(input: WorkspacePaneStaticTabMetadataInput): string

  closeLabel(input: WorkspacePaneStaticTabMetadataInput): string {
    return input.t('workspace-pane-tabs.close-named', { name: this.label({ ...input, statusCount: 0 }) })
  }

  close(input: WorkspacePaneTabCloseInput): Promise<boolean> {
    if (!input.branchName || !input.closeStaticTab) return Promise.resolve(false)
    return Promise.resolve(input.closeStaticTab(input.repoId, this.type, input.branchName)).then(
      (result) => result !== false,
    )
  }
}

export abstract class WorkspacePaneRuntimeTabProvider<
  TType extends WorkspacePaneRuntimeTabType = WorkspacePaneRuntimeTabType,
> extends WorkspacePaneTabProvider<TType> {
  readonly kind = 'runtime' as const

  override identity(sessionId: string): string {
    return workspacePaneRuntimeTabIdentity(this.type, sessionId)
  }

  buttonId(workspacePaneId: string, index: number): string {
    return index <= 0 ? `${workspacePaneId}-${this.type}-tab` : `${workspacePaneId}-${this.type}-tab-${index}`
  }

  tabEntry(sessionId: string): Extract<WorkspacePaneTabEntry, { type: TType }> {
    return workspacePaneRuntimeTabEntry(this.type, sessionId) as Extract<WorkspacePaneTabEntry, { type: TType }>
  }

  abstract label(input: WorkspacePaneRuntimeTabMetadataInput<TType>): string
  abstract tooltip(input: WorkspacePaneRuntimeTabMetadataInput<TType>): string
  abstract closeLabel(input: WorkspacePaneRuntimeTabMetadataInput<TType>): string
  abstract pendingLabel(input: WorkspacePanePendingTabMetadataInput): string

  attention(_input: WorkspacePaneRuntimeTabAttentionInput<TType>): WorkspacePaneRuntimeTabAttention {
    return { attention: false }
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
    return branchScopedTabTooltip({ kind: 'status', ...input })
  }
}

class ChangesWorkspacePaneTabProvider extends WorkspacePaneStaticTabProvider<'changes'> {
  readonly refreshOnOpen = true

  constructor() {
    super({ type: 'changes', icon: Diff })
  }

  label(input: WorkspacePaneStaticTabMetadataInput): string {
    const count = input.statusCount
    const labelKey = count > 0 ? 'tab.changes-with-count' : 'tab.changes'
    if (count > 0) return input.t(labelKey, { count })
    return input.t(labelKey)
  }

  tooltip(input: WorkspacePaneStaticTabMetadataInput): string {
    return input.t('workspace-pane-tabs.changes-tooltip', { count: input.statusCount })
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
    return branchScopedTabTooltip({ kind: 'history', ...input })
  }
}

class FilesWorkspacePaneTabProvider extends WorkspacePaneStaticTabProvider<'files'> {
  readonly refreshOnOpen = true

  constructor() {
    super({ type: 'files', icon: FolderTree })
  }

  label(input: WorkspacePaneStaticTabMetadataInput): string {
    return input.t('tab.files')
  }

  tooltip(input: WorkspacePaneStaticTabMetadataInput): string {
    if (!input.branchName) return input.t('tab.files')
    return input.t('workspace-pane-tabs.files-tooltip', { branch: input.branchName })
  }
}

export class TerminalWorkspacePaneTabProvider extends WorkspacePaneRuntimeTabProvider<'terminal'> {
  readonly refreshOnOpen = false

  constructor() {
    super({ type: 'terminal', icon: Terminal })
  }

  override buttonId(workspacePaneId: string, index: number): string {
    return index <= 0 ? `${workspacePaneId}-workspace-pane-tab` : `${workspacePaneId}-workspace-pane-tab-${index}`
  }

  override isRenderable(context: WorkspacePaneTabAvailabilityContext): boolean {
    if (!this.canOpen(context)) return false
    const availability = runtimeTabAvailability(context, this.type)
    if (availability.projectionPhase !== 'ready' || availability.createPending) return true
    return availability.sessionCount > 0
  }

  label(input: WorkspacePaneRuntimeTabMetadataInput): string {
    if (isPlaceholderTerminalTitle(input.view)) {
      // The server uses "terminal" as a short-lived process-name
      // placeholder before the shell reports its real name. Keep that
      // implementation detail out of visible tab text.
      return ''
    }
    return input.view.title
  }

  tooltip(input: WorkspacePaneRuntimeTabMetadataInput): string {
    if (isPlaceholderTerminalTitle(input.view)) return input.t('terminal.opening')
    return input.view.originalTitle ?? input.view.fullTitle ?? input.view.title
  }

  closeLabel(input: WorkspacePaneRuntimeTabMetadataInput): string {
    const name = isPlaceholderTerminalTitle(input.view) ? this.tooltip(input) : input.view.title
    return input.t('terminal.close-named', { name })
  }

  pendingLabel(input: WorkspacePanePendingTabMetadataInput): string {
    const pendingLabelKey =
      input.projectionPhase === 'failed'
        ? 'terminal.load-failed'
        : input.createPending || input.projectionPhase === 'ready'
          ? 'terminal.opening'
          : 'terminal.loading'
    return input.t(pendingLabelKey)
  }

  override attention(input: WorkspacePaneRuntimeTabAttentionInput<'terminal'>): WorkspacePaneRuntimeTabAttention {
    if (input.view.hasBell) return { attention: true, attentionLabelKey: 'terminal.bell-unread' }
    return { attention: false }
  }

  close(_input: WorkspacePaneTabCloseInput): Promise<boolean> {
    return Promise.resolve(false)
  }
}

const BRANCH_SCOPED_TAB_TOOLTIP_KEYS: Record<'status' | 'history', string> = {
  status: 'workspace-pane-tabs.status-tooltip',
  history: 'workspace-pane-tabs.history-tooltip',
}

function branchScopedTabTooltip(input: WorkspacePaneStaticTabMetadataInput & { kind: 'status' | 'history' }): string {
  const fallbackKey = input.kind === 'status' ? 'tab.status' : 'tab.log'
  if (!input.branchName) return input.t(fallbackKey)
  return input.t(BRANCH_SCOPED_TAB_TOOLTIP_KEYS[input.kind], { branch: input.branchName })
}

export const statusWorkspacePaneTabProvider = new StatusWorkspacePaneTabProvider()
export const changesWorkspacePaneTabProvider = new ChangesWorkspacePaneTabProvider()
export const historyWorkspacePaneTabProvider = new HistoryWorkspacePaneTabProvider()
export const filesWorkspacePaneTabProvider = new FilesWorkspacePaneTabProvider()
export const terminalWorkspacePaneTabProvider = new TerminalWorkspacePaneTabProvider()

function isPlaceholderTerminalTitle(view: WorkspacePaneTabSummary): boolean {
  return view.type === 'terminal' && !view.originalTitle && view.title.trim().toLowerCase() === 'terminal'
}

const STATIC_WORKSPACE_PANE_TAB_PROVIDERS = [
  statusWorkspacePaneTabProvider,
  changesWorkspacePaneTabProvider,
  historyWorkspacePaneTabProvider,
  filesWorkspacePaneTabProvider,
] as const

const STATIC_WORKSPACE_PANE_TAB_PROVIDER_BY_TYPE: Record<WorkspacePaneStaticTabType, WorkspacePaneStaticTabProvider> = {
  status: statusWorkspacePaneTabProvider,
  changes: changesWorkspacePaneTabProvider,
  history: historyWorkspacePaneTabProvider,
  files: filesWorkspacePaneTabProvider,
}

const RUNTIME_WORKSPACE_PANE_TAB_PROVIDERS = [terminalWorkspacePaneTabProvider] as const

const RUNTIME_WORKSPACE_PANE_TAB_PROVIDER_BY_TYPE: Record<WorkspacePaneRuntimeTabType, WorkspacePaneRuntimeTabProvider> =
  {
    terminal: terminalWorkspacePaneTabProvider,
  }

export const workspacePaneTabProviders = [
  ...STATIC_WORKSPACE_PANE_TAB_PROVIDERS,
  ...RUNTIME_WORKSPACE_PANE_TAB_PROVIDERS,
] as const

export function workspacePaneStaticTabProviders(): readonly WorkspacePaneStaticTabProvider[] {
  return STATIC_WORKSPACE_PANE_TAB_PROVIDERS
}

export function workspacePaneStaticTabProvider(type: WorkspacePaneStaticTabType): WorkspacePaneStaticTabProvider {
  return STATIC_WORKSPACE_PANE_TAB_PROVIDER_BY_TYPE[type]
}

export function workspacePaneRuntimeTabProviders(): readonly WorkspacePaneRuntimeTabProvider[] {
  return RUNTIME_WORKSPACE_PANE_TAB_PROVIDERS
}

export function workspacePaneRuntimeTabProvider(type: WorkspacePaneRuntimeTabType): WorkspacePaneRuntimeTabProvider {
  return RUNTIME_WORKSPACE_PANE_TAB_PROVIDER_BY_TYPE[type]
}

export function workspacePaneTabProvider(type: WorkspacePaneTabType): WorkspacePaneTabProvider {
  if (isWorkspacePaneRuntimeTabType(type)) return workspacePaneRuntimeTabProvider(type)
  return workspacePaneStaticTabProvider(type)
}

export function isWorkspacePaneStaticTabProvider(
  provider: WorkspacePaneTabProvider,
): provider is WorkspacePaneStaticTabProvider {
  return provider.kind === 'static'
}

export function isWorkspacePaneRuntimeTabProvider(
  provider: WorkspacePaneTabProvider,
): provider is WorkspacePaneRuntimeTabProvider {
  return provider.kind === 'runtime'
}

function runtimeTabAvailability(
  context: WorkspacePaneTabAvailabilityContext,
  type: WorkspacePaneRuntimeTabType,
): WorkspacePaneRuntimeTabAvailability {
  const availability = context.runtimeTabAvailabilityByType?.[type]
  if (availability) return availability
  return {
    sessionCount: 0,
    createPending: false,
    projectionPhase: 'ready',
  }
}
