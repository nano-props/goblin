import {
  createWorkspacePaneTabModel,
  type WorkspacePaneRuntimeTabStateInputByType,
  type WorkspacePaneTabModel,
  type WorkspacePaneTabModelInput,
} from '#/web/workspace-pane/workspace-pane-tab-model.ts'
import type { WorkspacePaneTabSummary } from '#/web/workspace-pane/workspace-pane-tab-summary.ts'
import type { WorkspacePaneRuntimeProjectionPhase } from '#/web/workspace-pane/workspace-pane-runtime-state.ts'
import { formatTerminalFilesystemTargetKeyForPath } from '#/shared/terminal-filesystem-target-key.ts'
import type { WorkspacePaneStaticTabType, WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
import {
  workspacePaneRuntimeTabEntry,
  workspacePaneStaticTabEntry,
  workspacePaneTabEntryIdentity,
} from '#/shared/workspace-pane.ts'
import { requiredGitWorkspacePaneTabsTarget } from '#/shared/workspace-pane-tabs-target.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'

export const WORKSPACE_ID = workspaceIdForTest('goblin+file:///tmp/goblin-workspace-pane-tab-model-repo')
export const WORKSPACE_RUNTIME_ID = 'repo-runtime-test'
export const WORKTREE_PATH = '/tmp/goblin-workspace-pane-tab-model-worktree'
export const WORKTREE_KEY = formatTerminalFilesystemTargetKeyForPath(WORKSPACE_ID, WORKTREE_PATH)

export function requiredEntryIdentity(entry: WorkspacePaneTabEntry | null): string {
  if (!entry) throw new Error('expected workspace pane tab entry')
  return workspacePaneTabEntryIdentity(entry)
}

type WorkspacePaneTabModelTestInput = Omit<
  WorkspacePaneTabModelInput,
  'workspaceRuntimeId' | 'runtimeTabStateByType' | 'routeTarget' | 'paneTarget' | 'worktreeHead'
> & {
  branchName: string | null
  worktreePath: string | null
  workspaceRuntimeId?: string
  runtimeTabStateByType?: WorkspacePaneRuntimeTabStateInputByType
  terminalCreatePending?: boolean
  terminalProjectionPhase?: WorkspacePaneRuntimeProjectionPhase
  terminalProjectionErrorMessage?: string
  selectedTerminalSessionId?: string | null
}

export function createModel(input: WorkspacePaneTabModelTestInput): WorkspacePaneTabModel {
  const {
    branchName,
    worktreePath,
    workspaceRuntimeId,
    runtimeTabStateByType,
    terminalCreatePending,
    terminalProjectionPhase,
    terminalProjectionErrorMessage,
    selectedTerminalSessionId,
    ...modelInput
  } = input
  const terminalState = runtimeTabStateByType?.terminal
  const hasSelectedTerminalSession = terminalState
    ? Object.prototype.hasOwnProperty.call(terminalState, 'selectedSessionId')
    : false
  return createWorkspacePaneTabModel({
    workspaceRuntimeId: workspaceRuntimeId ?? WORKSPACE_RUNTIME_ID,
    ...modelInput,
    routeTarget: branchName
      ? { kind: 'git-branch', workspaceId: modelInput.workspaceId, branchName }
      : worktreePath === modelInput.workspaceId
        ? { kind: 'workspace-root', workspaceId: modelInput.workspaceId }
        : { kind: 'inactive', workspaceId: modelInput.workspaceId },
    paneTarget: branchName
      ? requiredGitWorkspacePaneTabsTarget(modelInput.workspaceId, branchName, worktreePath)
      : worktreePath === modelInput.workspaceId
        ? { kind: 'workspace-root', workspaceId: modelInput.workspaceId }
        : { kind: 'inactive', workspaceId: modelInput.workspaceId },
    worktreeHead: branchName && worktreePath ? { kind: 'branch', branchName } : undefined,
    runtimeTabStateByType: {
      ...runtimeTabStateByType,
      terminal: {
        createPending: terminalState?.createPending ?? terminalCreatePending ?? false,
        projectionPhase: terminalState?.projectionPhase ?? terminalProjectionPhase ?? 'pending',
        projectionErrorMessage: terminalState?.projectionErrorMessage ?? terminalProjectionErrorMessage,
        selectedSessionId: hasSelectedTerminalSession
          ? (terminalState?.selectedSessionId ?? null)
          : (selectedTerminalSessionId ?? null),
      },
    },
  })
}

export function staticEntry(type: WorkspacePaneStaticTabType): WorkspacePaneTabEntry {
  return workspacePaneStaticTabEntry(type)
}

export function terminalEntry(id: string): WorkspacePaneTabEntry {
  return workspacePaneRuntimeTabEntry('terminal', id)
}

export function terminalView(terminalSessionId: string, index: number, selected: boolean): WorkspacePaneTabSummary {
  return {
    type: 'terminal',
    terminalSessionId,
    terminalFilesystemTargetKey: WORKTREE_KEY,
    index,
    title: terminalSessionId,
    phase: 'open',
    selected,
    hasBell: false,
    hasRecentOutput: false,
  }
}
