import type { SettingsPage } from '#/shared/api-types.ts'
import type { ExecResult } from '#/shared/git-types.ts'
import { getClientBridge } from '#/web/client-bridge.ts'
import { homeDirectory as hostInfoHomeDirectory } from '#/web/stores/host-info.ts'
const PROJECT_GITHUB_URL = 'https://github.com/nano-props/goblin'

function nativeHost() {
  return getClientBridge().host()
}

function requiredNativeHost() {
  const host = nativeHost()
  if (!host) throw new Error('Native host bridge is unavailable')
  return host
}

export function hasNativeDirectoryPicker(): boolean {
  return getClientBridge().hasCapability('open-directory-dialog')
}

export function canOpenAppSettings(): boolean {
  return getClientBridge().hasCapability('open-settings-window')
}

export function canUseGlobalShortcutSettings(): boolean {
  return getClientBridge().hasCapability('global-shortcut')
}

export function homeDirectory(): string {
  // The entrypoint establishes host info before mounting the application.
  return hostInfoHomeDirectory()
}

export function pathForDroppedFile(file: File): string {
  return getClientBridge().pathForFile(file)
}

/**
 * Persist clipboard / drop blobs through the shared server endpoint.
 * Transport, HTTP, and response-contract failures reject.
 */
export async function saveClipboardFiles(files: File[]): Promise<string[]> {
  return await getClientBridge().saveClipboardFiles(files)
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
  // Mirrors shell-ipc.ts's desktop behaviour, which likewise reports
  // success based on the platform call rather than an observable side effect.
  window.open(url, '_blank', 'noopener,noreferrer')
  return { ok: true, message: url }
}

function openExternalUrlInBrowser(url: string, allowHttp: boolean): ExecResult {
  return isAllowedExternalUrl(url, allowHttp) ? openBrowserUrl(url) : { ok: false, message: 'error.invalid-url' }
}

async function openExternalUrlWithPolicy(url: string, allowHttp: boolean): Promise<ExecResult> {
  const bridge = getClientBridge()
  if (bridge.kind() === 'electron') return await requiredNativeHost().openExternalUrl({ url, allowHttp })
  return openExternalUrlInBrowser(url, allowHttp)
}

export async function openAppSettings(page: SettingsPage = 'general'): Promise<boolean> {
  return await requiredNativeHost().openSettingsWindow({ page })
}

export async function openProjectGitHub(): Promise<ExecResult> {
  return await openExternalUrlWithPolicy(PROJECT_GITHUB_URL, false)
}

export async function openExternalUrl(url: string): Promise<ExecResult> {
  return await openExternalUrlWithPolicy(url, true)
}

export async function chooseLocalWorkspacePath(): Promise<string | null> {
  return await requiredNativeHost().openDirectoryDialog({ title: 'Open Workspace' })
}

export async function chooseCloneParentPath(): Promise<string | null> {
  return await requiredNativeHost().openDirectoryDialog({ title: 'Choose Clone Destination' })
}

export async function consumeExternalOpenPaths(): Promise<string[]> {
  const bridge = getClientBridge()
  if (bridge.kind() === 'web') return []
  return await requiredNativeHost().consumeExternalOpenPaths()
}
