import script from '#/system/ssh/remote-file-download.sh' with { type: 'text' }
import { shellQuote } from '#/system/remote-shell.ts'

export function loadRemoteFileDownloadScript(): string {
  return script
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
