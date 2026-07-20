import { createHash } from 'node:crypto'
import { accessSync, constants as fsConstants, statSync } from 'node:fs'
import { chmod, mkdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execa, ExecaError } from 'execa'
import { FIELD_SEP, WORKTREE_STATUS_BATCH_BOUNDARY } from '#/system/git/parsers.ts'
import { shellQuote } from '#/system/remote-shell.ts'
import { DEFAULT_REPOSITORY_LOG_COUNT } from '#/shared/git-types.ts'
import type { RemoteWorkspaceTarget } from '#/shared/remote-workspace.ts'
import type { CreateWorktreeInput } from '#/shared/worktree-create.ts'

const SSH_COMMAND_TIMEOUT_MS = 15_000
const SSH_CONNECT_TIMEOUT_SEC = 10
/** Boot-probe timeout for the placeholder-tab hydrate path. Shorter than
 *  SSH_COMMAND_TIMEOUT_MS so slow networks get a fast "connecting"→"unreachable"
 *  transition, but long enough to ride out a VPN reconnect or a sleeping
 *  laptop's first SSH handshake on the ControlMaster. */
export const SSH_BOOT_PROBE_TIMEOUT_MS = 10_000
// One multiplexed socket per (alias, host, port, user) tuple, kept well
// under the macOS Unix-domain-socket 104-byte path limit. Using
// `os.tmpdir() + '%C'` (40 hex chars + ssh's random suffix) blows past
// that limit on typical macOS temp dirs, which manifests as every ssh
// call failing with "unix_listener: path ... too long for Unix domain
// socket" before the SSH handshake even starts. A short first-16-hex
// of a SHA-256 over the target tuple gives us plenty of room to spare
// while still being effectively unique per Goblin host.
const SSH_CONTROL_DIR = path.join(os.homedir(), '.goblin', 'ssh')
const SSH_CONTROL_PERSIST_SEC = 600

function controlPathFor(target: RemoteWorkspaceTarget): string {
  const key = target.sshConnection
    ? JSON.stringify([target.sshConnection.destination, ...target.sshConnection.options])
    : JSON.stringify([target.alias, target.host, target.port, target.user])
  const hash = createHash('sha256').update(key).digest('hex').slice(0, 16)
  return path.join(SSH_CONTROL_DIR, hash)
}

let controlDirReady: Promise<void> | null = null
function ensureControlDir(): Promise<void> {
  if (!controlDirReady) {
    controlDirReady = mkdir(SSH_CONTROL_DIR, { recursive: true, mode: 0o700 })
      .then(async () => {
        await chmod(SSH_CONTROL_DIR, 0o700)
      })
      .catch((err) => {
        controlDirReady = null
        throw err
      })
  }
  return controlDirReady
}
export const REMOTE_SNAPSHOT_CURRENT_MARKER = '__GOBLIN_REMOTE_CURRENT__'
export const REMOTE_SNAPSHOT_DEFAULT_MARKER = '__GOBLIN_REMOTE_DEFAULT__'
export const REMOTE_SNAPSHOT_BRANCHES_MARKER = '__GOBLIN_REMOTE_BRANCHES__'
export const REMOTE_PANE_WORKTREES_MARKER = '__GOBLIN_REMOTE_PANE_WORKTREES__'

export type RemoteCommandKind =
  | { type: 'printHome' }
  | { type: 'checkShell' }
  | { type: 'checkGit' }
  | { type: 'testDirectory'; path: string }
  | { type: 'listDirectories'; path: string; limit?: number }
  | { type: 'directoryOverview'; path: string }
  | { type: 'directoryChildren'; path: string; prefix?: string }
  | { type: 'gitDirectoryChildren'; path: string; prefix?: string }
  | { type: 'revParseTopLevel'; path: string }
  | { type: 'resolvePhysicalWorktreeIdentity'; path: string }
  | { type: 'gitSnapshot'; path: string }
  | { type: 'gitWorkspacePaneIdentities'; path: string }
  | { type: 'gitPatch'; path: string }
  | { type: 'gitWorktreeList'; path: string }
  | { type: 'gitWorktreeListAndStatus'; path: string }
  | { type: 'gitStatus'; path: string }
  | { type: 'gitLog'; path: string; branch: string; count?: number; skip?: number }
  | { type: 'gitFetchAll'; path: string }
  | { type: 'gitFetchRemote'; path: string; remote: string }
  | { type: 'gitStatusAll'; path: string }
  | { type: 'gitDiffNoIndex'; path: string; filePath: string }
  | { type: 'gitPullCurrent'; path: string }
  | { type: 'gitFetchBranch'; path: string; remote: string; remoteBranch: string; branch: string }
  | { type: 'gitPush'; path: string; remote: string; branch: string; targetBranch: string; setUpstream: boolean }
  | { type: 'gitPushDeleteBranch'; path: string; remote: string; branch: string }
  | { type: 'gitRemoteBranches'; path: string }
  | { type: 'gitWorktreeAdd'; path: string; input: CreateWorktreeInput }
  | { type: 'gitWorktreeRemove'; path: string; worktreePath: string }
  | { type: 'trashFile'; path: string; filePath: string }
  | { type: 'commandExists'; path: string; commandName: string }
  | { type: 'gitBranchDelete'; path: string; branch: string; force?: boolean }
  | { type: 'gitUpstream'; path: string; branch: string }
  | { type: 'gitIsAncestor'; path: string; ancestor: string; descendant: string }
  | { type: 'gitRemoteVerbose'; path: string }
  | { type: 'gitRemoteGetUrl'; path: string }
  | { type: 'readRemoteFile'; path: string }
  | {
      type: 'bootstrapRemoteWorktree'
      sourceRoot: string
      targetRoot: string
      copy: string[]
      symlink: string[]
      hardlink: string[]
      exclude: string[]
      setup?: string
    }

export interface RemoteCommandResult {
  ok: boolean
  stdout: string
  stderr: string
  message?: string
  timedOut?: boolean
  remoteStarted?: boolean
  transportStderr?: string
}

export interface RemoteCommandInvocation {
  command: string
  args: string[]
  script: string
}

const SNAPSHOT_MANAGED_SSH_OPTIONS = new Set([
  'connecttimeout',
  'controlmaster',
  'controlpath',
  'controlpersist',
  'host',
  'hostname',
  'port',
  'requesttty',
  'stricthostkeychecking',
  'user',
])
const REMOTE_COMMAND_STARTED_MARKER = '__GOBLIN_REMOTE_COMMAND_STARTED__'
const REMOTE_COMMAND_STDERR_BEGIN_MARKER = '__GOBLIN_REMOTE_COMMAND_STDERR_BEGIN__'
const REMOTE_COMMAND_STDERR_END_MARKER = '__GOBLIN_REMOTE_COMMAND_STDERR_END__'

/** Converts one `ssh -G` result into argv-safe options that never consult config again. */
export function buildCanonicalSshConnectionSnapshot(
  target: Pick<RemoteWorkspaceTarget, 'alias' | 'host' | 'user' | 'port'>,
  effectiveConfig: string,
): NonNullable<RemoteWorkspaceTarget['sshConnection']> {
  const options = effectiveConfig
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const firstSpace = line.search(/\s/u)
      const key = (firstSpace === -1 ? line : line.slice(0, firstSpace)).toLowerCase()
      if (SNAPSHOT_MANAGED_SSH_OPTIONS.has(key)) return []
      const value = firstSpace === -1 ? '' : line.slice(firstSpace + 1).trim()
      return value ? [`${key}=${value}`] : []
    })
  return Object.freeze({
    // Keep the original argv host so OpenSSH's %n token retains alias semantics.
    // HostName below still fixes %h and the actual network destination.
    destination: target.alias,
    options: Object.freeze([`hostname=${target.host}`, `user=${target.user}`, `port=${target.port}`, ...options]),
  })
}

function capturedConnectionArgs(target: RemoteWorkspaceTarget): string[] {
  if (!target.sshConnection) return []
  const nullConfig = process.platform === 'win32' ? 'NUL' : '/dev/null'
  return ['-F', nullConfig, ...target.sshConnection.options.flatMap((option) => ['-o', option])]
}

export type RemoteCommandRunner = (
  command: RemoteCommandKind,
  target: RemoteWorkspaceTarget,
  options?: { signal?: AbortSignal; timeoutMs?: number },
) => Promise<RemoteCommandResult>

export function buildRemoteCommandInvocation(
  target: RemoteWorkspaceTarget,
  command: RemoteCommandKind,
): RemoteCommandInvocation {
  const script = scriptForCommand(command)
  return buildCanonicalSshInvocation(target, script, ['-T', '-o', 'RequestTTY=no'])
}

export function buildRemoteTerminalInvocation(
  target: RemoteWorkspaceTarget,
  remotePath: string,
  _size: { cols: number; rows: number },
  options: { startupShellCommand?: string } = {},
): RemoteCommandInvocation {
  const startupShellCommand = normalizeTerminalStartupShellCommand(options.startupShellCommand)
  // This invocation is prepared with the logical session, but it is not executed until
  // attach starts the remote PTY with the mounted xterm's fitted geometry.
  const script = startupShellCommand
    ? `cd ${shellQuote(remotePath)} && exec "\${SHELL:-/bin/sh}" -ilc ${shellQuote(`${startupShellCommand}\nexec "\${SHELL:-/bin/sh}" -l`)}`
    : `cd ${shellQuote(remotePath)} && exec "\${SHELL:-/bin/sh}" -l`
  return buildCanonicalSshInvocation(target, script, ['-tt'])
}

function buildCanonicalSshInvocation(
  target: RemoteWorkspaceTarget,
  script: string,
  ttyArgs: readonly string[],
): RemoteCommandInvocation {
  const args = [
    ...capturedConnectionArgs(target),
    ...ttyArgs,
    '-o',
    'StrictHostKeyChecking=yes',
    '-o',
    `ConnectTimeout=${SSH_CONNECT_TIMEOUT_SEC}`,
    '-o',
    `ControlPath=${controlPathFor(target)}`,
    '-o',
    `ControlMaster=auto`,
    '-o',
    `ControlPersist=${SSH_CONTROL_PERSIST_SEC}`,
  ]
  const destination = target.sshConnection?.destination ?? target.alias
  args.push('--', destination, `sh -lc ${shellQuote(script)}`)
  return { command: findExecutableOnPath('ssh') ?? 'ssh', args, script }
}

function normalizeTerminalStartupShellCommand(command: string | undefined): string {
  const withoutTrailingNewline = (command ?? '').replace(/[\r\n]+$/u, '')
  return withoutTrailingNewline.trim().length === 0 ? '' : withoutTrailingNewline
}

export async function runRemoteCommand(
  target: RemoteWorkspaceTarget,
  command: RemoteCommandKind,
  options?: { signal?: AbortSignal; timeoutMs?: number },
): Promise<RemoteCommandResult> {
  if (options?.signal?.aborted) return { ok: false, stdout: '', stderr: '', message: 'cancelled' }
  const invocation = buildCanonicalSshInvocation(target, commandStartedMarkerScript(scriptForCommand(command)), [
    '-T',
    '-o',
    'RequestTTY=no',
  ])
  // Ensure the ControlMaster socket directory exists. ssh will refuse to
  // create a control socket in a missing directory, which on a fresh
  // install manifests as every probe failing before the handshake.
  await ensureControlDir()
  try {
    const { stdout, stderr } = await execa(invocation.command, invocation.args, {
      timeout: options?.timeoutMs ?? SSH_COMMAND_TIMEOUT_MS,
      cancelSignal: options?.signal,
      forceKillAfterDelay: 500,
      maxBuffer: 2 * 1024 * 1024,
    })
    const parsed = parseRemoteCommandOutput(stdout, stderr)
    return { ok: true, stdout: parsed.stdout, stderr: parsed.stderr, remoteStarted: parsed.remoteStarted }
  } catch (err) {
    const e = err as { stdout?: unknown; stderr?: unknown; timedOut?: boolean; isCanceled?: boolean; message?: string }
    const parsed = parseRemoteCommandOutput(
      typeof e.stdout === 'string' ? e.stdout : '',
      typeof e.stderr === 'string' ? e.stderr : '',
    )
    const transport = parsed.remoteStarted ? { transportStderr: parsed.transportStderr } : {}
    if (options?.signal?.aborted || e.isCanceled === true) {
      return {
        ok: false,
        stdout: parsed.stdout,
        stderr: parsed.stderr,
        message: 'cancelled',
        remoteStarted: parsed.remoteStarted,
        ...transport,
      }
    }
    if (err instanceof ExecaError && e.timedOut) {
      return {
        ok: false,
        stdout: parsed.stdout,
        stderr: parsed.stderr,
        message: 'timeout',
        timedOut: true,
        remoteStarted: parsed.remoteStarted,
        ...transport,
      }
    }
    return {
      ok: false,
      stdout: parsed.stdout,
      stderr: parsed.stderr,
      message: parsed.stderr || parsed.transportStderr || e.message || 'unknown',
      remoteStarted: parsed.remoteStarted,
      ...transport,
    }
  }
}

function commandStartedMarkerScript(script: string): string {
  // OpenSSH writes both remote stderr and local client diagnostics to the
  // local stderr fd. Capture remote stderr on the host and replay it in a
  // framed block so callers can classify transport failures without mistaking
  // upstream Git/SSH errors for this SSH session.
  return [
    `printf '%s\n' ${shellQuote(REMOTE_COMMAND_STARTED_MARKER)}`,
    'goblin_old_umask=$(umask)',
    'umask 077',
    'if command -v mktemp >/dev/null 2>&1; then',
    '  goblin_stderr_dir=$(mktemp -d "${TMPDIR:-/tmp}/goblin-stderr.XXXXXX") || exit 125',
    'else',
    '  goblin_stderr_dir="${TMPDIR:-/tmp}/goblin-stderr.$$"',
    '  mkdir -m 700 -- "$goblin_stderr_dir" || exit 125',
    'fi',
    'goblin_stderr="$goblin_stderr_dir/stderr"',
    `trap 'rm -rf -- "$goblin_stderr_dir"' EXIT`,
    ': >"$goblin_stderr" || exit 125',
    'umask "$goblin_old_umask"',
    '(',
    script,
    ') 2>"$goblin_stderr"',
    'goblin_status=$?',
    `printf '%s\n' ${shellQuote(REMOTE_COMMAND_STDERR_BEGIN_MARKER)} >&2`,
    'cat -- "$goblin_stderr" >&2',
    `printf '\\n%s\\n' ${shellQuote(REMOTE_COMMAND_STDERR_END_MARKER)} >&2`,
    'exit "$goblin_status"',
  ].join('\n')
}

function parseRemoteCommandOutput(
  stdout: string,
  stderr: string,
): { stdout: string; stderr: string; transportStderr: string; remoteStarted: boolean } {
  const stripped = stripCommandStartedMarker(stdout.trimEnd())
  const split = splitRemoteCommandStderr(stderr.trimEnd())
  return {
    stdout: stripped.stdout,
    stderr: split.stderr,
    transportStderr: split.transportStderr,
    remoteStarted: stripped.remoteStarted,
  }
}

function splitRemoteCommandStderr(stderr: string): { stderr: string; transportStderr: string } {
  const lines = stderr.split('\n')
  let endIndex = -1
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index] !== REMOTE_COMMAND_STDERR_END_MARKER) continue
    endIndex = index
    break
  }
  // Incomplete framing means stderr was not safely separated. Keep the raw
  // text visible as command stderr, but do not expose it as transport stderr.
  if (endIndex === -1) return { stderr, transportStderr: '' }
  const beginIndex = lines.findIndex((line, index) => index < endIndex && line === REMOTE_COMMAND_STDERR_BEGIN_MARKER)
  if (beginIndex === -1) return { stderr, transportStderr: '' }

  const remoteStderr = lines
    .slice(beginIndex + 1, endIndex)
    .join('\n')
    .trimEnd()
  const before = lines.slice(0, beginIndex).join('\n').trimEnd()
  const after = lines
    .slice(endIndex + 1)
    .join('\n')
    .trimEnd()
  const transportStderr = [before, after].filter(Boolean).join('\n').trimEnd()
  return { stderr: remoteStderr, transportStderr }
}

function stripCommandStartedMarker(stdout: string): { stdout: string; remoteStarted: boolean } {
  const lines = stdout.split('\n')
  const markerIndex = lines.findIndex((line) => line === REMOTE_COMMAND_STARTED_MARKER)
  if (markerIndex === -1) return { stdout, remoteStarted: false }
  return { stdout: lines.slice(markerIndex + 1).join('\n'), remoteStarted: true }
}

function scriptForCommand(command: RemoteCommandKind): string {
  switch (command.type) {
    case 'printHome':
      return `printf '%s\n' "$HOME"`
    case 'checkShell':
      return `printf '%s\n' ok`
    case 'checkGit':
      return 'command -v git'
    case 'testDirectory':
      return `cd ${shellQuote(command.path)} && test -r . && pwd -P`
    case 'listDirectories': {
      const limit = Math.max(1, Math.min(50, Math.floor(command.limit ?? 20)))
      return `find ${shellQuote(
        command.path,
      )} -mindepth 1 -maxdepth 1 -type d -print 2>/dev/null | LC_ALL=C sort | head -n ${limit}`
    }
    case 'directoryOverview': {
      const root = shellQuote(command.path)
      return [
        `cd ${root} || exit $?`,
        `files=0; directories=0`,
        `for entry in ./* ./.[!.]* ./..?*; do`,
        `  if [ ! -e "$entry" ] || [ -L "$entry" ]; then continue; fi`,
        `  if [ -f "$entry" ]; then files=$((files + 1)); elif [ -d "$entry" ]; then directories=$((directories + 1)); fi`,
        `done`,
        `bytes=-`,
        `if stat -c '%s' . >/dev/null 2>&1; then`,
        `  if file_sizes=$(find . -type f -exec stat -c '%s' {} + 2>/dev/null); then`,
        `    bytes=$(printf '%s\\n' "$file_sizes" | awk '{sum += $1} END {printf "%.0f", sum}')`,
        `  fi`,
        `elif stat -f '%z' . >/dev/null 2>&1; then`,
        `  if file_sizes=$(find . -type f -exec stat -f '%z' {} + 2>/dev/null); then`,
        `    bytes=$(printf '%s\\n' "$file_sizes" | awk '{sum += $1} END {printf "%.0f", sum}')`,
        `  fi`,
        `else`,
        `  bytes=-`,
        `fi`,
        `printf '%s\\t%s\\t%s\\n' "$files" "$directories" "$bytes"`,
      ].join('\n')
    }
    case 'directoryChildren': {
      return remoteDirectoryChildrenScript(command.path, command.prefix)
    }
    case 'gitDirectoryChildren':
      return remoteGitDirectoryChildrenScript(command.path, command.prefix)
    case 'revParseTopLevel':
      return [
        `root=$(git -C ${shellQuote(command.path)} rev-parse --show-toplevel) || exit $?`,
        `cd "$root" && pwd -P`,
      ].join('\n')
    case 'resolvePhysicalWorktreeIdentity':
      return remotePhysicalWorktreeIdentityScript(command.path)
    case 'gitSnapshot': {
      const repo = shellQuote(command.path)
      const branchFormat = [
        '%(refname:short)',
        '%(objectname)',
        '%(objectname:short)',
        '%(subject)',
        '%(authordate:iso-strict)',
        '%(authorname)',
        '%(upstream:short)',
        '%(upstream:track)',
      ].join(FIELD_SEP)
      return [
        `printf '%s\n' ${shellQuote(REMOTE_SNAPSHOT_CURRENT_MARKER)}`,
        `git -C ${repo} symbolic-ref --short HEAD 2>/dev/null || true`,
        `printf '%s\n' ${shellQuote(REMOTE_SNAPSHOT_DEFAULT_MARKER)}`,
        `git -C ${repo} symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's#^origin/##'`,
        `printf '%s\n' ${shellQuote(REMOTE_SNAPSHOT_BRANCHES_MARKER)}`,
        `git -C ${repo} for-each-ref --format=${shellQuote(branchFormat)} refs/heads/`,
      ].join('\n')
    }
    case 'gitWorkspacePaneIdentities': {
      const repo = shellQuote(command.path)
      return [
        'set -e',
        `git -C ${repo} for-each-ref --format=${shellQuote('%(refname:short)')} refs/heads/`,
        `printf '\\n%s\\n' ${shellQuote(REMOTE_PANE_WORKTREES_MARKER)}`,
        `git -C ${repo} worktree list --porcelain`,
      ].join('\n')
    }
    case 'gitPatch':
      return `git -C ${shellQuote(command.path)} diff HEAD --binary`
    case 'gitStatusAll':
      return `git -C ${shellQuote(command.path)} status --porcelain -z -uall`
    case 'gitDiffNoIndex':
      return [
        `git -C ${shellQuote(command.path)} diff --binary --no-index -- /dev/null ${shellQuote(command.filePath)}`,
        'code=$?',
        '[ "$code" -eq 0 ] || [ "$code" -eq 1 ]',
      ].join('; ')
    case 'gitWorktreeList':
      return `git -C ${shellQuote(command.path)} worktree list --porcelain`
    case 'gitWorktreeListAndStatus': {
      // One SSH call that returns BOTH:
      //   (a) the worktree list, parsable by parseWorktrees; and
      //   (b) per-worktree status output, NUL-batched below the
      //       boundary marker.
      //
      // Output shape:
      //   <git worktree list --porcelain, blocks separated by blank lines>
      //   \n__GOBLIN_WT_BATCH_BOUNDARY__\n
      //   <wt1_path>\0<status records, NUL-separated>\0
      //   <wt2_path>\0<status records>\0
      //   ...
      //
      // Each per-worktree section begins with a NUL-terminated path
      // and ends with an extra NUL (an empty NUL record), so the
      // parser can walk NUL-split records without needing line
      // boundaries -- important because `git status -z` paths can
      // contain literal newlines when paths with newlines are quoted.
      // The boundary is on its own line in the worktree-list stream;
      // `splitWorktreeStatusBatch` searches for `\n<marker>\n`. Every
      // line in `git worktree list --porcelain` is prefixed by a
      // keyword (`worktree`, `HEAD`, `branch`, `detached`, `bare`,
      // `locked`) so the marker text can never appear as a
      // legitimate standalone line.
      //
      // Bare worktrees (the bare flag in their porcelain block) are
      // skipped in the status stream so the parser does not have to
      // deal with `git status` failing in a bare repo. The full list
      // above the boundary still includes bare entries, which the
      // caller needs for `parseWorktrees` (it sets `isBare`).
      const repo = shellQuote(command.path)
      return [
        // Capture the worktree list once and require that authoritative
        // membership read to succeed. Reusing the captured file keeps the
        // emitted list and the generated status jobs on the same projection.
        `WT_TMPDIR=$(mktemp -d)`,
        `export WT_TMPDIR`,
        `trap 'rm -rf "$WT_TMPDIR"' EXIT`,
        `if ! git -C ${repo} worktree list --porcelain > "$WT_TMPDIR/worktrees"; then exit 1; fi`,
        `cat "$WT_TMPDIR/worktrees"`,
        // Emit the boundary marker on its own line. printf format
        // `\n%s\n` puts newlines around the single-quoted marker
        // text. The marker is plain ASCII -- no RS bytes or other
        // shell-fragile quoting required -- so the line below is
        // exactly what the remote shell will execute.
        `printf '\\n%s\\n' '${WORKTREE_STATUS_BATCH_BOUNDARY}'`,
        // Parallel per-worktree `git status`, fanned out via
        // xargs -P 8. Each worker writes its NUL section to an
        // indexed file in a per-session tmpdir; the final loop
        // concatenates files in the original worktree-list order
        // so the parser walks sections deterministically. Index
        // names are zero-padded so plain glob order is also
        // numeric order.
        //
        // The previous sequential `while read -r wt; do ...; done`
        // was a perf regression (F5): wall time scaled as N *
        // per-status-time instead of ceil(N/8) * per-status-time.
        // On a repo with 12 worktrees that is a ~6x slowdown.
        // Build a jobs file. Each line is one worktree:
        //   "<idx>\t<path>\n"
        // (TAB-separated). The original shape used a NUL separator
        // between idx and path with `xargs -n2`, which silently
        // dropped the trailing single record on odd job counts
        // under GNU xargs with `-x` (G1). Switching to a TAB-
        // separated line keeps the protocol line-based. idx is always
        // five digits, so the worker can split the line with POSIX
        // parameter expansion instead of shell-specific TAB escapes.
        //
        // idx is a zero-padded integer (printf %05d -- five chars
        // wide so plain glob order is also numeric order up to
        // 99,999 worktrees).
        //
        // The awk splits the porcelain output on blank-line blocks
        // (RS="") so we can inspect each worktree block as a single
        // record and skip blocks containing a bare or prunable marker. Paths
        // registered with relative arguments are passed through
        // verbatim; the worker resolves them via
        // `git rev-parse --show-toplevel`.
        //
        // TAB is the field separator. POSIX paths are technically
        // allowed to contain TAB, but in practice users never
        // register worktree paths with one; if they ever do, the
        // script will silently produce an incorrect split --
        // acceptable because this script runs only on hosts that
        // already accept worktree paths, and the rest of the
        // system treats them as opaque strings.
        `awk -v RS= 'BEGIN { idx = 0 }`,
        `  /(^|\\n)bare(\\n|$)/ { next }`,
        `  /(^|\\n)prunable([ \\t]|\\n|$)/ { next }`,
        `  match($0, /^worktree[ \\t]+/) {`,
        `    p = substr($0, RSTART + RLENGTH); sub(/\\n.*/, "", p);`,
        `    if (p != "") { idx++; printf "%05d\\t%s\\n", idx, p }`,
        `  }' "$WT_TMPDIR/worktrees" > "$WT_TMPDIR/jobs"`,
        // Fan out workers as POSIX shell background processes (F5). The
        // previous `xargs -I {} -P 8` shape worked under GNU xargs
        // but broke in two ways:
        //   - `xargs -I {}` collapses runs of whitespace in the
        //     input line (it treats the line as whitespace-separated
        //     tokens), so the TAB inside our `<idx>\t<path>` jobs
        //     gets replaced with a space. The worker then sees the
        //     whole line as one field and IFS splitting is a no-op.
        //   - `xargs -n2` against a NUL-delimited stream silently
        //     drops the trailing single record on odd job counts
        //     under GNU xargs with `-x` (G1).
        // Background processes avoid both traps: `read` consumes the
        // whole line and POSIX parameter expansion separates the fixed
        // width idx from the path. Parallelism is bounded by a simple
        // FIFO pid queue instead of an external tool. We also get
        // ordered output for free by writing each section to its
        // `<idx>.out` file -- the final concat loop reads in glob order,
        // which is numeric order thanks to zero-padding.
        //
        // Semaphore: cap the in-flight count at 8 by waiting for the
        // oldest tracked pid before launching another worker. This
        // keeps the script compatible with the `sh -lc` invocation:
        // no Bash-only `$'...'`, no Bash 4.3+ `wait -n`, no GNU xargs.
        `pending=0`,
        `max_in_flight=8`,
        `pids=`,
        `while IFS= read -r job; do`,
        `  idx=\${job%%	*}`,
        `  wt=\${job#*	}`,
        // Wait for the oldest tracked worker when the queue reaches the
        // concurrency cap. We intentionally wait by pid instead of using
        // `wait -n` so the script runs under POSIX `sh`.
        `  while [ "$pending" -ge "$max_in_flight" ]; do`,
        `    first_pid=\${pids%% *}`,
        `    if [ "$first_pid" = "$pids" ]; then`,
        `      pids=`,
        `    else`,
        `      pids=\${pids#* }`,
        `    fi`,
        `    wait "$first_pid" 2>/dev/null || true`,
        `    pending=$((pending - 1))`,
        `  done`,
        `  (`,
        // Each worker builds its NUL section in <tmpdir>/<idx>.tmp and
        // publishes <idx>.out only after `git status` succeeds.
        // A worktree the script cannot enter also produces no published
        // section, so the complete-read parser rejects the response.
        `    if ! cd "$wt" 2>/dev/null; then exit 0; fi`,
        `    abs=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0`,
        `    tmp="$WT_TMPDIR/$idx.tmp"`,
        `    out="$WT_TMPDIR/$idx.out"`,
        `    printf "%s\\0" "$abs" > "$tmp"`,
        `    if ! git -C "$abs" status --porcelain -z -uall 2>/dev/null >> "$tmp"; then rm -f "$tmp"; exit 0; fi`,
        `    printf "\\0" >> "$tmp"`,
        `    mv "$tmp" "$out"`,
        `  ) &`,
        `  pid=$!`,
        `  if [ -n "$pids" ]; then`,
        `    pids="$pids $pid"`,
        `  else`,
        `    pids="$pid"`,
        `  fi`,
        `  pending=$((pending + 1))`,
        `done < "$WT_TMPDIR/jobs"`,
        `for pid in $pids; do`,
        `  wait "$pid" 2>/dev/null || true`,
        `done`,
        // Concatenate in index order. Any worker failure leaves no .out
        // file, which the complete-read parser rejects as a missing section.
        // A bare-only repository legitimately has no output files, so the
        // loop must still finish successfully in that case.
        `for f in "$WT_TMPDIR"/*.out; do`,
        `  [ -f "$f" ] || continue`,
        `  cat "$f" || exit 1`,
        `done`,
        `:`,
      ].join('\n')
    }
    case 'gitStatus':
      return `git -C ${shellQuote(command.path)} status --porcelain -z`
    case 'gitLog': {
      const count = Math.max(1, Math.min(1000, Math.floor(command.count ?? DEFAULT_REPOSITORY_LOG_COUNT)))
      const skip = Math.max(0, Math.floor(command.skip ?? 0))
      const format = ['%H', '%h', '%D', '%s', '%an', '%aI'].join(FIELD_SEP)
      return [
        `git -C ${shellQuote(command.path)} log`,
        '--decorate=short',
        `--format=${shellQuote(format)}`,
        `--max-count=${count}`,
        `--skip=${skip}`,
        shellQuote(command.branch),
        '--',
      ].join(' ')
    }
    case 'gitFetchAll':
      return `git -C ${shellQuote(command.path)} fetch --all --prune`
    case 'gitFetchRemote':
      return `git -C ${shellQuote(command.path)} fetch --prune -- ${shellQuote(command.remote)}`
    case 'gitPullCurrent':
      return `git -C ${shellQuote(command.path)} pull --ff-only`
    case 'gitFetchBranch':
      return `git -C ${shellQuote(command.path)} fetch -- ${shellQuote(command.remote)} ${shellQuote(
        `${command.remoteBranch}:${command.branch}`,
      )}`
    case 'gitPush':
      return [
        `git -C ${shellQuote(command.path)} push`,
        command.setUpstream ? '-u' : '',
        '--',
        shellQuote(command.remote),
        shellQuote(`${command.branch}:${command.targetBranch}`),
      ]
        .filter(Boolean)
        .join(' ')
    case 'gitPushDeleteBranch':
      return `git -C ${shellQuote(command.path)} push --delete -- ${shellQuote(command.remote)} ${shellQuote(
        command.branch,
      )}`
    case 'gitRemoteBranches':
      return `git -C ${shellQuote(command.path)} for-each-ref ${shellQuote('--format=%(refname:short)')} refs/remotes/`
    case 'gitWorktreeAdd':
      return `git -C ${shellQuote(command.path)} worktree add ${remoteWorktreeAddArgs(command.input)}`
    case 'gitWorktreeRemove':
      return `git -C ${shellQuote(command.path)} worktree remove -- ${shellQuote(command.worktreePath)}`
    case 'trashFile':
      return remoteTrashFileScript(command.path, command.filePath)
    case 'commandExists':
      return remoteCommandExistsScript(command.path, command.commandName)
    case 'gitBranchDelete':
      return `git -C ${shellQuote(command.path)} branch ${command.force ? '-D' : '-d'} -- ${shellQuote(command.branch)}`
    case 'gitUpstream':
      return `git -C ${shellQuote(command.path)} rev-parse --abbrev-ref ${shellQuote(`${command.branch}@{u}`)}`
    case 'gitIsAncestor':
      return `git -C ${shellQuote(command.path)} merge-base --is-ancestor -- ${shellQuote(
        command.ancestor,
      )} ${shellQuote(command.descendant)}`
    case 'gitRemoteGetUrl':
      return `git -C ${shellQuote(command.path)} remote get-url origin`
    case 'gitRemoteVerbose':
      return `git -C ${shellQuote(command.path)} remote -v`
    case 'readRemoteFile':
      return [
        `if [ ! -e ${shellQuote(command.path)} ] && [ ! -L ${shellQuote(command.path)} ]; then exit 0; fi`,
        `if [ ! -f ${shellQuote(command.path)} ]; then printf '%s\\n' ${shellQuote(
          `error: remote file is not readable: ${command.path}`,
        )} >&2; exit 1; fi`,
        `cat -- ${shellQuote(command.path)}`,
      ].join('\n')
    case 'bootstrapRemoteWorktree':
      return remoteBootstrapScript(command)
  }
  const exhaustive: never = command
  return exhaustive
}

function remotePhysicalWorktreeIdentityScript(worktreePath: string): string {
  return [
    'umask 077',
    'uid=$(id -u) || exit 1',
    'if [ -n "${XDG_RUNTIME_DIR:-}" ] && [ -d "$XDG_RUNTIME_DIR" ]; then',
    '  runtime_dir=$XDG_RUNTIME_DIR',
    'else',
    '  runtime_dir="/tmp/goblin-runtime-$uid"',
    '  [ ! -L "$runtime_dir" ] || exit 1',
    '  mkdir -p -- "$runtime_dir" || exit 1',
    'fi',
    'owner=$(stat -c %u "$runtime_dir" 2>/dev/null || stat -f %u "$runtime_dir" 2>/dev/null) || exit 1',
    '[ "$owner" = "$uid" ] || exit 1',
    'chmod 700 -- "$runtime_dir" || exit 1',
    'state_dir="$runtime_dir/goblin"',
    'identity_file="$state_dir/execution-namespace-id"',
    'mkdir -p -- "$state_dir"',
    'if [ ! -s "$identity_file" ]; then',
    '  tmp="$identity_file.tmp.$$"',
    "  token=$(od -An -N16 -tx1 /dev/urandom 2>/dev/null | tr -d ' \\n')",
    '  case "$token" in (*[!0-9a-f]*) rm -f -- "$tmp"; exit 1;; esac',
    '  [ "${#token}" -eq 32 ] || { rm -f -- "$tmp"; exit 1; }',
    '  printf \'%s\\n\' "$token" > "$tmp"',
    '  chmod 600 -- "$tmp"',
    '  ln -- "$tmp" "$identity_file" 2>/dev/null || true',
    '  rm -f -- "$tmp"',
    'fi',
    'runtime_token=$(cat -- "$identity_file")',
    'case "$runtime_token" in (*[!0-9a-f]*) exit 1;; esac',
    '[ "${#runtime_token}" -eq 32 ] || exit 1',
    'machine_fact=',
    'for machine_id_file in /etc/machine-id /var/lib/dbus/machine-id; do',
    '  [ -r "$machine_id_file" ] || continue',
    '  machine_fact=$(tr -cd "A-Za-z0-9._:-" < "$machine_id_file" | head -c 128)',
    '  [ -n "$machine_fact" ] && break',
    'done',
    'if [ -z "$machine_fact" ]; then',
    '  machine_fact=$(uname -n 2>/dev/null | tr -cd "A-Za-z0-9._:-" | head -c 128)',
    'fi',
    '[ -n "$machine_fact" ] || exit 1',
    'root_namespace_fact=$(readlink /proc/self/ns/mnt 2>/dev/null | tr -cd "A-Za-z0-9._:-" | head -c 128)',
    'if [ -z "$root_namespace_fact" ]; then',
    '  root_namespace_fact=$(stat -c "%d:%i" / 2>/dev/null || stat -f "%d:%i" / 2>/dev/null)',
    '  root_namespace_fact=$(printf "%s" "$root_namespace_fact" | tr -cd "A-Za-z0-9._:-" | head -c 128)',
    'fi',
    '[ -n "$root_namespace_fact" ] || exit 1',
    `canonical=$(cd -- ${shellQuote(worktreePath)} && pwd -P) || exit 1`,
    'endpoint_stat=$(stat -c "%d %i" "$canonical" 2>/dev/null || stat -f "%d %i" "$canonical" 2>/dev/null) || exit 1',
    'set -- $endpoint_stat',
    '[ "$#" -eq 2 ] || exit 1',
    'case "$1:$2" in (*[!0-9:]*) exit 1;; esac',
    'printf \'%s\\0%s\\0%s\\0%s\\0%s\\0%s\\0\' "$runtime_token" "$machine_fact" "$root_namespace_fact" "$canonical" "$1" "$2"',
  ].join('\n')
}

function remoteTrashFileScript(worktreePath: string, filePath: string): string {
  const worktree = shellQuote(worktreePath)
  const file = shellQuote(filePath)
  return [
    `cd -- ${worktree}`,
    `if [ ! -e ${file} ] && [ ! -L ${file} ]; then printf '%s\\n' 'error.file-not-found' >&2; exit 65; fi`,
    `if [ -d ${file} ]; then printf '%s\\n' 'error.filetree-delete-directory-unsupported' >&2; exit 66; fi`,
    `if command -v gio >/dev/null 2>&1; then exec gio trash -- ${file}; fi`,
    `if command -v trash-put >/dev/null 2>&1; then exec trash-put -- ${file}; fi`,
    `if command -v kioclient6 >/dev/null 2>&1; then exec kioclient6 move ${file} trash:/; fi`,
    `if command -v kioclient5 >/dev/null 2>&1; then exec kioclient5 move ${file} trash:/; fi`,
    `printf '%s\\n' 'error.trash-unavailable' >&2`,
    `exit 64`,
  ].join('\n')
}

function remoteDirectoryChildrenScript(rootPath: string, prefix: string | undefined): string {
  const { root, dir } = remoteDirectoryPaths(rootPath, prefix)
  return [
    `root=${root}`,
    `dir=${dir}`,
    'if [ ! -e "$dir" ]; then printf "%s\\n" "error.workspace-path-not-found" >&2; exit 66; fi',
    'if [ ! -d "$dir" ]; then printf "%s\\n" "error.workspace-path-not-directory" >&2; exit 67; fi',
    'if [ ! -r "$dir" ]; then printf "%s\\n" "error.workspace-permission-denied" >&2; exit 68; fi',
    'find "$dir" -mindepth 1 -maxdepth 1 ! -name .git -exec sh -c \'',
    'root=$1',
    'shift',
    'for entry do',
    '  rel=${entry#"$root"/}',
    '  if [ -d "$entry" ]; then printf "%s/\\0" "$rel"; else printf "%s\\0" "$rel"; fi',
    'done',
    '\' sh "$root" {} +',
  ].join('\n')
}

function remoteGitDirectoryChildrenScript(rootPath: string, prefix: string | undefined): string {
  const { root, dir } = remoteDirectoryPaths(rootPath, prefix)
  return [
    `root=${root}`,
    `dir=${dir}`,
    'if [ ! -e "$dir" ]; then printf "%s\\n" "error.workspace-path-not-found" >&2; exit 66; fi',
    'if [ ! -d "$dir" ]; then printf "%s\\n" "error.workspace-path-not-directory" >&2; exit 67; fi',
    'if [ ! -r "$dir" ]; then printf "%s\\n" "error.workspace-permission-denied" >&2; exit 68; fi',
    'find "$dir" -mindepth 1 -maxdepth 1 ! -name .git -exec sh -c \'',
    'root=$1',
    'shift',
    'for entry do',
    '  rel=${entry#"$root"/}',
    '  if git -C "$root" check-ignore -q -- "$rel"; then',
    '    git -C "$root" ls-files -- "$rel" | IFS= read -r _tracked || continue',
    '  fi',
    '  if [ -d "$entry" ]; then printf "%s/\\0" "$rel"; else printf "%s\\0" "$rel"; fi',
    'done',
    '\' sh "$root" {} +',
  ].join('\n')
}

function remoteDirectoryPaths(rootPath: string, prefix: string | undefined): { root: string; dir: string } {
  const root = shellQuote(rootPath)
  const normalizedPrefix = (prefix ?? '')
    .replace(/^\.\/+/, '')
    .replace(/^\/+/, '')
    .replace(/\/+$/u, '')
  const dir = normalizedPrefix ? `${root}/${shellQuote(normalizedPrefix)}` : root
  return { root, dir }
}

const REMOTE_COMMAND_NAME_RE = /^[A-Za-z0-9._+-]+$/

function remoteCommandExistsScript(worktreePath: string, commandName: string): string {
  if (!REMOTE_COMMAND_NAME_RE.test(commandName)) return 'exit 1'
  const check = `command -v ${shellQuote(commandName)} >/dev/null 2>&1`
  return [
    `cd -- ${shellQuote(worktreePath)}`,
    `if [ -n "$SHELL" ]; then "$SHELL" -ilc ${shellQuote(check)}; exit $?; fi`,
    `exec /bin/sh -c ${shellQuote(check)}`,
  ].join('\n')
}

function remoteWorktreeAddArgs(input: CreateWorktreeInput): string {
  switch (input.mode.kind) {
    case 'newBranch':
      return [
        '-b',
        shellQuote(input.mode.newBranch),
        '--',
        shellQuote(input.worktreePath),
        shellQuote(input.mode.baseRef),
      ].join(' ')
    case 'existingBranch':
      return ['--', shellQuote(input.worktreePath), shellQuote(input.mode.branch)].join(' ')
    case 'trackRemoteBranch':
      return [
        '-b',
        shellQuote(input.mode.localBranch),
        '--track',
        '--',
        shellQuote(input.worktreePath),
        shellQuote(input.mode.remoteRef),
      ].join(' ')
  }
  const exhaustive: never = input.mode
  return exhaustive
}

function remoteBootstrapScript(command: Extract<RemoteCommandKind, { type: 'bootstrapRemoteWorktree' }>): string {
  const inner = remoteBootstrapInnerScript(command)
  const quoted = shellQuote(inner)
  return [
    'command -v bash >/dev/null 2>&1 || { printf "%s\\n" "error: bash is required for worktree bootstrap" >&2; exit 1; }',
    `exec bash -c ${quoted}`,
  ].join('\n')
}

function remoteBootstrapInnerScript(command: Extract<RemoteCommandKind, { type: 'bootstrapRemoteWorktree' }>): string {
  const quote = shellQuote
  const copy = command.copy.map(quote).join(' ')
  const symlink = command.symlink.map(quote).join(' ')
  const hardlink = command.hardlink.map(quote).join(' ')
  const exclude = command.exclude.map(quote).join(' ')
  const setup = command.setup ? quote(command.setup) : "''"
  const sourceRoot = quote(command.sourceRoot)
  const targetRoot = quote(command.targetRoot)

  const lines: string[] = [
    'set -o pipefail',
    'shopt -s nullglob dotglob',
    'shopt -s globstar 2>/dev/null || true',
    '',
    'SOURCE_ROOT=' + sourceRoot,
    'TARGET_ROOT=' + targetRoot,
    '',
    'COPY_PATTERNS=(' + copy + ')',
    'SYMLINK_PATTERNS=(' + symlink + ')',
    'HARDLINK_PATTERNS=(' + hardlink + ')',
    'EXCLUDE_PATTERNS=(' + exclude + ')',
    'SETUP=' + setup,
    'SETUP_LOG=',
    '',
    'cleanup() {',
    '  if [ -n "$SETUP_LOG" ]; then rm -f -- "$SETUP_LOG"; fi',
    '}',
    'trap cleanup EXIT',
    '',
    'die() {',
    '  printf \'error: %s\\n\' "$1" >&2',
    '  exit 1',
    '}',
    '',
    'path_exists() {',
    '  [ -e "$1" ] || [ -L "$1" ]',
    '}',
    '',
    'has_git_segment() {',
    '  case "/$1/" in */.git/*) return 0;; esac',
    '  return 1',
    '}',
    '',
    'validate_rel() {',
    '  local rel="$1"',
    '  [ -n "$rel" ] || die "bootstrap path must not be empty"',
    '  case "$rel" in',
    '    "." ) die "bootstrap path must not target repo root: $rel" ;;',
    '    /* ) die "bootstrap path must be relative: $rel" ;;',
    '    ".."|../*|*/..|*/../* ) die "bootstrap path escapes repo root: $rel" ;;',
    '  esac',
    '  if has_git_segment "$rel"; then die "bootstrap path must not target .git: $rel"; fi',
    '}',
    '',
    'normalize_rel() {',
    '  REL="${1//\\\\//}"',
    '  while [[ "$REL" == */ ]]; do REL="${REL%/}"; done',
    '  [ -n "$REL" ] || REL="."',
    '  validate_rel "$REL"',
    '}',
    '',
    'rel_from_source_match() {',
    '  local match="$1" prefix="$SOURCE_ROOT/"',
    '  case "$match" in',
    '    "$prefix"*) REL="${match:${#prefix}}" ;;',
    '    "$SOURCE_ROOT") REL="." ;;',
    '    *) die "bootstrap path escapes repo root: $match" ;;',
    '  esac',
    '  REL="${REL//\\\\//}"',
    '  while [[ "$REL" == */ ]]; do REL="${REL%/}"; done',
    '  [ -n "$REL" ] || REL="."',
    '  if has_git_segment "$REL"; then return 1; fi',
    '  normalize_rel "$REL"',
    '}',
    '',
    'source_path_for_rel() {',
    '  SRC="$SOURCE_ROOT/$1"',
    '}',
    '',
    'target_path_for_rel() {',
    '  DST="$TARGET_ROOT/$1"',
    '}',
    '',
    'source_parent_has_symlink() {',
    '  local rel="$1" current="$SOURCE_ROOT" segment parent_rel i j',
    '  local -a parts',
    '  IFS=/ read -r -a parts <<< "$rel"',
    '  for ((i = 0; i < ${#parts[@]} - 1; i += 1)); do',
    '    segment="${parts[$i]}"',
    '    [ -n "$segment" ] || continue',
    '    current="$current/$segment"',
    '    if [ -L "$current" ]; then',
    '      parent_rel="${parts[0]}"',
    '      for ((j = 1; j <= i; j += 1)); do parent_rel="$parent_rel/${parts[$j]}"; done',
    '      SYMLINK_PARENT="$parent_rel"',
    '      return 0',
    '    fi',
    '  done',
    '  return 1',
    '}',
    '',
    'target_parent_has_symlink() {',
    '  local rel="$1" current="$TARGET_ROOT" segment parent_rel i j',
    '  local -a parts',
    '  IFS=/ read -r -a parts <<< "$rel"',
    '  for ((i = 0; i < ${#parts[@]} - 1; i += 1)); do',
    '    segment="${parts[$i]}"',
    '    [ -n "$segment" ] || continue',
    '    current="$current/$segment"',
    '    if [ -L "$current" ]; then',
    '      parent_rel="${parts[0]}"',
    '      for ((j = 1; j <= i; j += 1)); do parent_rel="$parent_rel/${parts[$j]}"; done',
    '      SYMLINK_PARENT="$parent_rel"',
    '      return 0',
    '    fi',
    '  done',
    '  return 1',
    '}',
    '',
    'is_dynamic_pattern() {',
    '  case "$1" in *\\**|*\\?*|*\\[*) return 0;; *) return 1;; esac',
    '}',
    '',
    'collect_matches() {',
    '  local pattern="$1" old_ifs',
    '  MATCHES=()',
    '  old_ifs=$IFS',
    '  IFS=',
    '  MATCHES=( "$SOURCE_ROOT"/$pattern )',
    '  IFS=$old_ifs',
    '}',
    '',
    'contains_path() {',
    '  local needle="$1" item',
    '  shift || true',
    '  for item in "$@"; do',
    '    if [ "$item" = "$needle" ]; then return 0; fi',
    '  done',
    '  return 1',
    '}',
    '',
    'append_missing() {',
    '  contains_path "$1" "${MISSING_PATHS[@]}" || MISSING_PATHS+=("$1")',
    '}',
    '',
    'append_excluded() {',
    '  contains_path "$1" "${EXCLUDED_PATHS[@]}" || EXCLUDED_PATHS+=("$1")',
    '}',
    '',
    'append_mode_path() {',
    '  local mode="$1" rel="$2"',
    '  case "$mode" in',
    '    copy) contains_path "$rel" "${COPY_PATHS[@]}" || COPY_PATHS+=("$rel") ;;',
    '    symlink) contains_path "$rel" "${SYMLINK_PATHS[@]}" || SYMLINK_PATHS+=("$rel") ;;',
    '    hardlink) contains_path "$rel" "${HARDLINK_PATHS[@]}" || HARDLINK_PATHS+=("$rel") ;;',
    '    *) die "unknown bootstrap mode: $mode" ;;',
    '  esac',
    '}',
    '',
    'append_ready_path() {',
    '  local mode="$1" rel="$2"',
    '  case "$mode" in',
    '    copy) READY_COPY_PATHS+=("$rel") ;;',
    '    symlink) READY_SYMLINK_PATHS+=("$rel") ;;',
    '    hardlink) READY_HARDLINK_PATHS+=("$rel") ;;',
    '    *) die "unknown bootstrap mode: $mode" ;;',
    '  esac',
    '}',
    '',
    'is_excluded() {',
    '  local rel="$1"',
    '  local ex',
    '  for ex in "${EXCLUDED_PATHS[@]}"; do',
    '    if [ "$rel" = "$ex" ] || [[ "$rel" = "$ex/"* ]]; then return 0; fi',
    '  done',
    '  return 1',
    '}',
    '',
    'EXCLUDED_PATHS=()',
    'COPY_PATHS=()',
    'SYMLINK_PATHS=()',
    'HARDLINK_PATHS=()',
    'MISSING_PATHS=()',
    'READY_COPY_PATHS=()',
    'READY_SYMLINK_PATHS=()',
    'READY_HARDLINK_PATHS=()',
    '',
    'for pattern in "${EXCLUDE_PATTERNS[@]}"; do',
    '  normalize_rel "$pattern"',
    '  pattern="$REL"',
    '  collect_matches "$pattern"',
    '  for match in "${MATCHES[@]}"; do',
    '    path_exists "$match" || continue',
    '    if ! rel_from_source_match "$match"; then continue; fi',
    '    rel="$REL"',
    '    append_excluded "$rel"',
    '  done',
    'done',
    '',
    'process_patterns() {',
    '  local mode="$1"',
    '  shift',
    '  local patterns=("$@")',
    '  local pattern match rel is_dynamic',
    '  for pattern in "${patterns[@]}"; do',
    '    normalize_rel "$pattern"',
    '    pattern="$REL"',
    '    if is_dynamic_pattern "$pattern"; then is_dynamic=1; else is_dynamic=0; fi',
    '    collect_matches "$pattern"',
    '    if [ "${#MATCHES[@]}" -eq 0 ] && [ "$is_dynamic" -eq 0 ]; then',
    '      append_missing "$pattern"',
    '      continue',
    '    fi',
    '    for match in "${MATCHES[@]}"; do',
    '      if ! path_exists "$match"; then',
    '        if [ "$is_dynamic" -eq 0 ]; then append_missing "$pattern"; fi',
    '        continue',
    '      fi',
    '      if ! rel_from_source_match "$match"; then continue; fi',
    '      rel="$REL"',
    '      append_mode_path "$mode" "$rel"',
    '    done',
    '  done',
    '}',
    '',
    'process_patterns copy "${COPY_PATTERNS[@]}"',
    'process_patterns symlink "${SYMLINK_PATTERNS[@]}"',
    'process_patterns hardlink "${HARDLINK_PATTERNS[@]}"',
    '',
    'filter_excluded_paths() {',
    '  local mode="$1" rel',
    '  FILTERED_PATHS=()',
    '  case "$mode" in',
    '    copy) for rel in "${COPY_PATHS[@]}"; do is_excluded "$rel" || FILTERED_PATHS+=("$rel"); done; COPY_PATHS=("${FILTERED_PATHS[@]}") ;;',
    '    symlink) for rel in "${SYMLINK_PATHS[@]}"; do is_excluded "$rel" || FILTERED_PATHS+=("$rel"); done; SYMLINK_PATHS=("${FILTERED_PATHS[@]}") ;;',
    '    hardlink) for rel in "${HARDLINK_PATHS[@]}"; do is_excluded "$rel" || FILTERED_PATHS+=("$rel"); done; HARDLINK_PATHS=("${FILTERED_PATHS[@]}") ;;',
    '    *) die "unknown bootstrap mode: $mode" ;;',
    '  esac',
    '}',
    '',
    'filter_excluded_paths copy',
    'filter_excluded_paths symlink',
    'filter_excluded_paths hardlink',
    '',
    'for rel in "${COPY_PATHS[@]}"; do',
    '  if contains_path "$rel" "${SYMLINK_PATHS[@]}" || contains_path "$rel" "${HARDLINK_PATHS[@]}"; then',
    '    die "path matches multiple materialization modes: $rel"',
    '  fi',
    'done',
    'for rel in "${SYMLINK_PATHS[@]}"; do',
    '  if contains_path "$rel" "${HARDLINK_PATHS[@]}"; then',
    '    die "path matches multiple materialization modes: $rel"',
    '  fi',
    'done',
    '',
    'preflight_mode() {',
    '  local mode="$1" rel src dst',
    '  shift',
    '  for rel in "$@"; do',
    '    source_path_for_rel "$rel"; src="$SRC"',
    '    target_path_for_rel "$rel"; dst="$DST"',
    '    if ! path_exists "$src"; then append_missing "$rel"; continue; fi',
    '    if source_parent_has_symlink "$rel"; then die "bootstrap path uses symlink parent: $SYMLINK_PARENT"; fi',
    '    if target_parent_has_symlink "$rel"; then die "bootstrap target path uses symlink parent: $SYMLINK_PARENT"; fi',
    '    if [ "$mode" = "hardlink" ] && { [ -L "$src" ] || [ ! -f "$src" ]; }; then',
    '      die "hardlink source is not a file: $rel"',
    '    fi',
    '    if path_exists "$dst"; then die "destination already exists: $rel"; fi',
    '    append_ready_path "$mode" "$rel"',
    '  done',
    '}',
    '',
    'preflight_mode copy "${COPY_PATHS[@]}"',
    'preflight_mode symlink "${SYMLINK_PATHS[@]}"',
    'preflight_mode hardlink "${HARDLINK_PATHS[@]}"',
    '',
    'ALL_PATHS=("${READY_COPY_PATHS[@]}" "${READY_SYMLINK_PATHS[@]}" "${READY_HARDLINK_PATHS[@]}")',
    'for parent in "${ALL_PATHS[@]}"; do',
    '  for child in "${ALL_PATHS[@]}"; do',
    '    if [ "$parent" != "$child" ] && [[ "$child" == "$parent/"* ]]; then',
    '      die "materialization paths overlap: $parent contains $child"',
    '    fi',
    '  done',
    'done',
    '',
    'copy_tree() {',
    '  local rel="$1" src dst child child_name',
    '  if is_excluded "$rel"; then return; fi',
    '  if has_git_segment "$rel"; then return; fi',
    '  source_path_for_rel "$rel"; src="$SRC"',
    '  target_path_for_rel "$rel"; dst="$DST"',
    '  if ! path_exists "$src"; then die "failed to copy $rel: source is missing"; fi',
    '  if source_parent_has_symlink "$rel"; then die "bootstrap path uses symlink parent: $SYMLINK_PARENT"; fi',
    '  if target_parent_has_symlink "$rel"; then die "bootstrap target path uses symlink parent: $SYMLINK_PARENT"; fi',
    '  if path_exists "$dst"; then die "destination already exists: $rel"; fi',
    '  if [ -d "$src" ] && [ ! -L "$src" ]; then',
    '    mkdir -p -- "$dst" || die "failed to copy $rel"',
    '    for child in "$src"/*; do',
    '      path_exists "$child" || continue',
    '      child_name="${child##*/}"',
    '      copy_tree "$rel/$child_name"',
    '    done',
    '    return',
    '  fi',
    '  mkdir -p -- "$(dirname "$dst")" || die "failed to copy $rel"',
    '  if target_parent_has_symlink "$rel"; then die "bootstrap target path uses symlink parent: $SYMLINK_PARENT"; fi',
    '  cp -P -- "$src" "$dst" || die "failed to copy $rel"',
    '}',
    '',
    'copy_item() {',
    '  local rel="$1"',
    '  copy_tree "$rel"',
    '  printf \'GOBLIN_BOOTSTRAP_COPY %s\\n\' "$rel"',
    '}',
    '',
    'symlink_item() {',
    '  local rel="$1" src dst',
    '  source_path_for_rel "$rel"; src="$SRC"',
    '  target_path_for_rel "$rel"; dst="$DST"',
    '  if ! path_exists "$src"; then die "failed to symlink $rel: source is missing"; fi',
    '  if source_parent_has_symlink "$rel"; then die "bootstrap path uses symlink parent: $SYMLINK_PARENT"; fi',
    '  if target_parent_has_symlink "$rel"; then die "bootstrap target path uses symlink parent: $SYMLINK_PARENT"; fi',
    '  if path_exists "$dst"; then die "destination already exists: $rel"; fi',
    '  mkdir -p -- "$(dirname "$dst")" || die "failed to symlink $rel"',
    '  if target_parent_has_symlink "$rel"; then die "bootstrap target path uses symlink parent: $SYMLINK_PARENT"; fi',
    '  ln -s -- "$src" "$dst" || die "failed to symlink $rel"',
    '  printf \'GOBLIN_BOOTSTRAP_SYMLINK %s\\n\' "$rel"',
    '}',
    '',
    'hardlink_item() {',
    '  local rel="$1" src dst',
    '  source_path_for_rel "$rel"; src="$SRC"',
    '  target_path_for_rel "$rel"; dst="$DST"',
    '  if ! path_exists "$src"; then die "failed to hardlink $rel: source is missing"; fi',
    '  if source_parent_has_symlink "$rel"; then die "bootstrap path uses symlink parent: $SYMLINK_PARENT"; fi',
    '  if target_parent_has_symlink "$rel"; then die "bootstrap target path uses symlink parent: $SYMLINK_PARENT"; fi',
    '  if [ -L "$src" ] || [ ! -f "$src" ]; then die "hardlink source is not a file: $rel"; fi',
    '  if path_exists "$dst"; then die "destination already exists: $rel"; fi',
    '  mkdir -p -- "$(dirname "$dst")" || die "failed to hardlink $rel"',
    '  if target_parent_has_symlink "$rel"; then die "bootstrap target path uses symlink parent: $SYMLINK_PARENT"; fi',
    '  ln -- "$src" "$dst" || die "failed to hardlink $rel"',
    '  printf \'GOBLIN_BOOTSTRAP_HARDLINK %s\\n\' "$rel"',
    '}',
    '',
    'for rel in "${READY_COPY_PATHS[@]}"; do copy_item "$rel"; done',
    'for rel in "${READY_SYMLINK_PATHS[@]}"; do symlink_item "$rel"; done',
    'for rel in "${READY_HARDLINK_PATHS[@]}"; do hardlink_item "$rel"; done',
    'for rel in "${MISSING_PATHS[@]}"; do',
    '  printf \'GOBLIN_BOOTSTRAP_MISSING %s\\n\' "$rel"',
    'done',
    '',
    'if [ -n "$SETUP" ]; then',
    '  SETUP_LOG="$(mktemp "${TMPDIR:-/tmp}/goblin-bootstrap-setup.XXXXXX")" || die "failed to create setup log"',
    '  if ! (cd "$TARGET_ROOT" && "${SHELL:-/bin/sh}" -ilc "$SETUP") >"$SETUP_LOG" 2>&1; then',
    '    printf \'error: setup failed: %s\\n\' "$SETUP" >&2',
    '    tail -c 8192 "$SETUP_LOG" >&2 || true',
    '    exit 1',
    '  fi',
    '  printf \'GOBLIN_BOOTSTRAP_SETUP %s\\n\' "$SETUP"',
    'fi',
  ]
  return lines.join('\n')
}

function findExecutableOnPath(name: string): string | null {
  const pathEnv = process.env.PATH || process.env.Path || process.env.path || ''
  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) continue
    for (const candidateName of executableNames(name)) {
      const candidate = path.join(dir, candidateName)
      if (isExecutableFile(candidate)) return candidate
    }
  }
  return null
}

function isExecutableFile(candidate: string): boolean {
  try {
    if (!statSync(candidate).isFile()) return false
    accessSync(candidate, fsConstants.X_OK)
    return true
  } catch {
    return false
  }
}

function executableNames(name: string): string[] {
  if (process.platform !== 'win32' || path.extname(name)) return [name]
  const extensions = (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD')
    .split(';')
    .map((ext) => ext.trim().toLowerCase())
    .filter(Boolean)
  return [name, ...extensions.map((ext) => `${name}${ext}`)]
}
