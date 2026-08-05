import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import type { Readable } from 'node:stream'
import { IpcError } from '#/shared/ipc-error.ts'
import type { WorkspacePaneFilesystemExecutionTarget } from '#/shared/workspace-runtime.ts'
import type { ResolvedWorkspaceFilesystemExecution } from '#/server/modules/workspace-filesystem-execution.ts'
import {
  bytesFromReadableChunk,
  nodeReadableStream,
  type NodeReadableStart,
} from '#/server/modules/workspace-file-download-stream.ts'
import { remoteWorkspaceRuntimeFailureFromCommandResult } from '#/server/modules/remote-workspace-runtime-failure.ts'
import { remoteFileDownloadStreamScript } from '#/system/ssh/remote-file-download-script.ts'
import { buildCanonicalSshInvocation, ensureSshControlDirectory } from '#/system/ssh/invocation.ts'

type RemoteFilesystemExecution = Extract<ResolvedWorkspaceFilesystemExecution, { transport: 'remote' }>

const REMOTE_STDERR_LIMIT_BYTES = 64 * 1024
const REMOTE_READY_TIMEOUT_MS = 15_000

export async function openRemoteWorkspaceFileDownload(
  target: WorkspacePaneFilesystemExecutionTarget,
  resolved: RemoteFilesystemExecution,
  filePath: string,
  signal?: AbortSignal,
) {
  await ensureSshControlDirectory()
  signal?.throwIfAborted()
  const marker = `__GOBLIN_FILE_DOWNLOAD_${randomUUID()}__`
  const script = remoteFileDownloadStreamScript(resolved.executionPath, filePath, marker)
  const invocation = buildCanonicalSshInvocation(resolved.remoteTarget, script, ['-T', '-o', 'RequestTTY=no'])
  const child = spawn(invocation.command, invocation.args, { stdio: ['ignore', 'pipe', 'pipe'] })
  if (!child.stdout || !child.stderr) {
    child.kill('SIGTERM')
    throw new Error('error.file-download-failed')
  }
  const abort = () => child.kill('SIGTERM')
  signal?.addEventListener('abort', abort, { once: true })
  const removeAbortListener = () => signal?.removeEventListener('abort', abort)
  const stderr = collectText(child.stderr, REMOTE_STDERR_LIMIT_BYTES)
  let readyTimedOut = false
  const readyTimeout = setTimeout(() => {
    readyTimedOut = true
    abort()
  }, REMOTE_READY_TIMEOUT_MS)
  let start: NodeReadableStart
  try {
    await childSpawned(child)
    signal?.throwIfAborted()
    start = await authenticateRemoteStream(child.stdout, marker)
  } catch (error) {
    abort()
    removeAbortListener()
    if (signal?.aborted) throw signal.reason
    const message = readyTimedOut ? 'error.request-timeout' : error instanceof Error ? error.message : String(error)
    throwRemoteDownloadFailure(target, resolved, {
      stderr: await stderr,
      message,
      timedOut: readyTimedOut,
    })
  } finally {
    clearTimeout(readyTimeout)
  }
  return {
    filename: path.posix.basename(filePath),
    stream: nodeReadableStream(child.stdout, {
      start,
      cancel: () => {
        removeAbortListener()
        abort()
      },
      complete: async () => {
        const code = await childExitCode(child)
        removeAbortListener()
        signal?.throwIfAborted()
        const errorOutput = await stderr
        if (code !== 0) throw new Error(remoteDownloadError({ stderr: errorOutput }))
      },
    }),
  }
}

function throwRemoteDownloadFailure(
  target: WorkspacePaneFilesystemExecutionTarget,
  resolved: RemoteFilesystemExecution,
  failure: { stderr: string; message: string; timedOut: boolean },
): never {
  const result = {
    ok: false as const,
    stdout: '',
    stderr: failure.stderr,
    message: failure.message,
    timedOut: failure.timedOut,
  }
  const runtimeFailure = remoteWorkspaceRuntimeFailureFromCommandResult({
    workspaceId: target.workspaceId,
    workspaceRuntimeId: target.workspaceRuntimeId,
    target: resolved.remoteTarget,
    result,
  })
  if (runtimeFailure) throw runtimeFailure
  throw new IpcError({ code: 'BAD_REQUEST', message: remoteDownloadError(result) })
}

async function authenticateRemoteStream(stream: Readable, marker: string): Promise<NodeReadableStart> {
  const iterator: AsyncIterator<unknown> = stream[Symbol.asyncIterator]()
  const markerBytes = Buffer.from(`${marker}\n`)
  let prefix = Buffer.alloc(0)
  while (prefix.length < markerBytes.length) {
    const chunk = await iterator.next()
    if (chunk.done) throw new Error('error.file-download-protocol-invalid')
    const combined = Buffer.concat([prefix, bytesFromReadableChunk(chunk.value)])
    const comparedLength = Math.min(combined.length, markerBytes.length)
    if (!combined.subarray(0, comparedLength).equals(markerBytes.subarray(0, comparedLength))) {
      throw new Error('error.file-download-protocol-invalid')
    }
    prefix = combined
  }
  const firstChunk = prefix.subarray(markerBytes.length)
  return firstChunk.length > 0 ? { iterator, firstChunk } : { iterator }
}

async function collectText(stream: Readable, limit: number): Promise<string> {
  const chunks: Buffer[] = []
  let length = 0
  for await (const chunk of stream) {
    if (length >= limit) continue
    const bytes = bytesFromReadableChunk(chunk)
    const accepted = bytes.subarray(0, limit - length)
    chunks.push(accepted)
    length += accepted.length
  }
  return Buffer.concat(chunks).toString('utf8')
}

function remoteDownloadError(result: { stderr: string; message?: string }): string {
  return /error\.[a-z0-9.-]+/u.exec(`${result.stderr}\n${result.message ?? ''}`)?.[0] ?? 'error.file-download-failed'
}

async function childSpawned(child: ReturnType<typeof spawn>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    child.once('spawn', resolve)
    child.once('error', reject)
  })
}

async function childExitCode(child: ReturnType<typeof spawn>): Promise<number | null> {
  if (child.exitCode !== null || child.signalCode !== null) return child.exitCode
  return await new Promise<number | null>((resolve, reject) => {
    child.once('close', resolve)
    child.once('error', reject)
  })
}
