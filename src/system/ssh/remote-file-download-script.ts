import { readFileSync } from 'node:fs'
import { shellQuote } from '#/system/remote-shell.ts'

let cachedScript: string | undefined

export function loadRemoteFileDownloadScript(): string {
  cachedScript ??= readFileSync(new URL('./remote-file-download.sh', import.meta.url), 'utf8')
  return cachedScript
}

export function remoteFileDownloadStreamScript(rootPath: string, filePath: string, marker: string): string {
  const segments = filePath.split('/')
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error('error.invalid-path')
  }
  if (!marker) throw new Error('error.file-download-protocol-invalid')
  const args = [rootPath, marker, ...segments].map(shellQuote).join(' ')
  return `exec sh -c ${shellQuote(loadRemoteFileDownloadScript())} -- ${args}`
}
