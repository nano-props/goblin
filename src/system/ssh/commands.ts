import { execa, ExecaError } from 'execa'
import { clamp } from 'es-toolkit'
import { FOR_EACH_REF_FIELD_SEP, PRETTY_FIELD_SEP } from '#/system/git/parsers.ts'
import { GIT_UPSTREAM_FORMAT } from '#/system/git/upstream.ts'
import { shellQuote } from '#/system/remote-shell.ts'
import { DEFAULT_REPOSITORY_LOG_COUNT } from '#/shared/git-types.ts'
import type { RemoteWorkspaceTarget } from '#/shared/remote-workspace.ts'
import type { CreateWorktreeInput } from '#/shared/worktree-create.ts'
import {
  buildCanonicalSshInvocation,
  ensureSshControlDirectory,
  type RemoteCommandInvocation,
} from '#/system/ssh/invocation.ts'
import { REMOTE_WORKTREE_BOOTSTRAP_RECORD_TAGS } from '#/system/ssh/worktree-bootstrap-protocol.ts'
import { loadRemoteWorktreeBootstrapScript } from '#/system/ssh/remote-worktree-bootstrap-script.ts'

const SSH_COMMAND_TIMEOUT_MS = 15_000
/** Boot-probe timeout for the placeholder-tab hydrate path. Shorter than
 *  SSH_COMMAND_TIMEOUT_MS so slow networks get a fast "connecting"→"unreachable"
 *  transition, but long enough to ride out a VPN reconnect or a sleeping
 *  laptop's first SSH handshake on the ControlMaster. */
export const SSH_BOOT_PROBE_TIMEOUT_MS = 10_000
export const REMOTE_SNAPSHOT_CURRENT_MARKER = '__GOBLIN_REMOTE_CURRENT__'
export const REMOTE_SNAPSHOT_DEFAULT_MARKER = '__GOBLIN_REMOTE_DEFAULT__'
export const REMOTE_SNAPSHOT_BRANCHES_MARKER = '__GOBLIN_REMOTE_BRANCHES__'
export const REMOTE_UNSUPPORTED_PLATFORM_MARKER = '__GOBLIN_UNSUPPORTED_PLATFORM__:'

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
  | { type: 'resolveRepoCommonDir'; path: string }
  | { type: 'gitSnapshot'; path: string }
  | { type: 'gitLocalBranches'; path: string }
  | { type: 'gitPatch'; path: string }
  | { type: 'gitWorktreeList'; path: string }
  | { type: 'gitStatus'; path: string }
  | { type: 'gitLog'; path: string; branch: string; count?: number; skip?: number }
  | { type: 'gitFetchRemote'; path: string; remote: string }
  | { type: 'gitStatusAll'; path: string }
  | { type: 'gitDiffNoIndex'; path: string; filePath: string }
  | { type: 'gitPullCurrent'; path: string }
  | { type: 'gitFetchBranch'; path: string; remote: string; remoteBranch: string; branch: string }
  | { type: 'gitPush'; path: string; remote: string; branch: string; targetBranch: string; setUpstream: boolean }
  | { type: 'gitPushDeleteBranch'; path: string; remote: string; branch: string }
  | { type: 'gitRemoteBranches'; path: string }
  | { type: 'gitRemoteFetchSpecs'; path: string; remote: string }
  | { type: 'gitWorktreeAdd'; path: string; input: CreateWorktreeInput }
  | { type: 'gitWorktreeRemove'; path: string; worktreePath: string }
  | { type: 'trashFile'; path: string; filePath: string }
  | { type: 'commandExists'; path: string; commandName: string }
  | { type: 'gitBranchDelete'; path: string; branch: string; force?: boolean }
  | { type: 'gitUpstream'; path: string; branch: string }
  | { type: 'gitIsAncestor'; path: string; ancestor: string; descendant: string }
  | { type: 'gitRemoteVerbose'; path: string }
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
  /** SSH exited successfully without proving that the Goblin remote command started. */
  remoteStartUnconfirmed?: true
  /** Locally authoritative proof that SSH was not invoked. */
  commandNotStarted?: true
  transportStderr?: string
}

const REMOTE_COMMAND_STARTED_MARKER = '__GOBLIN_REMOTE_COMMAND_STARTED__'
const REMOTE_COMMAND_STDERR_BEGIN_MARKER = '__GOBLIN_REMOTE_COMMAND_STDERR_BEGIN__'
const REMOTE_COMMAND_STDERR_END_MARKER = '__GOBLIN_REMOTE_COMMAND_STDERR_END__'

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

export async function runRemoteCommand(
  target: RemoteWorkspaceTarget,
  command: RemoteCommandKind,
  options?: { signal?: AbortSignal; timeoutMs?: number },
): Promise<RemoteCommandResult> {
  if (options?.signal?.aborted) {
    return { ok: false, stdout: '', stderr: '', message: 'cancelled', commandNotStarted: true }
  }
  const invocation = buildCanonicalSshInvocation(target, commandStartedMarkerScript(scriptForCommand(command)), [
    '-T',
    '-o',
    'RequestTTY=no',
  ])
  // Ensure the ControlMaster socket directory exists. ssh will refuse to
  // create a control socket in a missing directory, which on a fresh
  // install manifests as every probe failing before the handshake.
  try {
    await ensureSshControlDirectory()
  } catch (err) {
    return {
      ok: false,
      stdout: '',
      stderr: '',
      message: errorMessage(err),
      commandNotStarted: true,
    }
  }
  if (options?.signal?.aborted) {
    return { ok: false, stdout: '', stderr: '', message: 'cancelled', commandNotStarted: true }
  }
  try {
    const { stdout, stderr } = await execa(invocation.command, invocation.args, {
      timeout: options?.timeoutMs ?? SSH_COMMAND_TIMEOUT_MS,
      cancelSignal: options?.signal,
      forceKillAfterDelay: 500,
      maxBuffer: 2 * 1024 * 1024,
    })
    const parsed = parseRemoteCommandOutput(stdout, stderr)
    if (!parsed.remoteStarted) {
      return {
        ok: false,
        stdout: parsed.stdout,
        stderr: parsed.stderr,
        message: 'remote command execution could not be confirmed',
        remoteStarted: false,
        remoteStartUnconfirmed: true,
      }
    }
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
    if (err instanceof ExecaError && isProcessStartFailure(err)) {
      return {
        ok: false,
        stdout: parsed.stdout,
        stderr: parsed.stderr,
        message: parsed.stderr || parsed.transportStderr || e.message || 'unknown',
        commandNotStarted: true,
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

function isProcessStartFailure(error: ExecaError): boolean {
  if (error.exitCode !== undefined || error.signal !== undefined) return false
  return error.code === 'ENOENT' || error.code === 'EACCES' || error.code === 'ENOEXEC'
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
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
    'goblin_stderr_dir=$(mktemp -d "${TMPDIR:-/tmp}/goblin-stderr.XXXXXX") || exit 125',
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
      return [
        'platform=$(uname -s 2>/dev/null) || exit 1',
        '[ "$platform" = Linux ] || {',
        `  printf '%s%s\\n' ${shellQuote(REMOTE_UNSUPPORTED_PLATFORM_MARKER)} "$platform"`,
        '  exit 1',
        '}',
        `printf '%s\\n' ok`,
      ].join('\n')
    case 'checkGit':
      return 'command -v git'
    case 'testDirectory':
      return `cd ${shellQuote(command.path)} && test -r . && pwd -P`
    case 'listDirectories': {
      const limit = clamp(Math.floor(command.limit ?? 20), 1, 50)
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
        `modified=$(stat -c '%Y' . 2>/dev/null) || exit 1`,
        `printf '%s\\t%s\\t%s\\n' "$files" "$directories" "$modified"`,
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
    case 'resolveRepoCommonDir':
      return remoteRepoCommonDirScript(command.path)
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
      ].join(FOR_EACH_REF_FIELD_SEP)
      return [
        `printf '%s\n' ${shellQuote(REMOTE_SNAPSHOT_CURRENT_MARKER)}`,
        `goblin_current=$(git -C ${repo} symbolic-ref --quiet --short HEAD 2>/dev/null)`,
        'goblin_status=$?',
        'if [ "$goblin_status" -ne 0 ] && [ "$goblin_status" -ne 1 ]; then exit "$goblin_status"; fi',
        'printf \'value %s\\n\' "$goblin_current"',
        `printf '%s\n' ${shellQuote(REMOTE_SNAPSHOT_DEFAULT_MARKER)}`,
        `goblin_default=$(git -C ${repo} symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null)`,
        'goblin_status=$?',
        'if [ "$goblin_status" -ne 0 ] && [ "$goblin_status" -ne 1 ]; then exit "$goblin_status"; fi',
        'printf \'value %s\\n\' "${goblin_default#origin/}"',
        `printf '%s\n' ${shellQuote(REMOTE_SNAPSHOT_BRANCHES_MARKER)}`,
        `git -C ${repo} for-each-ref --format=${shellQuote(branchFormat)} refs/heads/`,
      ].join('\n')
    }
    case 'gitLocalBranches':
      return `git -C ${shellQuote(command.path)} for-each-ref --format=${shellQuote('%(refname:short)')} refs/heads/`
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
      return `git -C ${shellQuote(command.path)} worktree list --porcelain -z`
    case 'gitStatus':
      return `git -C ${shellQuote(command.path)} status --porcelain -z`
    case 'gitLog': {
      const count = clamp(Math.floor(command.count ?? DEFAULT_REPOSITORY_LOG_COUNT), 1, 1000)
      const skip = Math.max(0, Math.floor(command.skip ?? 0))
      const format = ['%H', '%h', '%D', '%s', '%an', '%aI'].join(PRETTY_FIELD_SEP)
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
      return `git -C ${shellQuote(command.path)} for-each-ref ${shellQuote('--format=%(refname)')} refs/remotes/`
    case 'gitRemoteFetchSpecs':
      return [
        `git -C ${shellQuote(command.path)} config --get-all -- ${shellQuote(`remote.${command.remote}.fetch`)}`,
        'code=$?',
        '[ "$code" -eq 0 ] || [ "$code" -eq 1 ]',
      ].join('; ')
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
      return `git -C ${shellQuote(command.path)} for-each-ref --format=${shellQuote(GIT_UPSTREAM_FORMAT)} ${shellQuote(`refs/heads/${command.branch}`)}`
    case 'gitIsAncestor':
      return [
        `git -C ${shellQuote(command.path)} merge-base --is-ancestor -- ${shellQuote(command.ancestor)} ${shellQuote(command.descendant)}`,
        'goblin_status=$?',
        `if [ "$goblin_status" -eq 0 ]; then printf 'true\\n'; elif [ "$goblin_status" -eq 1 ]; then printf 'false\\n'; else exit "$goblin_status"; fi`,
      ].join('\n')
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
    'owner=$(stat -c %u "$runtime_dir" 2>/dev/null) || exit 1',
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
    '[ -r /etc/machine-id ] || exit 1',
    'machine_fact=$(tr -cd "A-Za-z0-9._:-" < /etc/machine-id | head -c 128)',
    '[ -n "$machine_fact" ] || exit 1',
    'root_namespace_fact=$(readlink /proc/self/ns/mnt 2>/dev/null | tr -cd "A-Za-z0-9._:-" | head -c 128)',
    '[ -n "$root_namespace_fact" ] || exit 1',
    `canonical=$(cd -- ${shellQuote(worktreePath)} && pwd -P) || exit 1`,
    'printf \'%s\\0%s\\0%s\\0%s\\0\' "$runtime_token" "$machine_fact" "$root_namespace_fact" "$canonical"',
  ].join('\n')
}

function remoteRepoCommonDirScript(repoPath: string): string {
  return [
    `common_dir=$(git -C ${shellQuote(repoPath)} rev-parse --git-common-dir) || exit $?`,
    `case "$common_dir" in (/*) ;; (*) common_dir=${shellQuote(repoPath)}/$common_dir;; esac`,
    'canonical=$(cd -- "$common_dir" && pwd -P) || exit 1',
    'printf \'%s\\0\' "$canonical"',
  ].join('\n')
}

function remoteTrashFileScript(worktreePath: string, filePath: string): string {
  const worktree = shellQuote(worktreePath)
  const file = shellQuote(filePath)
  return [
    `cd -- ${worktree}`,
    `if [ ! -e ${file} ] && [ ! -L ${file} ]; then printf '%s\\n' 'error.file-not-found' >&2; exit 65; fi`,
    `if [ -d ${file} ] && [ ! -L ${file} ]; then printf '%s\\n' 'error.filetree-delete-directory-unsupported' >&2; exit 66; fi`,
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
    '  if [ -d "$entry" ] && [ ! -L "$entry" ]; then printf "%s/\\0" "$rel"; else printf "%s\\0" "$rel"; fi',
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
    '  if [ -d "$entry" ] && [ ! -L "$entry" ]; then printf "%s/\\0" "$rel"; else printf "%s\\0" "$rel"; fi',
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
        shellQuote(input.mode.remote.ref),
      ].join(' ')
  }
  const exhaustive: never = input.mode
  return exhaustive
}

function remoteBootstrapScript(command: Extract<RemoteCommandKind, { type: 'bootstrapRemoteWorktree' }>): string {
  const patterns = [...command.copy, ...command.symlink, ...command.hardlink, ...command.exclude]
  const args = [
    command.sourceRoot,
    command.targetRoot,
    command.setup ?? '',
    patterns.some(bootstrapPatternRequiresGlobstar) ? '1' : '0',
    REMOTE_WORKTREE_BOOTSTRAP_RECORD_TAGS.copy,
    REMOTE_WORKTREE_BOOTSTRAP_RECORD_TAGS.symlink,
    REMOTE_WORKTREE_BOOTSTRAP_RECORD_TAGS.hardlink,
    REMOTE_WORKTREE_BOOTSTRAP_RECORD_TAGS.missing,
    REMOTE_WORKTREE_BOOTSTRAP_RECORD_TAGS.setup,
    String(command.copy.length),
    ...command.copy,
    String(command.symlink.length),
    ...command.symlink,
    String(command.hardlink.length),
    ...command.hardlink,
    String(command.exclude.length),
    ...command.exclude,
  ]
  return [
    'command -v bash >/dev/null 2>&1 || { printf "%s\\n" "error: bash is required for worktree bootstrap" >&2; exit 1; }',
    `exec bash -c ${shellQuote(loadRemoteWorktreeBootstrapScript())} -- ${args.map(shellQuote).join(' ')}`,
  ].join('\n')
}

function bootstrapPatternRequiresGlobstar(pattern: string): boolean {
  return pattern.split('/').some((segment) => segment === '**')
}
