// Editor backend registry. Each editor app implements EditorBackend
// and registers itself here.
//
// ============================================================================
// Adding a new editor — checklist (do all of these in one PR)
// ============================================================================
//
// Two backend "families" exist today, with different launch strategies:
//
//   1. VS Code-family (VS Code, Cursor, Windsurf)
//      These ship a CLI binary inside the .app bundle at
//      `Contents/Resources/app/bin/<name>` and use the `openByAppCli` /
//      `openRemoteByAppCli` helpers in `open-app.ts`. Adding one is the
//      simple path: copy `src/system/vscode.ts`, swap the constants,
//      and register.
//
//   2. JetBrains-family (WebStorm, IntelliJ, GoLand, etc.)
//      These do NOT ship a CLI inside the .app bundle. On macOS they
//      are launched via `open -na "<App>.app" --args "$@"`; on Linux
//      the install ships a `webstorm.sh` shell script under
//      `<install-dir>/bin/`; on Windows they live on PATH as
//      `webstorm64.exe`. A `webstorm` (or sibling) command on PATH is
//      the easiest cross-platform handle, but it is provided by
//      Toolbox App, the user's own symlink, or JetBrains' installer —
//      none of which the backend can rely on. Plan to add a separate
//      `openByAppLauncher` / `openRemoteByAppLauncher` family in
//      `open-app.ts` rather than reusing `openByAppCli`.
//
// Concretely, to add WebStorm you need to:
//   1. Decide the backend family. For WebStorm, that's family 2 —
//      write `src/system/webstorm.ts` that does NOT reuse
//      `openByAppCli`. Use `open -na "WebStorm.app" --args <dir>` on
//      macOS and `webstorm <dir>` (or `<install>/bin/webstorm.sh`) on
//      Linux/Windows. `isWebStormInstalled()` should detect
//      `~/.local/share/JetBrains/Toolbox/scripts/webstorm` or the
//      .app bundle in `/Applications/WebStorm.app`.
//   2. Register it in the `backends` map below.
//   3. Extend `EditorApp` in `src/shared/settings.ts` with the new
//      literal (`'webstorm'`).
//   4. Extend `EditorAppSchema` in `src/shared/procedure-schemas.ts`
//      — it is a hand-written `v.picklist`, NOT auto-derived from the
//      type alias, so the two will drift if you only update one.
//   5. Add `'editor:webstorm'` to `WORKSPACE_EXTERNAL_APP_IDS` in
//      `src/shared/repo-settings.ts`. The compile-time guard in
//      `src/web/external-workspace-apps.tsx` will reject the build
//      if you skip this step — that's by design.
//   6. Append a new entry to `WORKSPACE_EXTERNAL_EDITOR_APPS` in
//      `src/web/external-workspace-apps.tsx`. (The same compile-time
//      guard also catches a mismatch in the other direction — if you
//      add the id here without registering it in step 5, the build
//      fails.)
//   7. Add a `WebStormIcon` component in
//      `src/web/components/ExternalAppIcon/`, re-export it from the
//      barrel, and add an `if (pref === 'webstorm')` branch in
//      `EditorAppIcon`.
//   8. Append a `webstorm` entry to `EDITOR_APPS` in
//      `src/web/components/settings/pages/ExternalAppSettings.tsx` so
//      the settings page's "Editors" detection list shows it.
//   9. Add i18n keys for the workspace picker
//      (`settings.editor.webstorm`) and the settings page
//      (`settings.apps.tool.webstorm.title` / `.command`) to all
//      four locales: `src/shared/i18n/{en,zh,ja,ko}.ts`.
//  10. Update tests that mock `editorAppAvailability` to include
//      the new key in the `appAvailability` record. The
//      `Record<EditorApp, boolean>` shape is enforced everywhere it
//      is consumed, so the type-checker will catch any mock that
//      missed the new key. The known mock sites today are:
//        - src/web/components/repo-workspace/RepoWorkspaceToolbar.test.tsx
//        - src/web/components/SettingsSurface.test.tsx
//        - src/web/settings-actions.test.ts
//        - src/web/runtime-settings-hooks.test.tsx
//        - src/main/native-host-ipc-router.test.ts
//            (mocks `getEditorAppAvailability` directly)
//      If a new mock site is added, add it to this list too.

import type { EditorAppAvailability, EditorApp } from '#/shared/api-types.ts'
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
