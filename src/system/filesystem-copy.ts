import { createReadStream, promises as fs } from 'node:fs'
import type { Stats } from 'node:fs'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'

export interface CopyPathOptions {
  signal?: AbortSignal
  include?: (sourcePath: string) => boolean
}

export class DestinationPermissionRestoreError extends Error {
  readonly operationError: unknown
  readonly restoreError: unknown

  constructor(restoreError: unknown, operationError?: unknown) {
    const operationFailure = operationError === undefined ? '' : `${filesystemErrorMessage(operationError)}; `
    super(
      `${operationFailure}failed to restore destination permissions: ${filesystemErrorMessage(restoreError)}`,
      operationError === undefined ? undefined : { cause: operationError },
    )
    this.name = 'DestinationPermissionRestoreError'
    this.operationError = operationError
    this.restoreError = restoreError
  }
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
    await copyRegularFile(sourcePath, destinationPath, sourceStat, options.signal)
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
      throw new DestinationPermissionRestoreError(restoreError, error)
    }
    throw error
  }
  try {
    await fs.chmod(destinationPath, mode)
  } catch (restoreError) {
    throw new DestinationPermissionRestoreError(restoreError)
  }
}

function filesystemErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function copyRegularFile(
  sourcePath: string,
  destinationPath: string,
  sourceStat: Stats,
  signal: AbortSignal | undefined,
): Promise<void> {
  if (isSparseFile(sourceStat)) {
    await copySparseFile(sourcePath, destinationPath, sourceStat.mode, signal)
    return
  }

  const mode = sourceStat.mode
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

function isSparseFile(stat: Stats): boolean {
  if (stat.size === 0) return false
  return stat.blocks * 512 < stat.size
}

async function copySparseFile(
  sourcePath: string,
  destinationPath: string,
  mode: number,
  signal: AbortSignal | undefined,
): Promise<void> {
  signal?.throwIfAborted()
  const source = await fs.open(sourcePath, 'r')
  let destination: Awaited<ReturnType<typeof fs.open>> | undefined
  try {
    destination = await fs.open(destinationPath, 'wx', mode)
    const buffer = Buffer.allocUnsafe(64 * 1024)
    const sourceSize = (await source.stat()).size
    let position = 0
    while (position < sourceSize) {
      signal?.throwIfAborted()
      const length = Math.min(buffer.length, sourceSize - position)
      const { bytesRead } = await source.read(buffer, 0, length, position)
      if (bytesRead === 0) throw new Error(`source file ended while copying: ${sourcePath}`)
      await writeNonZeroBlocks(destination, buffer.subarray(0, bytesRead), position, signal)
      position += bytesRead
    }
    await destination.truncate(sourceSize)
    signal?.throwIfAborted()
    await fs.chmod(destinationPath, mode)
  } catch (error) {
    await destination?.close().catch(() => {})
    if (destination) await fs.rm(destinationPath, { force: true }).catch(() => {})
    throw error
  } finally {
    await destination?.close().catch(() => {})
    await source.close().catch(() => {})
  }
}

async function writeNonZeroBlocks(
  destination: Awaited<ReturnType<typeof fs.open>>,
  buffer: Buffer,
  filePosition: number,
  signal: AbortSignal | undefined,
): Promise<void> {
  const sparseBlockSize = 4 * 1024
  for (let start = 0; start < buffer.length; start += sparseBlockSize) {
    const end = Math.min(start + sparseBlockSize, buffer.length)
    if (!containsNonZeroByte(buffer, start, end)) continue
    let written = 0
    while (written < end - start) {
      signal?.throwIfAborted()
      const result = await destination.write(
        buffer,
        start + written,
        end - start - written,
        filePosition + start + written,
      )
      if (result.bytesWritten === 0) throw new Error('destination file stopped accepting writes')
      written += result.bytesWritten
    }
  }
}

function containsNonZeroByte(buffer: Buffer, start: number, end: number): boolean {
  for (let index = start; index < end; index += 1) {
    if (buffer[index] !== 0) return true
  }
  return false
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
  // Symlink creation is the atomic commit point for this item. Once it
  // succeeds, report completion; the caller checks cancellation before the
  // next item instead of hiding an established destination behind cancelled.
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
