import type { EditorApp, TerminalApp } from '#/shared/api-types.ts'
import type { ExecResult } from '#/shared/git-types.ts'
import type { WorkspacePaneFilesystemExecutionTarget } from '#/shared/workspace-runtime.ts'
import { postServerJson } from '#/web/lib/server-fetch.ts'

export async function openWorkspaceTerminal(
  target: WorkspacePaneFilesystemExecutionTarget,
  app: TerminalApp,
): Promise<ExecResult> {
  return await postServerJson('/api/workspace/open-terminal', { target, app })
}

export async function openWorkspaceEditor(
  target: WorkspacePaneFilesystemExecutionTarget,
  app: EditorApp,
): Promise<ExecResult> {
  return await postServerJson('/api/workspace/open-editor', { target, app })
}

export async function openWorkspaceInFinder(target: WorkspacePaneFilesystemExecutionTarget): Promise<ExecResult> {
  return await postServerJson('/api/workspace/open-in-finder', { target })
}
