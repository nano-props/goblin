import { createReadStream, promises as fs } from 'node:fs'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'

export interface CopyPathOptions {
  signal?: AbortSignal
  include?: (sourcePath: string) => boolean
}

/**
 * Copy one filesystem tree without overwriting existing destinations.
 * Regular files use an abort-aware stream pipeline, so the promise settles
 * only after cancellation has closed both streams. Already copied entries are
 * intentionally left in place for the caller to report as a partial result.
 */
export async function copyPath(
  sourcePath: string,
  destinationPath: string,
  options: CopyPathOptions = {},
): Promise<void> {
  options.signal?.throwIfAborted()
  if (options.include && !options.include(sourcePath)) return

  const sourceStat = await fs.lstat(sourcePath)
  options.signal?.throwIfAborted()

  if (sourceStat.isDirectory()) {
    await copyDirectory(sourcePath, destinationPath, sourceStat.mode, options)
    return
  }
  if (sourceStat.isFile()) {
    await copyRegularFile(sourcePath, destinationPath, sourceStat.mode, options.signal)
    return
  }
  if (sourceStat.isSymbolicLink()) {
    await copySymbolicLink(sourcePath, destinationPath, options.signal)
    return
  }
  throw new Error(`unsupported filesystem entry: ${sourcePath}`)
}

async function copyDirectory(
  sourcePath: string,
  destinationPath: string,
  mode: number,
  options: CopyPathOptions,
): Promise<void> {
  // The destination must remain writable while children are materialized;
  // restore the source mode after either completion or a partial failure.
  await fs.mkdir(destinationPath, { mode: mode | 0o700 })
  try {
    const directory = await fs.opendir(sourcePath)
    for await (const entry of directory) {
      options.signal?.throwIfAborted()
      await copyPath(path.join(sourcePath, entry.name), path.join(destinationPath, entry.name), options)
    }
    options.signal?.throwIfAborted()
  } catch (error) {
    // Restoring the mode is cleanup for a newly created partial directory.
    // Keep the copy/cancellation error as the primary reason, but do not hide
    // a second failure that leaves destination permissions uncertain.
    try {
      await fs.chmod(destinationPath, mode)
    } catch (restoreError) {
      throw new Error(
        `${filesystemErrorMessage(error)}; failed to restore destination permissions: ${filesystemErrorMessage(restoreError)}`,
        { cause: error },
      )
    }
    throw error
  }
  await fs.chmod(destinationPath, mode)
}

function filesystemErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function copyRegularFile(
  sourcePath: string,
  destinationPath: string,
  mode: number,
  signal: AbortSignal | undefined,
): Promise<void> {
  const destination = await fs.open(destinationPath, 'wx', mode)
  try {
    await pipeline(createReadStream(sourcePath), destination.createWriteStream(), { signal })
    signal?.throwIfAborted()
    await fs.chmod(destinationPath, mode)
  } catch (error) {
    // This invocation exclusively created the destination, so removing only
    // its incomplete file is safe. Cleanup is best-effort and must not replace
    // the cancellation or copy error that tells the caller why copying failed.
    await destination.close().catch(() => {})
    await fs.rm(destinationPath, { force: true }).catch(() => {})
    throw error
  }
}

async function copySymbolicLink(
  sourcePath: string,
  destinationPath: string,
  signal: AbortSignal | undefined,
): Promise<void> {
  const target = await fs.readlink(sourcePath)
  signal?.throwIfAborted()
  const copied = await copiedSymlink(sourcePath, destinationPath, target)
  await fs.symlink(copied.target, destinationPath, copied.type)
  signal?.throwIfAborted()
}

interface CopiedSymlink {
  target: string
  type: 'file' | 'junction' | undefined
}

async function copiedSymlink(sourcePath: string, destinationPath: string, target: string): Promise<CopiedSymlink> {
  if (process.platform !== 'win32') return { target, type: undefined }
  try {
    if (!(await fs.stat(sourcePath)).isDirectory()) return { target, type: 'file' }
    // Junctions are the Windows happy path because directory symlinks commonly
    // require elevated privileges. Their absolute target intentionally trades
    // relocatability for predictable non-admin creation; do not add a hidden
    // symlink/junction fallback. Unsupported targets fail directly.
    return {
      target: path.resolve(path.dirname(destinationPath), target),
      type: 'junction',
    }
  } catch {
    return { target, type: 'file' }
  }
}
