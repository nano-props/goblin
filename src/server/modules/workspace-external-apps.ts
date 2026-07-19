import type { EditorApp, TerminalApp } from '#/shared/api-types.ts'
import type { ExecResult } from '#/shared/git-types.ts'
import type { WorkspacePaneFilesystemExecutionTarget } from '#/shared/workspace-runtime.ts'
import { isRemoteWorkspaceId } from '#/shared/remote-workspace.ts'
import { resolveWorkspaceFilesystemExecution } from '#/server/modules/workspace-filesystem-execution.ts'
import { openInPreferredEditor, openRemoteInPreferredEditor } from '#/system/editors.ts'
import { openInFinder } from '#/system/finder.ts'
import { openInPreferredTerminal, openRemoteInPreferredTerminal } from '#/system/terminals.ts'

export async function openWorkspaceTerminal(
  target: WorkspacePaneFilesystemExecutionTarget,
  app: TerminalApp,
  signal?: AbortSignal,
): Promise<ExecResult> {
  const resolved = await resolveWorkspaceFilesystemExecution(target, { signal })
  return resolved.transport === 'remote'
    ? await openRemoteInPreferredTerminal(resolved.remoteTarget.alias, resolved.executionPath, app)
    : await openInPreferredTerminal(resolved.executionPath, app)
}

export async function openWorkspaceEditor(
  target: WorkspacePaneFilesystemExecutionTarget,
  app: EditorApp,
  signal?: AbortSignal,
): Promise<ExecResult> {
  const resolved = await resolveWorkspaceFilesystemExecution(target, { signal })
  return resolved.transport === 'remote'
    ? await openRemoteInPreferredEditor(resolved.remoteTarget.alias, resolved.executionPath, app)
    : await openInPreferredEditor(resolved.executionPath, app)
}

export async function openWorkspaceInFinder(
  target: WorkspacePaneFilesystemExecutionTarget,
  signal?: AbortSignal,
): Promise<ExecResult> {
  if (isRemoteWorkspaceId(target.workspaceId)) return { ok: false, message: 'error.invalid-path' }
  const resolved = await resolveWorkspaceFilesystemExecution(target, { signal })
  return await openInFinder(resolved.executionPath)
}
