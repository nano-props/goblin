import type { RepoFileViewerResult } from '#/shared/api-types.ts'
import { shellEscapePath } from '#/web/clipboard/terminal-path-write.ts'

export function absoluteFilePathForTerminal(executionRoot: string, filePath: string): string {
  const normalizedRoot = executionRoot.replace(/[\\/]+$/u, '')
  if (/^[A-Za-z]:[\\/]/u.test(executionRoot) || executionRoot.includes('\\')) {
    return `${normalizedRoot}\\${filePath.split('/').join('\\')}`
  }
  return `${normalizedRoot}/${filePath}`
}

export function fileReadCommand(reader: Pick<RepoFileViewerResult, 'viewer' | 'shell'>, filePath: string): string {
  const quotedPath = reader.shell === 'cmd' ? cmdQuotePath(filePath) : shellEscapePath(filePath)
  return `${fileReadViewerCommand(reader.viewer)} ${quotedPath}\r`
}

function fileReadViewerCommand(viewer: RepoFileViewerResult['viewer']): string {
  return viewer === 'bat' || viewer === 'batcat' ? `${viewer} --paging=never --style=plain` : viewer
}

function cmdQuotePath(path: string): string {
  return `"${path.replace(/[\^%!"]/gu, (char) => `^${char}`)}"`
}
