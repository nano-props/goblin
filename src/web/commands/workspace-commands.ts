import type { PrimaryWindowNavigationActions } from '#/web/primary-window-navigation.tsx'
import type { WorkspacePaneTabType } from '#/shared/workspace-pane.ts'
import {
  dispatchCloseCurrentWorkspacePaneTabAction,
  dispatchCloseWorkspacePaneTabAction,
  dispatchConfirmCloseTerminalWorkspacePaneTabAction,
  type ConfirmedTerminalWorkspacePaneTabClose,
} from '#/web/workspace-pane/workspace-pane-tab-close-action.ts'
import { dispatchOpenWorkspacePaneTargetStaticTabAction } from '#/web/workspace-pane/workspace-pane-tab-open-action.ts'
import {
  dispatchMoveWorkspacePaneTabAction,
  dispatchSelectWorkspacePaneTabByIdentityAction,
  dispatchSelectWorkspacePaneTabByIndexAction,
} from '#/web/workspace-pane/workspace-pane-tab-select-action.ts'
import type { TerminalCreateTranslator } from '#/web/components/terminal/terminal-create-feedback.ts'
import type { WorkspacePaneFilesystemTarget } from '#/web/workspace-pane/workspace-pane-filesystem-target.ts'
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
  workspacePaneCommandWorktreeHead,
  type WorkspacePaneCommandTarget,
} from '#/web/workspace-pane/workspace-pane-command-target.ts'
import type { WorkspacePaneRuntimeTabSummary } from '#/web/workspace-pane/workspace-pane-tab-summary.ts'

type WorkspacePaneCommandRoute = ParsedWorkspacePaneRoute | null | undefined

interface ShowWorkspacePaneTabCommandOptions {
  workspaceId: WorkspaceId | null
  target: WorkspacePaneCommandTarget
  tab: WorkspacePaneTabType
  navigation: PrimaryWindowNavigationActions
}

interface TerminalPrimaryActionCommandOptions {
  workspaceId: WorkspaceId | null
  target: WorkspacePaneCommandTarget
  navigation: PrimaryWindowNavigationActions
  t?: TerminalCreateTranslator
}

interface NewTerminalTabCommandOptions {
  workspaceId: WorkspaceId | null
  target: WorkspacePaneCommandTarget
  navigation: PrimaryWindowNavigationActions
  t?: TerminalCreateTranslator
}

interface WorkspacePaneTabCommandTargetOptions {
  workspaceId: WorkspaceId | null
  target: WorkspacePaneCommandTarget
  navigation: PrimaryWindowNavigationActions
  targetIdentity?: string
}

interface CloseWorkspacePaneTabCommandOptions extends WorkspacePaneTabCommandTargetOptions {
  runtimeView?: WorkspacePaneRuntimeTabSummary
  selectedIdentity?: string | null
  skipTerminalCloseConfirm?: boolean
  skipRuntimeCloseConfirm?: boolean
}

interface ConfirmCloseTerminalWorkspacePaneTabCommandOptions {
  workspaceId: WorkspaceId | null
  workspacePaneRoute: WorkspacePaneCommandRoute
  routeTarget: WorkspacePaneTabsTarget
  navigation: PrimaryWindowNavigationActions
  targetIdentity?: string
  selectedIdentity: string | null
  currentWorkspacePaneRoute: ParsedWorkspacePaneRoute | null
  confirmedTerminal: ConfirmedTerminalWorkspacePaneTabClose
}

type CloseCurrentWorkspacePaneTabCommandOptions = Omit<CloseWorkspacePaneTabCommandOptions, 'targetIdentity'>

interface SelectWorkspacePaneTabByIndexCommandOptions {
  workspaceId: WorkspaceId | null
  target: WorkspacePaneCommandTarget
  tabIndex: number
  navigation: PrimaryWindowNavigationActions
}

interface MoveWorkspacePaneTabCommandOptions {
  workspaceId: WorkspaceId | null
  target: WorkspacePaneCommandTarget
  direction: 1 | -1
  navigation: PrimaryWindowNavigationActions
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
  const { branchName, filesystemTarget, workspacePaneRoute } = workspacePaneCommandCoordinates(target)
  const provider = workspacePaneTabProvider(tab)
  if (isWorkspacePaneStaticTabProvider(provider)) {
    const outcome = await dispatchOpenWorkspacePaneTargetStaticTabAction({
      workspaceId,
      routeTarget: workspacePaneCommandRouteTarget(target),
      paneTarget: workspacePaneCommandPaneTarget(workspaceId, target),
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
  const coordinates = workspacePaneCommandCoordinates(options.target)
  return coordinates.filesystemTarget
    ? await dispatchTerminalRuntimePrimaryAction({
        ...options,
        ...coordinates,
        filesystemTarget: coordinates.filesystemTarget,
      })
    : coordinates.branchName
      ? await dispatchTerminalRuntimePrimaryAction({
          ...options,
          ...coordinates,
          branchName: coordinates.branchName,
          filesystemTarget: null,
        })
      : false
}

export async function runNewTerminalTabCommand(options: NewTerminalTabCommandOptions): Promise<boolean> {
  const coordinates = workspacePaneCommandCoordinates(options.target)
  return coordinates.filesystemTarget
    ? await dispatchNewTerminalRuntimeTabAction({
        ...options,
        ...coordinates,
        filesystemTarget: coordinates.filesystemTarget,
      })
    : coordinates.branchName
      ? await dispatchNewTerminalRuntimeTabAction({
          ...options,
          ...coordinates,
          branchName: coordinates.branchName,
          filesystemTarget: null,
        })
      : false
}

export async function runCloseWorkspacePaneTabCommand(options: CloseWorkspacePaneTabCommandOptions): Promise<boolean> {
  if (!options.workspaceId) return false
  return await dispatchCloseWorkspacePaneTabAction({
    ...options,
    ...workspacePaneCommandCoordinates(options.target),
    routeTarget: workspacePaneCommandRouteTarget(options.target),
    paneTarget: workspacePaneCommandPaneTarget(options.workspaceId, options.target),
    worktreeHead: workspacePaneCommandWorktreeHead(options.target),
  })
}

export async function runCloseCurrentWorkspacePaneTabCommand(
  options: CloseCurrentWorkspacePaneTabCommandOptions,
): Promise<boolean> {
  if (!options.workspaceId) return false
  if (options.target.workspacePaneRoute === null) return false
  return await dispatchCloseCurrentWorkspacePaneTabAction({
    ...options,
    ...workspacePaneCommandCoordinates(options.target),
    routeTarget: workspacePaneCommandRouteTarget(options.target),
    paneTarget: workspacePaneCommandPaneTarget(options.workspaceId, options.target),
    worktreeHead: workspacePaneCommandWorktreeHead(options.target),
  })
}

export async function runConfirmCloseTerminalWorkspacePaneTabCommand(
  options: ConfirmCloseTerminalWorkspacePaneTabCommandOptions,
): Promise<boolean> {
  const paneTarget = workspacePaneTabsTargetFromRuntime(options.confirmedTerminal.base.target)
  if (!paneTarget) return false
  return await dispatchConfirmCloseTerminalWorkspacePaneTabAction({
    ...options,
    paneTarget,
    worktreeHead:
      options.confirmedTerminal.base.presentation.kind === 'git-worktree'
        ? options.confirmedTerminal.base.presentation.head
        : undefined,
  })
}

export async function runSelectWorkspacePaneTabByIndexCommand(
  options: SelectWorkspacePaneTabByIndexCommandOptions,
): Promise<boolean> {
  if (!options.workspaceId) return false
  return await dispatchSelectWorkspacePaneTabByIndexAction({
    ...options,
    routeTarget: workspacePaneCommandRouteTarget(options.target),
    paneTarget: workspacePaneCommandPaneTarget(options.workspaceId, options.target),
    worktreeHead: workspacePaneCommandWorktreeHead(options.target),
    workspacePaneRoute: options.target.workspacePaneRoute,
  })
}

export async function runMoveWorkspacePaneTabCommand(options: MoveWorkspacePaneTabCommandOptions): Promise<boolean> {
  if (!options.workspaceId) return false
  return await dispatchMoveWorkspacePaneTabAction({
    ...options,
    routeTarget: workspacePaneCommandRouteTarget(options.target),
    paneTarget: workspacePaneCommandPaneTarget(options.workspaceId, options.target),
    worktreeHead: workspacePaneCommandWorktreeHead(options.target),
    workspacePaneRoute: options.target.workspacePaneRoute,
  })
}
