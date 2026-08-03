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
  // restore the source mode only after the directory is complete.
  await fs.mkdir(destinationPath, { mode: mode | 0o700 })
  const directory = await fs.opendir(sourcePath)
  for await (const entry of directory) {
    options.signal?.throwIfAborted()
    await copyPath(path.join(sourcePath, entry.name), path.join(destinationPath, entry.name), options)
  }
  options.signal?.throwIfAborted()
  await fs.chmod(destinationPath, mode)
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
  await fs.symlink(target, destinationPath, await copiedSymlinkType(sourcePath))
  signal?.throwIfAborted()
}

async function copiedSymlinkType(sourcePath: string): Promise<'file' | 'dir' | undefined> {
  if (process.platform !== 'win32') return undefined
  try {
    return (await fs.stat(sourcePath)).isDirectory() ? 'dir' : 'file'
  } catch {
    return 'file'
  }
}
