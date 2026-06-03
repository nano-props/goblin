import { getInitialBootstrap } from '#/web/bootstrap.ts'
import type { SettingsPage } from '#/shared/rpc.ts'
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

function hasNativeRpcBridge(): boolean {
  try {
    return typeof window.goblin?.invokeRpc === 'function'
  } catch {
    return false
  }
}

export function hasNativeDirectoryPicker(): boolean {
  return nativeShell()?.openDirectoryDialog !== undefined
}

export function canOpenAppSettings(): boolean {
  return nativeShell()?.openSettingsWindow !== undefined
}

export function canUseGlobalShortcutSettings(): boolean {
  return hasNativeRpcBridge()
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

function isAllowedExternalUrl(url: string, allowHttp: boolean): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' || (allowHttp && parsed.protocol === 'http:')
  } catch {
    return false
  }
}

function openBrowserUrl(url: string): ExecResult {
  const opened = window.open(url, '_blank', 'noopener,noreferrer')
  return opened ? { ok: true, message: url } : { ok: false, message: 'error.failed-open-browser' }
}

export async function openAppSettings(page: SettingsPage = 'general'): Promise<boolean> {
  return (await nativeShell()?.openSettingsWindow?.({ page })) ?? false
}

export async function openProjectGitHub(): Promise<ExecResult> {
  const shell = nativeShell()
  if (shell?.openExternalUrl) return await shell.openExternalUrl({ url: PROJECT_GITHUB_URL, allowHttp: false })
  return isAllowedExternalUrl(PROJECT_GITHUB_URL, false)
    ? openBrowserUrl(PROJECT_GITHUB_URL)
    : { ok: false, message: 'error.invalid-url' }
}

export async function openExternalUrl(url: string): Promise<ExecResult> {
  const shell = nativeShell()
  if (shell?.openExternalUrl) return await shell.openExternalUrl({ url, allowHttp: true })
  return isAllowedExternalUrl(url, true) ? openBrowserUrl(url) : { ok: false, message: 'error.invalid-url' }
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
