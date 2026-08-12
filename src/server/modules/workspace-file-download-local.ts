import { constants as fsConstants } from 'node:fs'
import { open, realpath } from 'node:fs/promises'
import path from 'node:path'
import { CodedError } from '#/shared/coded-error.ts'
import type { ResolvedWorkspaceFilesystemExecution } from '#/server/modules/workspace-filesystem-execution.ts'
import { nodeReadableStream } from '#/server/modules/workspace-file-download-stream.ts'

type LocalFilesystemExecution = Extract<ResolvedWorkspaceFilesystemExecution, { transport: 'local' }>

export async function openLocalWorkspaceFileDownload(resolved: LocalFilesystemExecution, filePath: string) {
  try {
    const root = await realpath(resolved.executionPath)
    // Local links are allowed only when their canonical target remains inside
    // the execution root. O_NOFOLLOW still rejects a final-path swap after
    // canonicalization; the remote shell intentionally uses a stricter policy.
    const file = await realpath(path.join(root, filePath))
    const relative = path.relative(root, file)
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new CodedError({ code: 'BAD_REQUEST', message: 'error.invalid-path' })
    }
    const handle = await open(file, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK)
    try {
      const info = await handle.stat()
      if (!info.isFile()) {
        throw new CodedError({ code: 'BAD_REQUEST', message: 'error.file-download-regular-file-required' })
      }
      return { filename: path.posix.basename(filePath), stream: nodeReadableStream(handle.createReadStream()) }
    } catch (error) {
      await handle.close()
      throw error
    }
  } catch (error) {
    throw localDownloadError(error)
  }
}

function localDownloadError(error: unknown): unknown {
  if (error instanceof CodedError) return error
  const code = (error as NodeJS.ErrnoException).code
  if (code === 'ENOENT') return new CodedError({ code: 'BAD_REQUEST', message: 'error.file-not-found' })
  if (code === 'EACCES' || code === 'EPERM') {
    return new CodedError({ code: 'BAD_REQUEST', message: 'error.workspace-permission-denied' })
  }
  if (code === 'ELOOP') {
    return new CodedError({ code: 'BAD_REQUEST', message: 'error.file-download-symlink-unsupported' })
  }
  return error
}
