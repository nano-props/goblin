import { execFile, type ChildProcess } from 'node:child_process'
import type { ExecResult } from '#/main/git/types.ts'

/** Default per-call timeout. Network ops (push/pull/fetch) override via opts. */
const DEFAULT_TIMEOUT_MS = 30_000
/** Network-bound ops get a longer ceiling — slow remotes / VPN reconnect / SSH
 *  setup can legitimately take a while. Beyond this we'd rather surface a
 *  cancellable failure than let the UI's busy lock hold forever. */
export const NETWORK_TIMEOUT_MS = 90_000

export interface GitOptions {
  /** Override the default timeout. */
  timeoutMs?: number
  /** Cancel the in-flight git invocation. SIGTERM is sent, then SIGKILL
   *  after a short grace if git doesn't exit. */
  signal?: AbortSignal
}

export type GitAvailability = { ok: true } | { ok: false; message: string }

let gitAvailabilityCache: Promise<GitAvailability> | null = null

export function checkGitAvailable(): Promise<GitAvailability> {
  gitAvailabilityCache ??= probeGitAvailable()
  return gitAvailabilityCache
}

async function probeGitAvailable(): Promise<GitAvailability> {
  try {
    await git(process.cwd(), ['--version'])
    return { ok: true }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return { ok: false, message: 'error.git-not-found' }
    return { ok: false, message: err instanceof Error ? err.message : 'error.failed-read-repo' }
  }
}

/**
 * Run a git command, returning stdout. Throws on non-zero exit, timeout,
 * or abort. Wraps `child_process.execFile` so we can attach an
 * AbortController to the child — `promisify(execFile)` doesn't expose
 * the underlying ChildProcess to the caller.
 */
export function git(cwd: string, args: string[], opts?: GitOptions): Promise<string> {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  return new Promise((resolve, reject) => {
    let child: ChildProcess | null = null
    let settled = false
    const settleReject = (err: NodeJS.ErrnoException) => {
      if (settled) return
      settled = true
      reject(err)
    }
    const settleResolve = (out: string) => {
      if (settled) return
      settled = true
      resolve(out)
    }

    child = execFile(
      'git',
      args,
      {
        encoding: 'utf-8',
        cwd,
        // Some repos can produce large outputs (log, for-each-ref). 10MB headroom.
        maxBuffer: 10 * 1024 * 1024,
        timeout: timeoutMs,
      },
      (error, stdout) => {
        if (error) {
          // Preserve stderr / signal info for stripNoise + timeout detection.
          const e = error as NodeJS.ErrnoException & { stderr?: string }
          settleReject(e)
          return
        }
        settleResolve(typeof stdout === 'string' ? stdout.trimEnd() : String(stdout))
      },
    )

    if (opts?.signal) {
      const onAbort = () => {
        if (!child || settled) return
        // SIGTERM first — git generally responds promptly. We force-kill
        // after a short grace if it doesn't.
        try {
          child.kill('SIGTERM')
        } catch {
          /* already gone */
        }
        const grace = setTimeout(() => {
          try {
            child?.kill('SIGKILL')
          } catch {
            /* gone */
          }
        }, 500)
        // Don't keep the event loop alive just for the grace timer.
        if ('unref' in grace && typeof grace.unref === 'function') grace.unref()
      }
      if (opts.signal.aborted) onAbort()
      else opts.signal.addEventListener('abort', onAbort, { once: true })
    }
  })
}

export async function gitResult(cwd: string, ...args: string[]): Promise<ExecResult> {
  return gitResultWithOptions(cwd, undefined, ...args)
}

export async function gitResultWithOptions(
  cwd: string,
  opts: GitOptions | undefined,
  ...args: string[]
): Promise<ExecResult> {
  try {
    const output = await git(cwd, args, opts)
    return { ok: true, message: output }
  } catch (err: unknown) {
    const e = err as { stderr?: string; message?: string; killed?: boolean; signal?: string; code?: string }
    const stderr = typeof e.stderr === 'string' ? e.stderr : ''
    // Distinguish three "we ended the process" reasons. The user-visible
    // copy is short on purpose — the renderer surfaces these via toast
    // and the kbps user is rarely interested in the underlying signal.
    if (opts?.signal?.aborted) {
      return { ok: false, message: 'cancelled' }
    }
    if (e.killed && e.signal === 'SIGTERM') {
      return { ok: false, message: `git timed out after ${(opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS) / 1000}s` }
    }
    const cleaned = stripNoise(stderr).trim()
    const message = cleaned || e.message || 'Unknown error'
    return { ok: false, message }
  }
}

/**
 * Drop transport noise (only the specific advisory lines we know about) so
 * the real git error surfaces in single-line UI notifications.
 *
 * Conservative on purpose: an earlier version of this also dropped any
 * line starting with `warning:`, but git itself emits real diagnostics
 * with that prefix (`warning: not deleting branch ...`, `warning: refusing
 * to lose untracked file ...`) that the user must see.
 *
 * If the only useful content is filtered out we fall back to the raw
 * stderr — losing nothing is more important than tidiness.
 */
function stripNoise(stderr: string): string {
  if (!stderr) return ''
  const lines = stderr.split('\n')
  const kept = lines.filter((line) => {
    const trimmed = line.trim()
    if (!trimmed) return false
    // macOS post-quantum SSH advisory + similar `**`-prefixed admonitions
    // that aren't part of the git error itself.
    if (trimmed.startsWith('**')) return false
    return true
  })
  if (kept.length === 0) return stderr.trim()
  return kept.join('\n')
}
