import type { AppNavigationActions } from '#/web/app-navigation-actions.ts'
import type { WorkspacePaneTabEntry, WorkspacePaneTabType } from '#/shared/workspace-pane.ts'
import {
  dispatchCloseCurrentWorkspacePaneTabAction,
  dispatchCloseWorkspacePaneTabAction,
  dispatchConfirmCloseTerminalWorkspacePaneTabAction,
  type ConfirmedTerminalWorkspacePaneTabClose,
} from '#/web/workspace-pane/workspace-pane-tab-close-action.ts'
import { dispatchRetiredTerminalWorkspacePaneTabPresentationAction } from '#/web/workspace-pane/workspace-pane-tab-close-presentation.ts'
import { dispatchOpenWorkspacePaneTargetStaticTabAction } from '#/web/workspace-pane/workspace-pane-tab-open-action.ts'
import {
  dispatchMoveWorkspacePaneTabAction,
  dispatchSelectWorkspacePaneTabByIndexAction,
} from '#/web/workspace-pane/workspace-pane-tab-select-action.ts'
import type { TerminalCreateTranslator } from '#/web/components/terminal/terminal-create-feedback.ts'
import { isWorkspacePaneStaticTabProvider, workspacePaneTabProvider } from '#/web/workspace-pane/tab-providers.ts'
import { workspacePaneActionOutcomeHandled } from '#/web/workspace-pane/workspace-pane-action-outcome.ts'
import {
  dispatchNewTerminalRuntimeTabAction,
  dispatchTerminalRuntimePrimaryAction,
} from '#/web/workspace-pane/workspace-pane-runtime-tab-command-actions.ts'
import type { ParsedWorkspacePaneRoute } from '#/web/App.tsx'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import {
  workspacePaneTabsTargetFromRuntime,
  type WorkspacePaneTabsTarget,
} from '#/shared/workspace-pane-tabs-target.ts'
import {
  workspacePaneCommandCoordinates,
  workspacePaneCommandPaneTarget,
  workspacePaneCommandRouteTarget,
  workspacePaneCommandRuntimeId,
  workspacePaneCommandTargetHasFilesystem,
  workspacePaneCommandWorktreeHead,
  type WorkspacePaneCommandTarget,
} from '#/web/workspace-pane/workspace-pane-command-target.ts'
import type { WorkspacePaneRuntimeTabSummary } from '#/web/workspace-pane/workspace-pane-tab-summary.ts'
import type { WorkspacePaneTabClosePresentationEffects } from '#/web/workspace-pane/workspace-pane-tab-close-presentation.ts'

type WorkspacePaneCommandRoute = ParsedWorkspacePaneRoute | null | undefined

interface ShowWorkspacePaneTabCommandOptions {
  workspaceId: WorkspaceId | null
  target: WorkspacePaneCommandTarget
  tab: WorkspacePaneTabType
  navigation: AppNavigationActions
}

interface TerminalPrimaryActionCommandOptions {
  workspaceId: WorkspaceId | null
  target: WorkspacePaneCommandTarget
  navigation: AppNavigationActions
  t?: TerminalCreateTranslator
}

interface NewTerminalTabCommandOptions {
  workspaceId: WorkspaceId | null
  target: WorkspacePaneCommandTarget
  navigation: AppNavigationActions
  t?: TerminalCreateTranslator
}

interface WorkspacePaneTabCommandTargetOptions {
  workspaceId: WorkspaceId | null
  target: WorkspacePaneCommandTarget
  navigation: AppNavigationActions
  targetIdentity?: string
}

interface CloseWorkspacePaneTabCommandOptions extends WorkspacePaneTabCommandTargetOptions {
  runtimeView?: WorkspacePaneRuntimeTabSummary
  selectedIdentity?: string | null
  skipTerminalCloseConfirm?: boolean
  skipRuntimeCloseConfirm?: boolean
  presentationEffects?: WorkspacePaneTabClosePresentationEffects
}

interface ConfirmCloseTerminalWorkspacePaneTabCommandOptions {
  workspaceId: WorkspaceId | null
  workspacePaneRoute: WorkspacePaneCommandRoute
  routeTarget: WorkspacePaneTabsTarget
  navigation: AppNavigationActions
  targetIdentity?: string
  selectedIdentity: string | null
  currentWorkspacePaneRoute: ParsedWorkspacePaneRoute | null
  confirmedTerminal: ConfirmedTerminalWorkspacePaneTabClose
  presentationEffects?: WorkspacePaneTabClosePresentationEffects
}

interface RetiredTerminalWorkspacePaneTabPresentationCommandOptions {
  target: WorkspacePaneCommandTarget
  navigation: AppNavigationActions
  terminalSessionId: string
  tabsBeforeRetirement: WorkspacePaneTabEntry[]
}

type CloseCurrentWorkspacePaneTabCommandOptions = Omit<CloseWorkspacePaneTabCommandOptions, 'targetIdentity'>

interface SelectWorkspacePaneTabByIndexCommandOptions {
  workspaceId: WorkspaceId | null
  target: WorkspacePaneCommandTarget
  tabIndex: number
  navigation: AppNavigationActions
}

interface MoveWorkspacePaneTabCommandOptions {
  workspaceId: WorkspaceId | null
  target: WorkspacePaneCommandTarget
  direction: 1 | -1
  navigation: AppNavigationActions
}

export async function runShowWorkspacePaneTabCommand({
  workspaceId,
  target,
  tab,
  navigation,
}: ShowWorkspacePaneTabCommandOptions): Promise<boolean> {
  return await showWorkspacePaneTabCommand({ workspaceId, target, tab, navigation })
}

async function showWorkspacePaneTabCommand({
  workspaceId,
  target,
  tab,
  navigation,
}: ShowWorkspacePaneTabCommandOptions): Promise<boolean> {
  if (!workspaceId) return false
  const { branchName, workspacePaneRoute } = workspacePaneCommandCoordinates(target)
  const provider = workspacePaneTabProvider(tab)
  if (isWorkspacePaneStaticTabProvider(provider)) {
    const outcome = await dispatchOpenWorkspacePaneTargetStaticTabAction({
      workspaceId,
      workspaceRuntimeId: workspacePaneCommandRuntimeId(target),
      routeTarget: workspacePaneCommandRouteTarget(target),
      paneTarget: workspacePaneCommandPaneTarget(target),
      worktreeHead: workspacePaneCommandWorktreeHead(target),
      type: provider.type,
      workspacePaneRoute,
      navigation,
    })
    return workspacePaneActionOutcomeHandled(outcome)
  }
  if (branchName === null) {
    return tab === 'terminal'
      ? await runTerminalPrimaryActionCommand({
          workspaceId,
          target,
          navigation,
        })
      : false
  }
  if (tab === 'terminal')
    return await runTerminalPrimaryActionCommand({
      workspaceId,
      target,
      navigation,
    })
  return false
}

export async function runTerminalPrimaryActionCommand(options: TerminalPrimaryActionCommandOptions): Promise<boolean> {
  const target = options.target
  if (!workspacePaneCommandTargetHasFilesystem(target)) return false
  return await dispatchTerminalRuntimePrimaryAction({
    target,
    currentWorkspaceId: options.workspaceId,
    navigation: options.navigation,
    t: options.t,
  })
}

export async function runNewTerminalTabCommand(options: NewTerminalTabCommandOptions): Promise<boolean> {
  const target = options.target
  if (!workspacePaneCommandTargetHasFilesystem(target)) return false
  return await dispatchNewTerminalRuntimeTabAction({
    target,
    currentWorkspaceId: options.workspaceId,
    navigation: options.navigation,
    t: options.t,
  })
}

export async function runCloseWorkspacePaneTabCommand(options: CloseWorkspacePaneTabCommandOptions): Promise<boolean> {
  const presentationEffects = options.presentationEffects
  if (!options.workspaceId) {
    presentationEffects?.onAbandon()
    return false
  }
  try {
    return dispatchCloseWorkspacePaneTabAction({
      ...options,
      workspaceRuntimeId: workspacePaneCommandRuntimeId(options.target),
      ...workspacePaneCommandCoordinates(options.target),
      routeTarget: workspacePaneCommandRouteTarget(options.target),
      paneTarget: workspacePaneCommandPaneTarget(options.target),
      worktreeHead: workspacePaneCommandWorktreeHead(options.target),
    })
  } catch (error) {
    presentationEffects?.onAbandon()
    throw error
  }
}

export async function runCloseCurrentWorkspacePaneTabCommand(
  options: CloseCurrentWorkspacePaneTabCommandOptions,
): Promise<boolean> {
  const presentationEffects = options.presentationEffects
  if (!options.workspaceId || options.target.workspacePaneRoute === null) {
    presentationEffects?.onAbandon()
    return false
  }
  try {
    return dispatchCloseCurrentWorkspacePaneTabAction({
      ...options,
      workspaceRuntimeId: workspacePaneCommandRuntimeId(options.target),
      ...workspacePaneCommandCoordinates(options.target),
      routeTarget: workspacePaneCommandRouteTarget(options.target),
      paneTarget: workspacePaneCommandPaneTarget(options.target),
      worktreeHead: workspacePaneCommandWorktreeHead(options.target),
    })
  } catch (error) {
    presentationEffects?.onAbandon()
    throw error
  }
}

export async function runConfirmCloseTerminalWorkspacePaneTabCommand(
  options: ConfirmCloseTerminalWorkspacePaneTabCommandOptions,
): Promise<boolean> {
  const presentationEffects = options.presentationEffects
  try {
    const paneTarget = workspacePaneTabsTargetFromRuntime(options.confirmedTerminal.base.target)
    if (!paneTarget) {
      presentationEffects?.onAbandon()
      return false
    }
    return dispatchConfirmCloseTerminalWorkspacePaneTabAction({
      ...options,
      workspaceRuntimeId: options.confirmedTerminal.base.target.workspaceRuntimeId,
      paneTarget,
      worktreeHead: undefined,
    })
  } catch (error) {
    presentationEffects?.onAbandon()
    throw error
  }
}

export function runRetiredTerminalWorkspacePaneTabPresentationCommand(
  options: RetiredTerminalWorkspacePaneTabPresentationCommandOptions,
): Promise<boolean> {
  const routeTarget = workspacePaneCommandRouteTarget(options.target)
  return dispatchRetiredTerminalWorkspacePaneTabPresentationAction({
    ...options,
    workspaceRuntimeId: workspacePaneCommandRuntimeId(options.target),
    workspaceId: routeTarget.workspaceId,
    ...workspacePaneCommandCoordinates(options.target),
    routeTarget,
    paneTarget: workspacePaneCommandPaneTarget(options.target),
    worktreeHead: workspacePaneCommandWorktreeHead(options.target),
  })
}

export async function runSelectWorkspacePaneTabByIndexCommand(
  options: SelectWorkspacePaneTabByIndexCommandOptions,
): Promise<boolean> {
  if (!options.workspaceId) return false
  return await dispatchSelectWorkspacePaneTabByIndexAction({
    ...options,
    workspaceRuntimeId: workspacePaneCommandRuntimeId(options.target),
    routeTarget: workspacePaneCommandRouteTarget(options.target),
    paneTarget: workspacePaneCommandPaneTarget(options.target),
    worktreeHead: workspacePaneCommandWorktreeHead(options.target),
    workspacePaneRoute: options.target.workspacePaneRoute,
  })
}

export async function runMoveWorkspacePaneTabCommand(options: MoveWorkspacePaneTabCommandOptions): Promise<boolean> {
  if (!options.workspaceId) return false
  return await dispatchMoveWorkspacePaneTabAction({
    ...options,
    workspaceRuntimeId: workspacePaneCommandRuntimeId(options.target),
    routeTarget: workspacePaneCommandRouteTarget(options.target),
    paneTarget: workspacePaneCommandPaneTarget(options.target),
    worktreeHead: workspacePaneCommandWorktreeHead(options.target),
    workspacePaneRoute: options.target.workspacePaneRoute,
  })
}
