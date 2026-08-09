import type { EditorApp, TerminalApp } from '#/shared/settings.ts'
import type { ExecResult } from '#/shared/git-types.ts'
import { isRemoteWorkspaceId } from '#/shared/remote-workspace.ts'
import {
  openWorkspaceEditor,
  openWorkspaceInFinder,
  openWorkspaceTerminal,
} from '#/web/workspace-external-app-client.ts'
import type { WorkspacePaneFilesystemTarget } from '#/web/workspace-pane/workspace-pane-filesystem-target.ts'
import { workspacePaneFilesystemRuntimeTarget } from '#/web/workspace-pane/workspace-pane-filesystem-target.ts'
import { runWorkspaceUiAction } from '#/web/stores/workspaces/workspace-ui-action.ts'
import { currentWorkspaceRuntimeId } from '#/web/stores/workspaces/workspace-guards.ts'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'

export interface WorkspaceFilesystemExternalActions {
  capabilities: {
    canOpenTerminal: boolean
    canOpenEditor: boolean
    canOpenFinder: boolean
  }
  openTerminal: (app: TerminalApp) => Promise<ExecResult | null>
  openEditor: (app: EditorApp) => Promise<ExecResult | null>
  openFinder: () => Promise<ExecResult | null>
}

export function workspaceFilesystemExternalCapabilities(
  target: WorkspacePaneFilesystemTarget,
): WorkspaceFilesystemExternalActions['capabilities'] {
  return {
    canOpenTerminal: target.capabilities.terminal.available,
    canOpenEditor: target.capabilities.files.read,
    canOpenFinder: !isRemoteWorkspaceId(target.workspaceId),
  }
}

export function workspaceFilesystemExternalActions(
  target: WorkspacePaneFilesystemTarget,
): WorkspaceFilesystemExternalActions {
  const executionTarget = workspacePaneFilesystemRuntimeTarget(target)

  async function run(action: () => Promise<ExecResult>): Promise<ExecResult | null> {
    return await runWorkspaceFilesystemExternalAction(target, action)
  }

  return {
    capabilities: workspaceFilesystemExternalCapabilities(target),
    openTerminal: async (app: TerminalApp) => await run(async () => await openWorkspaceTerminal(executionTarget, app)),
    openEditor: async (app: EditorApp) => await run(async () => await openWorkspaceEditor(executionTarget, app)),
    openFinder: async () => await run(async () => await openWorkspaceInFinder(executionTarget)),
  }
}

export async function runWorkspaceFilesystemExternalAction(
  target: WorkspacePaneFilesystemTarget,
  action: () => Promise<ExecResult>,
): Promise<ExecResult | null> {
  const result = await runWorkspaceUiAction(action)
  if (!result) return null
  return currentWorkspaceRuntimeId(workspacesStore.getState(), target.workspaceId) === target.workspaceRuntimeId
    ? result
    : null
}
