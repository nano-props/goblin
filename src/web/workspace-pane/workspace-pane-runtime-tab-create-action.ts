import { terminalSessionBase, type TerminalPresentation, type TerminalSessionBase } from '#/shared/terminal-types.ts'
import type { WorkspacePaneRuntimeTabType } from '#/shared/workspace-pane.ts'
import type { WorkspacePaneRuntimeTabPlacement } from '#/shared/workspace-pane-runtime.ts'
import {
  runCreateTerminalTabCommand,
  type TerminalCreateCommandAdmission,
  type TerminalCreateCommandResult,
  type TerminalCreatedTabCommitResult,
} from '#/web/commands/terminal-create-command.ts'
import type { TerminalCreateAdmissionResult } from '#/web/terminal/components/terminal-create-admission.ts'
import {
  showTerminalCreateErrorToast,
  type TerminalCreateTranslator,
} from '#/web/terminal/components/terminal-create-feedback.ts'
import type { TerminalCreateOptions, TerminalFocusRequest } from '#/web/terminal/components/types.ts'
import {
  filesystemWorkspacePaneLocationIsCurrent,
  resolveWorkspacePaneTabTargetForPaneTarget,
} from '#/web/workspace-pane/workspace-pane-tab-target.ts'
import { runWorkspacePaneAction } from '#/web/workspace-pane/workspace-pane-action-queue.ts'
import { recordWorkspacePaneTabOpener } from '#/web/workspace-pane/workspace-pane-tab-opener.ts'
import { terminalWorkspacePaneTabProvider } from '#/web/workspace-pane/tab-providers.ts'
import { beginAppNavigation, type AppNavigationGeneration } from '#/web/app/navigation/lifecycle.ts'
import { claimTerminalAutoFocus } from '#/web/terminal/focus.ts'
import type { AppNavigationActions } from '#/web/app/navigation/actions.ts'
import { workspacePaneRuntimeTabCreateBlockingPhase } from '#/web/workspace-pane/workspace-pane-tab-model.ts'
import type { WorkspacePaneRuntimeUnreadyProjectionPhase } from '#/web/workspace-pane/workspace-pane-runtime-state.ts'
import {
  workspacePaneLocationTerminalBase,
  workspacePaneLocationTerminalBaseMatches,
  type FilesystemWorkspacePaneLocation,
} from '#/web/workspace-pane/workspace-pane-location.ts'

export interface CreatedTerminalRouteRequest {
  navigationGeneration: AppNavigationGeneration
  routePrecondition: { kind: 'current-workspace-target' }
}

export type CreatedTerminalNavigation = Pick<AppNavigationActions, 'commitFilesystemWorkspacePaneRoute'>

export interface WorkspacePaneRuntimeTabCreateAction {
  label: string
  busy: boolean
  blocksTabInteraction: boolean
  onCreate: () => void
}

export interface WorkspacePaneRuntimeTabCreateActionContext {
  runtimeTabStateByType: WorkspacePaneRuntimeTabCreateStateByType
  showCreatedRuntimeTab: (
    type: WorkspacePaneRuntimeTabType,
    sessionId: string,
    presentation: TerminalPresentation,
    routeRequest: CreatedTerminalRouteRequest,
  ) => boolean | Promise<boolean>
  t: TerminalCreateTranslator
  terminal?: WorkspacePaneTerminalCreateActionContext
}

export type WorkspacePaneRuntimeTabCreateStateByType = Record<WorkspacePaneRuntimeTabType, { createPending: boolean }>

export interface WorkspacePaneTerminalCreateActionContext {
  location: FilesystemWorkspacePaneLocation
  createTerminal: (
    base: TerminalSessionBase,
    options?: TerminalCreateOptions,
    placement?: WorkspacePaneRuntimeTabPlacement,
  ) => Promise<TerminalCreateCommandAdmission>
  captureOpenerIdentity: () => string | null
  focusTerminal: (terminalSessionId: string, request?: TerminalFocusRequest) => boolean
}

export interface CreateTerminalWorkspacePaneRuntimeTabActionOptions {
  location: FilesystemWorkspacePaneLocation
  createTerminal: (
    base: TerminalSessionBase,
    options?: TerminalCreateOptions,
    placement?: WorkspacePaneRuntimeTabPlacement,
  ) => Promise<TerminalCreateCommandAdmission>
  openerIdentity: string | null
  showCreatedTerminalTab: (
    terminalSessionId: string,
    presentation: TerminalPresentation,
    routeRequest: CreatedTerminalRouteRequest,
  ) => boolean | Promise<boolean>
  focusTerminal: (terminalSessionId: string, request?: TerminalFocusRequest) => boolean
  insertAfterIdentity?: string | null
  options?: TerminalCreateOptions
  t?: TerminalCreateTranslator
  logMessage?: string
}

export interface CommitCreatedTerminalWorkspacePaneRuntimeTabOptions {
  location: FilesystemWorkspacePaneLocation
  base: TerminalSessionBase
  admission: TerminalCreateAdmissionResult
  openerIdentity: string | null
  showCreatedTerminalTab: (terminalSessionId: string, presentation: TerminalPresentation) => boolean | Promise<boolean>
}

interface WorkspacePaneRuntimeTabCreateActionResolver {
  resolve: (context: WorkspacePaneRuntimeTabCreateActionContext) => WorkspacePaneRuntimeTabCreateAction | null
}

const WORKSPACE_PANE_RUNTIME_TAB_CREATE_ACTION_RESOLVERS_BY_TYPE: Record<
  WorkspacePaneRuntimeTabType,
  WorkspacePaneRuntimeTabCreateActionResolver
> = {
  terminal: {
    resolve: terminalRuntimeTabCreateAction,
  },
}

export function workspacePaneRuntimeTabCreateAction(
  type: WorkspacePaneRuntimeTabType,
  context: WorkspacePaneRuntimeTabCreateActionContext,
): WorkspacePaneRuntimeTabCreateAction | null {
  return WORKSPACE_PANE_RUNTIME_TAB_CREATE_ACTION_RESOLVERS_BY_TYPE[type].resolve(context)
}

export async function dispatchCreateTerminalWorkspacePaneRuntimeTabAction(
  options: CreateTerminalWorkspacePaneRuntimeTabActionOptions,
): Promise<TerminalCreateCommandResult> {
  const base = workspacePaneLocationTerminalBase(options.location)
  if (!terminalCreateTargetIsCurrent(options.location, base)) return staleTerminalCreateResult()
  return runWorkspacePaneAction(options.location, async () => {
    const admission = terminalCreateAdmission(options.location, base)
    if (admission === 'stale') return staleTerminalCreateResult()
    if (admission !== 'ready') return blockedTerminalCreateResult(admission, options.t)
    // Presentation is deliberately best-effort across unrelated navigation.
    // Starting this queued create may supersede a navigation that has begun but
    // has not settled yet. Once the router has actually left this filesystem
    // target, the route precondition below rejects the stale presentation. Do
    // not add batch or navigation-lineage state for this recoverable UI race.
    const navigationGeneration = beginAppNavigation()
    let ownedFocusLease = claimTerminalAutoFocus(navigationGeneration)
    try {
      return await runCreateTerminalTabCommand({
        base,
        createTerminal: options.createTerminal,
        options: options.options,
        insertAfterIdentity: options.insertAfterIdentity,
        t: options.t,
        logMessage: options.logMessage,
        commitCreatedTerminalTab: (admission) =>
          commitCreatedTerminalWorkspacePaneRuntimeTab({
            location: options.location,
            base,
            admission,
            openerIdentity: options.openerIdentity,
            showCreatedTerminalTab: async (terminalSessionId, presentation) => {
              const accepted = await options.showCreatedTerminalTab(terminalSessionId, presentation, {
                navigationGeneration,
                routePrecondition: { kind: 'current-workspace-target' },
              })
              if (accepted) ownedFocusLease?.commit(terminalSessionId, options.focusTerminal)
              else ownedFocusLease?.release()
              ownedFocusLease = null
              return accepted
            },
          }),
      })
    } finally {
      ownedFocusLease?.release()
    }
  })
}

export function showCreatedTerminalWorkspacePaneRuntimeTab(
  location: FilesystemWorkspacePaneLocation,
  presentation: TerminalPresentation,
  terminalSessionId: string,
  navigation: CreatedTerminalNavigation,
  routeRequest: CreatedTerminalRouteRequest,
): boolean | Promise<boolean> {
  const base = workspacePaneLocationTerminalBase(location)
  if (base.presentation.kind !== presentation.kind) return false
  return navigation.commitFilesystemWorkspacePaneRoute(location, { kind: 'terminal', terminalSessionId }, routeRequest)
}

export async function commitCreatedTerminalWorkspacePaneRuntimeTab(
  options: CommitCreatedTerminalWorkspacePaneRuntimeTabOptions,
): Promise<TerminalCreatedTabCommitResult> {
  const canonicalBase = terminalSessionBase(options.base.target, options.admission.presentation)
  const canonicalOptions = { ...options, base: canonicalBase }
  if (
    !options.admission.runtimeProjectionApplied ||
    !terminalCreateTargetIsCurrent(canonicalOptions.location, canonicalOptions.base)
  ) {
    return { status: 'superseded' }
  }
  recordCreatedTerminalWorkspacePaneRuntimeTabOpener(canonicalOptions)
  const navigationCommitted = await options.showCreatedTerminalTab(
    options.admission.terminalSessionId,
    options.admission.presentation,
  )
  return navigationCommitted ? { status: 'committed' } : { status: 'navigation-rejected' }
}

function recordCreatedTerminalWorkspacePaneRuntimeTabOpener(
  options: CommitCreatedTerminalWorkspacePaneRuntimeTabOptions,
): void {
  const ownsCreatedResource =
    options.admission.requestRole === 'leader' && options.admission.resourceDisposition === 'created'
  if (!options.openerIdentity || !ownsCreatedResource) return
  recordWorkspacePaneTabOpener(
    options.location.paneTarget,
    options.location.workspaceRuntimeId,
    terminalWorkspacePaneTabProvider.identity(options.admission.terminalSessionId),
    options.openerIdentity,
  )
}

function terminalCreateTargetIsCurrent(location: FilesystemWorkspacePaneLocation, base: TerminalSessionBase): boolean {
  return filesystemWorkspacePaneLocationIsCurrent(location) && workspacePaneLocationTerminalBaseMatches(location, base)
}

function terminalCreateAdmission(
  location: FilesystemWorkspacePaneLocation,
  base: TerminalSessionBase,
): 'ready' | 'stale' | WorkspacePaneRuntimeUnreadyProjectionPhase {
  if (!terminalCreateTargetIsCurrent(location, base)) return 'stale'
  const resolution = resolveWorkspacePaneTabTargetForPaneTarget({
    location,
    workspacePaneRoute: undefined,
  })
  if (resolution.kind === 'missing') return 'stale'
  if (resolution.kind === 'unavailable') {
    return resolution.reason === 'workspace-pane-tabs-failed' ? 'failed' : 'pending'
  }
  return workspacePaneRuntimeTabCreateBlockingPhase(resolution.target, 'terminal') ?? 'ready'
}

function staleTerminalCreateResult(): TerminalCreateCommandResult {
  const error = new Error('error.workspace-runtime-stale')
  return { ok: false, error, messageKey: 'error.terminal-create-failed' }
}

function blockedTerminalCreateResult(
  phase: WorkspacePaneRuntimeUnreadyProjectionPhase,
  t: TerminalCreateTranslator | undefined,
): TerminalCreateCommandResult {
  const messageKey =
    phase === 'failed' ? 'error.terminal-create-blocked-load-failed' : 'error.terminal-create-blocked-loading'
  const error = new Error(messageKey)
  if (t) showTerminalCreateErrorToast(error, t)
  return { ok: false, error, messageKey }
}

function terminalRuntimeTabCreateAction(
  context: WorkspacePaneRuntimeTabCreateActionContext,
): WorkspacePaneRuntimeTabCreateAction | null {
  const terminal = context.terminal
  if (!terminal) return null
  return {
    label: context.t('terminal.new'),
    busy: context.runtimeTabStateByType.terminal.createPending,
    blocksTabInteraction: context.runtimeTabStateByType.terminal.createPending,
    onCreate: () => {
      if (context.runtimeTabStateByType.terminal.createPending) return
      // "+" is a generic entry; opener only drives close-back focus, not insertion.
      const openerIdentity = terminal.captureOpenerIdentity()
      void dispatchCreateTerminalWorkspacePaneRuntimeTabAction({
        location: terminal.location,
        createTerminal: terminal.createTerminal,
        openerIdentity,
        showCreatedTerminalTab: (terminalSessionId, presentation, routeRequest) =>
          context.showCreatedRuntimeTab('terminal', terminalSessionId, presentation, routeRequest),
        focusTerminal: terminal.focusTerminal,
        t: context.t,
      })
    },
  }
}
