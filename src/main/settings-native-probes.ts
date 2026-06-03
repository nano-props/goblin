import type { EditorPref, ExternalAppsSnapshot, GitHubCliState, TerminalPref } from '#/shared/rpc.ts'
import { probeExternalApps } from '#/system/external-apps.ts'
import { probeGitHubCli } from '#/system/github-cli.ts'
import { broadcastRpcEvent } from '#/main/events.ts'

export async function getExternalAppsState(
  terminalPref: TerminalPref,
  editorPref: EditorPref,
  signal?: AbortSignal,
): Promise<ExternalAppsSnapshot> {
  const state = await probeExternalApps(terminalPref, editorPref, signal)
  return { terminal: state.terminals, editor: state.editors }
}

export async function refreshExternalAppsState(
  terminalPref: TerminalPref,
  editorPref: EditorPref,
  signal?: AbortSignal,
): Promise<ExternalAppsSnapshot> {
  const state = await getExternalAppsState(terminalPref, editorPref, signal)
  broadcastRpcEvent({ type: 'terminal-app-changed', ...state.terminal })
  broadcastRpcEvent({ type: 'editor-app-changed', ...state.editor })
  return state
}

export async function getGitHubCliState(signal?: AbortSignal, hosts?: string[]): Promise<GitHubCliState> {
  return await probeGitHubCli(signal, hosts)
}

export async function refreshGitHubCliState(signal?: AbortSignal, hosts?: string[]): Promise<GitHubCliState> {
  const state = await probeGitHubCli(signal, hosts, { force: true })
  broadcastRpcEvent({ type: 'github-cli-changed', state })
  return state
}
