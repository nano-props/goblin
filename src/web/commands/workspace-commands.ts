import type { PrimaryWindowNavigationActions } from '#/web/primary-window-navigation.tsx'
import type { WorkspacePaneTabType } from '#/shared/workspace-pane.ts'
import {
  dispatchCloseWorkspacePaneTabAction,
  dispatchConfirmCloseTerminalWorkspacePaneTabAction,
  type ConfirmedTerminalWorkspacePaneTabClose,
} from '#/web/workspace-pane/workspace-pane-tab-close-action.ts'
import { dispatchShowWorkspacePaneStaticTabAction } from '#/web/workspace-pane/workspace-pane-tab-open-action.ts'
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
import { resolveWorkspacePaneTabTargetForBranch } from '#/web/workspace-pane/workspace-pane-tab-target.ts'
import type { ParsedRepoBranchWorkspacePaneRoute } from '#/web/App.tsx'

type WorkspacePaneCommandRoute = ParsedRepoBranchWorkspacePaneRoute | null | undefined

interface ShowWorkspacePaneTabCommandOptions {
  repoId: string | null
  branchName: string | null
  workspacePaneRoute: WorkspacePaneCommandRoute
  tab: WorkspacePaneTabType
  navigation: PrimaryWindowNavigationActions
}

interface TerminalPrimaryActionCommandOptions {
  repoId: string | null
  branchName: string | null
  workspacePaneRoute: WorkspacePaneCommandRoute
  navigation: PrimaryWindowNavigationActions
  t?: TerminalCreateTranslator
}

interface NewTerminalTabCommandOptions {
  repoId: string | null
  branchName: string | null
  workspacePaneRoute: WorkspacePaneCommandRoute
  navigation: PrimaryWindowNavigationActions
  t?: TerminalCreateTranslator
}

interface WorkspacePaneTabCommandTargetOptions {
  repoId: string | null
  branchName: string | null
  workspacePaneRoute: WorkspacePaneCommandRoute
  navigation: PrimaryWindowNavigationActions
  targetIdentity?: string
}

interface CloseWorkspacePaneTabCommandOptions extends WorkspacePaneTabCommandTargetOptions {
  skipTerminalCloseConfirm?: boolean
  skipRuntimeCloseConfirm?: boolean
}

interface ConfirmCloseTerminalWorkspacePaneTabCommandOptions extends WorkspacePaneTabCommandTargetOptions {
  currentRepoId: string | null
  currentBranchName: string | null
  currentWorkspacePaneRoute: ParsedRepoBranchWorkspacePaneRoute | null
  confirmedTerminal: ConfirmedTerminalWorkspacePaneTabClose
}

type CloseWorkspacePaneTabOrWindowCommandOptions = CloseWorkspacePaneTabCommandOptions & {
  closeWindow?: () => void
}

type CloseWorkspaceSurfaceIntent = { kind: 'close-tab' } | { kind: 'close-window' } | { kind: 'noop' }

interface SelectWorkspacePaneTabByIndexCommandOptions {
  repoId: string | null
  branchName: string | null
  workspacePaneRoute: WorkspacePaneCommandRoute
  tabIndex: number
  navigation: PrimaryWindowNavigationActions
}

interface MoveWorkspacePaneTabCommandOptions {
  repoId: string | null
  branchName: string | null
  workspacePaneRoute: WorkspacePaneCommandRoute
  direction: 1 | -1
  navigation: PrimaryWindowNavigationActions
}

export async function runShowWorkspacePaneTabCommand({
  repoId,
  branchName,
  workspacePaneRoute,
  tab,
  navigation,
}: ShowWorkspacePaneTabCommandOptions): Promise<boolean> {
  return await showWorkspacePaneTabCommand({ repoId, branchName, workspacePaneRoute, tab, navigation })
}

async function showWorkspacePaneTabCommand({
  repoId,
  branchName,
  workspacePaneRoute,
  tab,
  navigation,
}: ShowWorkspacePaneTabCommandOptions): Promise<boolean> {
  if (!repoId || !branchName) return false
  const provider = workspacePaneTabProvider(tab)
  if (isWorkspacePaneStaticTabProvider(provider)) {
    const outcome = await dispatchShowWorkspacePaneStaticTabAction({
      repoId,
      branchName,
      type: provider.type,
      workspacePaneRoute,
      navigation,
    })
    return workspacePaneActionOutcomeHandled(outcome)
  }
  if (tab === 'terminal')
    return await runTerminalPrimaryActionCommand({ repoId, branchName, workspacePaneRoute, navigation })
  return false
}

export async function runTerminalPrimaryActionCommand(options: TerminalPrimaryActionCommandOptions): Promise<boolean> {
  return await dispatchTerminalRuntimePrimaryAction(options)
}

export async function runNewTerminalTabCommand(options: NewTerminalTabCommandOptions): Promise<boolean> {
  return await dispatchNewTerminalRuntimeTabAction(options)
}

export async function runCloseWorkspacePaneTabCommand(options: CloseWorkspacePaneTabCommandOptions): Promise<boolean> {
  return await dispatchCloseWorkspacePaneTabAction(options)
}

export async function runConfirmCloseTerminalWorkspacePaneTabCommand(
  options: ConfirmCloseTerminalWorkspacePaneTabCommandOptions,
): Promise<boolean> {
  return await dispatchConfirmCloseTerminalWorkspacePaneTabAction(options)
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
  if (await runCloseWorkspacePaneTabCommand(options)) return true
  return true
}

export async function runSelectWorkspacePaneTabByIndexCommand(
  options: SelectWorkspacePaneTabByIndexCommandOptions,
): Promise<boolean> {
  return await dispatchSelectWorkspacePaneTabByIndexAction(options)
}

export async function runMoveWorkspacePaneTabCommand(options: MoveWorkspacePaneTabCommandOptions): Promise<boolean> {
  return await dispatchMoveWorkspacePaneTabAction(options)
}

function resolveCloseWorkspaceSurfaceIntent(options: CloseWorkspacePaneTabCommandOptions): CloseWorkspaceSurfaceIntent {
  const { repoId, targetIdentity } = options
  if (!repoId) return { kind: 'close-window' }
  if (!options.branchName) return { kind: 'close-window' }
  const resolution = resolveWorkspacePaneTabTargetForBranch(repoId, options.branchName, {
    workspacePaneRoute: options.workspacePaneRoute,
  })
  if (resolution.kind === 'unavailable') return { kind: 'noop' }
  const target = resolution.kind === 'ready' ? resolution.target : null
  if (!target) return { kind: 'close-window' }
  if (targetIdentity) {
    return target.tabs.some((candidate) => candidate.identity === targetIdentity)
      ? { kind: 'close-tab' }
      : { kind: 'noop' }
  }
  if (target.activeTab) return { kind: 'close-tab' }
  if (target.selection?.kind === 'runtime-host') return { kind: 'noop' }
  return { kind: 'close-window' }
}
