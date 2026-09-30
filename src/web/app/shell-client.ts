import type { ExecResult } from '#/shared/git-types.ts'
import { getClientBridge } from '#/web/bridge/client.ts'
import { homeDirectory as hostInfoHomeDirectory } from '#/web/stores/host-info.ts'
const PROJECT_GITHUB_URL = 'https://github.com/nano-props/goblin'

export function homeDirectory(): string {
  // The entrypoint establishes host info before mounting the application.
  return hostInfoHomeDirectory()
}

/**
 * Persist clipboard / drop blobs through the shared server endpoint.
 * Transport, HTTP, and response-contract failures reject.
 */
export async function saveClipboardFiles(files: File[]): Promise<string[]> {
  return getClientBridge().saveClipboardFiles(files)
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
  // With `noopener`, browsers do not synchronously reveal whether the external tab opened.
  window.open(url, '_blank', 'noopener,noreferrer')
  return { ok: true, message: url }
}

function openExternalUrlInBrowser(url: string, allowHttp: boolean): ExecResult {
  return isAllowedExternalUrl(url, allowHttp) ? openBrowserUrl(url) : { ok: false, message: 'error.invalid-url' }
}

export async function openProjectGitHub(): Promise<ExecResult> {
  return openExternalUrlInBrowser(PROJECT_GITHUB_URL, false)
}

export async function openExternalUrl(url: string): Promise<ExecResult> {
  return openExternalUrlInBrowser(url, true)
}
