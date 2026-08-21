// Editor backends own platform-specific detection and launch behavior; this
// registry exposes them through the shared editor-app identity contract.

import type { EditorAppAvailability, EditorApp } from '#/shared/settings.ts'
import type { ExecResult } from '#/shared/git-types.ts'
import { isVSCodeInstalled, openInVSCode, openRemoteInVSCode } from '#/system/vscode.ts'

export interface EditorBackend {
  /** Whether this editor is available on the current system.
   *  Sync — backed by file-existence checks that are cheap on macOS.
   *  If a future backend needs async detection, resolve it at
   *  registration time and cache the result. */
  isInstalled: () => boolean
  /** Open a directory in this editor. */
  open: (path: string) => Promise<ExecResult>
  /** Open a remote SSH workspace in this editor. Optional: a backend
   *  without support returns `error.remote-editor-not-supported` from
   *  `openRemoteInPreferredEditor`. */
  openRemote?: (alias: string, remotePath: string) => Promise<ExecResult>
}

/** Concrete editor app backends. */
const backends: Record<EditorApp, EditorBackend> = {
  vscode: { isInstalled: isVSCodeInstalled, open: openInVSCode, openRemote: openRemoteInVSCode },
}

/** Open `path` in the requested editor `app`. */
export function openInPreferredEditor(path: string, app: EditorApp): Promise<ExecResult> {
  if (!getEditorAppAvailability()[app]) {
    return Promise.resolve({ ok: false, message: 'error.editor-not-installed' })
  }
  return backends[app].open(path)
}

/** Open a remote SSH workspace in the requested editor `app`. */
export function openRemoteInPreferredEditor(alias: string, remotePath: string, app: EditorApp): Promise<ExecResult> {
  if (!getEditorAppAvailability()[app]) {
    return Promise.resolve({ ok: false, message: 'error.editor-not-installed' })
  }
  const openRemote = backends[app].openRemote
  return openRemote
    ? openRemote(alias, remotePath)
    : Promise.resolve({ ok: false, message: 'error.remote-editor-not-supported' })
}

export function getEditorAppAvailability(): EditorAppAvailability {
  return {
    vscode: backends.vscode.isInstalled(),
  }
}
