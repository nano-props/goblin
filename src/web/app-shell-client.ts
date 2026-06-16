import { getInitialBootstrap } from '#/web/bootstrap.ts'
import type { SettingsPage } from '#/shared/api-types.ts'
import type { ExecResult } from '#/shared/git-types.ts'
import { getRendererBridge } from '#/web/renderer-bridge.ts'
const PROJECT_GITHUB_URL = 'https://github.com/nano-props/goblin'

function nativeShell() {
  try {
    return getRendererBridge().shell()
  } catch {
    return null
  }
}

export function canUseNativeIpcBridge(): boolean {
  try {
    return getRendererBridge().hasCapability('settings-ipc')
  } catch {
    return false
  }
}

export function hasNativeDirectoryPicker(): boolean {
  try {
    return getRendererBridge().hasCapability('open-directory-dialog')
  } catch {
    return false
  }
}

export function canOpenAppSettings(): boolean {
  try {
    return getRendererBridge().hasCapability('open-settings-window')
  } catch {
    return false
  }
}

export function canUseGlobalShortcutSettings(): boolean {
  return canUseNativeIpcBridge()
}

export function homeDirectory(): string {
  return getInitialBootstrap().homeDir
}

export function pathForDroppedFile(file: File): string {
  try {
    return getRendererBridge().pathForFile(file)
  } catch {
    return ''
  }
}

/**
 * Persist clipboard / drop blobs via the active renderer bridge.
 *
 * Returns absolute paths the PTY can read. On any failure (bridge
 * unavailable, IPC error, HTTP transport problem, server 4xx/5xx),
 * the underlying bridge collapses the error to `[]`; this wrapper
 * preserves that contract so the resolver can map "fewer paths back
 * than files in" to a `paste-file-partial` toast and "nothing back"
 * to `paste-file-failed`.
 */
export function saveClipboardFiles(files: File[]): Promise<string[]> {
  try {
    return getRendererBridge().saveClipboardFiles(files)
  } catch {
    return Promise.resolve([])
  }
}

function isAllowedExternalUrl(url: string, allowHttp: boolean): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' || (allowHttp && parsed.protocol === 'http:')
  } catch {
    return false
  }
}

function openBrowserUrl(url: string): ExecResult {
  // window.open() with `noopener` returns null by spec even when the new tab
  // does open — that is the whole point of `noopener`: sever the opener's
  // reference to prevent reverse tabnabbing. Popup blockers and sandboxed
  // iframes also surface as null. With noopener required for security, we
  // cannot distinguish "opened" from "blocked" synchronously, so trust the
  // browser. The URL has already been validated by isAllowedExternalUrl.
  // Mirrors shell-bridge.ts's desktop behaviour, which likewise reports
  // success based on the platform call rather than an observable side effect.
  window.open(url, '_blank', 'noopener,noreferrer')
  return { ok: true, message: url }
}

function openExternalUrlInBrowser(url: string, allowHttp: boolean): ExecResult {
  return isAllowedExternalUrl(url, allowHttp) ? openBrowserUrl(url) : { ok: false, message: 'error.invalid-url' }
}

async function openExternalUrlWithPolicy(url: string, allowHttp: boolean): Promise<ExecResult> {
  const shell = nativeShell()
  if (shell?.openExternalUrl) return await shell.openExternalUrl({ url, allowHttp })
  return openExternalUrlInBrowser(url, allowHttp)
}

export async function openAppSettings(page: SettingsPage = 'general'): Promise<boolean> {
  return (await nativeShell()?.openSettingsWindow?.({ page })) ?? false
}

export async function openProjectGitHub(): Promise<ExecResult> {
  return await openExternalUrlWithPolicy(PROJECT_GITHUB_URL, false)
}

export async function openExternalUrl(url: string): Promise<ExecResult> {
  return await openExternalUrlWithPolicy(url, true)
}

export async function chooseLocalRepositoryPath(): Promise<string | null> {
  return (await nativeShell()?.openDirectoryDialog?.({ title: 'Open Git Repository' })) ?? null
}

export async function chooseCloneParentPath(): Promise<string | null> {
  return (await nativeShell()?.openDirectoryDialog?.({ title: 'Choose Clone Destination' })) ?? null
}

export async function consumeExternalOpenPaths(): Promise<string[]> {
  return (await nativeShell()?.consumeExternalOpenPaths?.()) ?? []
}
