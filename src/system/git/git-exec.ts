import { execa, ExecaError } from 'execa'
import type { ExecResult } from '#/shared/git-types.ts'

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
 * or abort. Wraps execa so all git invocations share timeout, buffering
 * and cancellation behavior.
 */
export function git(cwd: string, args: string[], opts?: GitOptions): Promise<string> {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  return execa('git', args, {
    cwd,
    timeout: timeoutMs,
    cancelSignal: opts?.signal,
    forceKillAfterDelay: 500,
    // Some repos can produce large outputs (log, for-each-ref). 10MB headroom.
    maxBuffer: 10 * 1024 * 1024,
  }).then(({ stdout }) => stdout.trimEnd())
}

export async function gitResult(cwd: string, ...args: string[]): Promise<ExecResult> {
  return gitResultWithOptions(cwd, undefined, ...args)
}

export async function gitResultWithOptions(
  cwd: string,
  opts: GitOptions | undefined,
  ...args: string[]
): Promise<ExecResult> {
  if (opts?.signal?.aborted) return { ok: false, message: 'cancelled' }
  try {
    const output = await git(cwd, args, opts)
    return { ok: true, message: output }
  } catch (err: unknown) {
    // Distinguish three "we ended the process" reasons. The user-visible
    // copy is short on purpose — the client surfaces these via toast
    // and the kbps user is rarely interested in the underlying signal.
    if (err instanceof ExecaError) {
      if (opts?.signal?.aborted || err.isCanceled) return { ok: false, message: 'cancelled' }
      if (err.timedOut) {
        // No auto-clean of stray .lock files on timeout — we can't tell
        // ours from a concurrent tool's, and a stale-clean is worse than
        // the retry's "lock exists" stderr. Same conservative stance as
        // stripNoise below; revisit with data if this actually bites.
        return { ok: false, message: `git timed out after ${(opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS) / 1000}s` }
      }
      const stderr = typeof err.stderr === 'string' ? err.stderr : ''
      const cleaned = stripNoise(stderr).trim()
      return { ok: false, message: cleaned || err.message || 'Unknown error' }
    }
    return { ok: false, message: err instanceof Error ? err.message : 'Unknown error' }
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
