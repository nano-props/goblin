import type { PrimaryWindowNavigationActions } from '#/web/primary-window-navigation.tsx'
import { workspacePaneTabEntryIdentity, type WorkspacePaneTabType } from '#/shared/workspace-pane.ts'
import {
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
import {
  resolveWorkspacePaneTabTargetForBranch,
  workspacePaneTabTargetForWorkspace,
} from '#/web/workspace-pane/workspace-pane-tab-target.ts'
import type { ParsedWorkspacePaneRoute } from '#/web/App.tsx'
import { workspacePaneTabsTargetFromRuntime } from '#/shared/workspace-pane-tabs-target.ts'
import {
  workspacePaneCommandCoordinates,
  workspacePaneCommandPaneTarget,
  workspacePaneCommandWorktreeHead,
  type WorkspacePaneCommandTarget,
} from '#/web/workspace-pane/workspace-pane-command-target.ts'
import { workspacePaneTabTargetForPaneTarget } from '#/web/workspace-pane/workspace-pane-tab-target.ts'
import type { WorkspacePaneRuntimeTabSummary } from '#/web/workspace-pane/workspace-pane-tab-summary.ts'

type WorkspacePaneCommandRoute = ParsedWorkspacePaneRoute | null | undefined

interface ShowWorkspacePaneTabCommandOptions {
  workspaceId: string | null
  target: WorkspacePaneCommandTarget
  tab: WorkspacePaneTabType
  navigation: PrimaryWindowNavigationActions
}

interface TerminalPrimaryActionCommandOptions {
  workspaceId: string | null
  target: WorkspacePaneCommandTarget
  navigation: PrimaryWindowNavigationActions
  t?: TerminalCreateTranslator
}

interface NewTerminalTabCommandOptions {
  workspaceId: string | null
  target: WorkspacePaneCommandTarget
  navigation: PrimaryWindowNavigationActions
  t?: TerminalCreateTranslator
}

interface WorkspacePaneTabCommandTargetOptions {
  workspaceId: string | null
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
  workspaceId: string | null
  workspacePaneRoute: WorkspacePaneCommandRoute
  navigation: PrimaryWindowNavigationActions
  targetIdentity?: string
  selectedIdentity: string | null
  currentWorkspacePaneRoute: ParsedWorkspacePaneRoute | null
  confirmedTerminal: ConfirmedTerminalWorkspacePaneTabClose
}

type CloseWorkspacePaneTabOrWindowCommandOptions = Omit<CloseWorkspacePaneTabCommandOptions, 'target'> & {
  target: WorkspacePaneCommandTarget | null
  closeWindow?: () => void
}

type CloseWorkspaceSurfaceIntent =
  | { kind: 'close-tab'; targetIdentity: string; selectedIdentity: string | null }
  | { kind: 'close-window' }
  | { kind: 'noop' }

interface SelectWorkspacePaneTabByIndexCommandOptions {
  workspaceId: string | null
  target: WorkspacePaneCommandTarget
  tabIndex: number
  navigation: PrimaryWindowNavigationActions
}

interface MoveWorkspacePaneTabCommandOptions {
  workspaceId: string | null
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

export async function runCloseWorkspacePaneTabOrWindowCommand({
  closeWindow = () => window.close(),
  ...options
}: CloseWorkspacePaneTabOrWindowCommandOptions): Promise<boolean> {
  const intent = resolveCloseWorkspaceSurfaceIntent(options)
  if (intent.kind === 'noop') return true
  if (intent.kind === 'close-window') {
    closeWindow()
    return true
  }
  if (
    options.target &&
    (await runCloseWorkspacePaneTabCommand({
      ...options,
      target: options.target,
      targetIdentity: intent.targetIdentity,
      selectedIdentity: intent.selectedIdentity,
    }))
  )
    return true
  return true
}

export async function runSelectWorkspacePaneTabByIndexCommand(
  options: SelectWorkspacePaneTabByIndexCommandOptions,
): Promise<boolean> {
  if (!options.workspaceId) return false
  return await dispatchSelectWorkspacePaneTabByIndexAction({
    ...options,
    paneTarget: workspacePaneCommandPaneTarget(options.workspaceId, options.target),
    worktreeHead: workspacePaneCommandWorktreeHead(options.target),
    workspacePaneRoute: options.target.workspacePaneRoute,
  })
}

export async function runMoveWorkspacePaneTabCommand(options: MoveWorkspacePaneTabCommandOptions): Promise<boolean> {
  if (!options.workspaceId) return false
  return await dispatchMoveWorkspacePaneTabAction({
    ...options,
    paneTarget: workspacePaneCommandPaneTarget(options.workspaceId, options.target),
    worktreeHead: workspacePaneCommandWorktreeHead(options.target),
    workspacePaneRoute: options.target.workspacePaneRoute,
  })
}

function resolveCloseWorkspaceSurfaceIntent(
  options: CloseWorkspacePaneTabOrWindowCommandOptions,
): CloseWorkspaceSurfaceIntent {
  const { workspaceId, targetIdentity, target: commandTarget } = options
  if (!workspaceId) return { kind: 'close-window' }
  if (!commandTarget) return { kind: 'close-window' }
  const branchName = workspacePaneCommandCoordinates(commandTarget).branchName
  const branchResolution = branchName
    ? resolveWorkspacePaneTabTargetForBranch(workspaceId, branchName, {
        workspacePaneRoute: commandTarget.workspacePaneRoute,
      })
    : null
  if (branchResolution?.kind === 'unavailable') return { kind: 'noop' }
  const target = branchResolution
    ? branchResolution.kind === 'ready'
      ? branchResolution.target
      : null
    : commandTarget.kind === 'workspace-root'
      ? workspacePaneTabTargetForWorkspace(workspaceId)
      : workspacePaneTabTargetForPaneTarget(
          workspacePaneCommandPaneTarget(workspaceId, commandTarget),
          commandTarget.workspacePaneRoute,
          workspacePaneCommandWorktreeHead(commandTarget),
        )
  if (!target) return { kind: 'close-window' }
  if (targetIdentity) {
    return target.tabEntries.some((entry) => workspacePaneTabEntryIdentity(entry) === targetIdentity)
      ? { kind: 'close-tab', targetIdentity, selectedIdentity: target.selectedIdentity }
      : { kind: 'noop' }
  }
  if (target.selectedEntry && target.selectedIdentity) {
    return {
      kind: 'close-tab',
      targetIdentity: target.selectedIdentity,
      selectedIdentity: target.selectedIdentity,
    }
  }
  if (target.selection?.kind === 'runtime-host') return { kind: 'noop' }
  return { kind: 'close-window' }
}
