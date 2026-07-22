import type { EditorApp, TerminalApp } from '#/shared/api-types.ts'
import type { ExecResult } from '#/shared/git-types.ts'
import type { WorkspacePaneFilesystemExecutionTarget } from '#/shared/workspace-runtime.ts'
import { postServerJson } from '#/web/lib/server-fetch.ts'
import { decodeWith } from '#/shared/http-response-schema.ts'
import { ExecResultResponseSchema } from '#/shared/http-response-schema.ts'

export async function openWorkspaceTerminal(
  target: WorkspacePaneFilesystemExecutionTarget,
  app: TerminalApp,
): Promise<ExecResult> {
  return await postServerJson('/api/workspace/open-terminal', { target, app }, decodeWith(ExecResultResponseSchema))
}

export async function openWorkspaceEditor(
  target: WorkspacePaneFilesystemExecutionTarget,
  app: EditorApp,
): Promise<ExecResult> {
  return await postServerJson('/api/workspace/open-editor', { target, app }, decodeWith(ExecResultResponseSchema))
}

export async function openWorkspaceInFinder(target: WorkspacePaneFilesystemExecutionTarget): Promise<ExecResult> {
  return await postServerJson('/api/workspace/open-in-finder', { target }, decodeWith(ExecResultResponseSchema))
}
