import type { RepoFileViewerResult } from '#/shared/api-types.ts'
import { shellEscapePath } from '#/web/clipboard/terminal-path-write.ts'

export function absoluteFilePathForTerminal(worktreePath: string, filePath: string): string {
  const normalizedRoot = worktreePath.replace(/[\\/]+$/u, '')
  if (/^[A-Za-z]:[\\/]/u.test(worktreePath) || worktreePath.includes('\\')) {
    return `${normalizedRoot}\\${filePath.split('/').join('\\')}`
  }
  return `${normalizedRoot}/${filePath}`
}

export function fileReadCommand(reader: RepoFileViewerResult, filePath: string): string {
  const quotedPath = reader.shell === 'cmd' ? cmdQuotePath(filePath) : shellEscapePath(filePath)
  return `${reader.viewer} ${quotedPath}\r`
}

function cmdQuotePath(path: string): string {
  return `"${path.replace(/[\^%!"]/gu, (char) => `^${char}`)}"`
}
