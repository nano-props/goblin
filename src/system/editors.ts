// Editor backend registry. Each editor app implements EditorBackend
// and registers itself here. The resolver picks the right one based on
// the user's EditorPref setting.
//
// Adding a new editor:
// 1. Create src/main/system/<name>.ts implementing EditorBackend
// 2. Register it in the `backends` map below
// 3. Add the new id to EditorPref in shared/rpc.ts
// 4. Add i18n keys for the settings picker and dependencies overlay

import type { EditorAppAvailability, EditorPref, ResolvedEditorApp } from '#/shared/rpc.ts'
import { isVSCodeInstalled, openInVSCode } from '#/system/vscode.ts'
import { isCursorInstalled, openInCursor } from '#/system/cursor.ts'
import { isWindsurfInstalled, openInWindsurf } from '#/system/windsurf.ts'

export interface EditorBackend {
  /** Whether this editor is available on the current system.
   *  Sync — backed by file-existence checks that are cheap on macOS.
   *  If a future backend needs async detection, resolve it at
   *  registration time and cache the result. */
  isInstalled: () => boolean
  /** Open a directory in this editor. */
  open: (path: string) => Promise<{ ok: boolean; message: string }>
}

/** Concrete editor pref values (excludes 'auto'). */
const backends: Record<ResolvedEditorApp, EditorBackend> = {
  vscode: { isInstalled: isVSCodeInstalled, open: openInVSCode },
  cursor: { isInstalled: isCursorInstalled, open: openInCursor },
  windsurf: { isInstalled: isWindsurfInstalled, open: openInWindsurf },
}

/** Auto-detection priority — first installed editor wins. */
const AUTO_PRIORITY: ResolvedEditorApp[] = ['vscode', 'cursor', 'windsurf']

export function resolveEditorApp(pref: EditorPref, availability: EditorAppAvailability): ResolvedEditorApp | null {
  if (pref !== 'auto') {
    return availability[pref] ? pref : null
  }
  for (const id of AUTO_PRIORITY) {
    if (availability[id]) return id
  }
  return null
}

/** Open `path` in the editor selected by `pref`.
 *  Returns null if no editor is available (auto mode, none installed). */
export function openInPreferredEditor(
  path: string,
  pref: EditorPref,
): Promise<{ ok: boolean; message: string }> {
  const resolved = resolveEditorApp(pref, getEditorAppAvailability())
  return resolved ? backends[resolved].open(path) : Promise.resolve({ ok: false, message: 'error.editor-not-installed' })
}

export function getResolvedEditorApp(pref: EditorPref): ResolvedEditorApp | null {
  return resolveEditorApp(pref, getEditorAppAvailability())
}

export function getEditorAppAvailability(): EditorAppAvailability {
  return {
    vscode: backends.vscode.isInstalled(),
    cursor: backends.cursor.isInstalled(),
    windsurf: backends.windsurf.isInstalled(),
  }
}
