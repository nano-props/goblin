import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execa, ExecaError } from 'execa'
import { FIELD_SEP } from '#/system/git/parsers.ts'
import { shellQuote } from '#/system/remote-shell.ts'
import { DEFAULT_REPOSITORY_LOG_COUNT } from '#/shared/git-types.ts'
import type { RemoteRepoTarget } from '#/shared/remote-repo.ts'
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

function controlPathFor(target: RemoteRepoTarget): string {
  const key = `${target.alias}|${target.host}|${target.port}|${target.user}`
  const hash = createHash('sha256').update(key).digest('hex').slice(0, 16)
  return path.join(SSH_CONTROL_DIR, hash)
}

let controlDirReady: Promise<void> | null = null
function ensureControlDir(): Promise<void> {
  if (!controlDirReady) {
    controlDirReady = mkdir(SSH_CONTROL_DIR, { recursive: true }).then(
      () => undefined,
      () => undefined,
    )
  }
  return controlDirReady
}
export const REMOTE_SNAPSHOT_CURRENT_MARKER = '__GOBLIN_REMOTE_CURRENT__'
export const REMOTE_SNAPSHOT_DEFAULT_MARKER = '__GOBLIN_REMOTE_DEFAULT__'
export const REMOTE_SNAPSHOT_BRANCHES_MARKER = '__GOBLIN_REMOTE_BRANCHES__'

export type RemoteCommandKind =
  | { type: 'printHome' }
  | { type: 'checkShell' }
  | { type: 'checkGit' }
  | { type: 'testDirectory'; path: string }
  | { type: 'listDirectories'; path: string; limit?: number }
  | { type: 'revParseTopLevel'; path: string }
  | { type: 'gitSnapshot'; path: string }
  | { type: 'gitPatch'; path: string }
  | { type: 'gitWorktreeList'; path: string }
  | { type: 'gitStatus'; path: string }
  | { type: 'gitLog'; path: string; branch: string; count?: number; skip?: number }
  | { type: 'gitFetchAll'; path: string }
  | { type: 'gitFetchRemote'; path: string; remote: string }
  | { type: 'gitStatusAll'; path: string }
  | { type: 'gitDiffNoIndex'; path: string; filePath: string }
  | { type: 'gitPullCurrent'; path: string }
  | { type: 'gitFetchBranch'; path: string; remote: string; remoteBranch: string; branch: string }
  | { type: 'gitPush'; path: string; remote: string; branch: string; targetBranch: string; setUpstream: boolean }
  | { type: 'gitRemoteBranches'; path: string }
  | { type: 'gitWorktreeAdd'; path: string; input: CreateWorktreeInput }
  | { type: 'gitWorktreeRemove'; path: string; worktreePath: string }
  | { type: 'gitBranchDelete'; path: string; branch: string; force?: boolean }
  | { type: 'gitUpstream'; path: string; branch: string }
  | { type: 'gitIsAncestor'; path: string; ancestor: string; descendant: string }
  | { type: 'gitRemoteVerbose'; path: string }
  | { type: 'gitRemoteGetUrl'; path: string }

export interface RemoteCommandResult {
  ok: boolean
  stdout: string
  stderr: string
  message?: string
  timedOut?: boolean
}

export interface RemoteCommandInvocation {
  command: string
  args: string[]
  script: string
}

export type RemoteCommandRunner = (
  command: RemoteCommandKind,
  target: RemoteRepoTarget,
  options?: { signal?: AbortSignal; timeoutMs?: number },
) => Promise<RemoteCommandResult>

export function buildRemoteCommandInvocation(
  target: RemoteRepoTarget,
  command: RemoteCommandKind,
): RemoteCommandInvocation {
  const script = scriptForCommand(command)
  const args = [
    '-T',
    '-o',
    'RequestTTY=no',
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
  const destination = target.alias
  args.push('--', destination, `sh -lc ${shellQuote(script)}`)
  return { command: findExecutableOnPath('ssh') ?? 'ssh', args, script }
}

export function buildRemoteTerminalInvocation(
  target: RemoteRepoTarget,
  remotePath: string,
  _size: { cols: number; rows: number },
): RemoteCommandInvocation {
  const script = `cd ${shellQuote(remotePath)} && exec "\${SHELL:-/bin/sh}" -l`
  const args = [
    '-tt',
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
  const destination = target.alias
  args.push('--', destination, `sh -lc ${shellQuote(script)}`)
  return { command: findExecutableOnPath('ssh') ?? 'ssh', args, script }
}

export async function runRemoteCommand(
  target: RemoteRepoTarget,
  command: RemoteCommandKind,
  options?: { signal?: AbortSignal; timeoutMs?: number },
): Promise<RemoteCommandResult> {
  if (options?.signal?.aborted) return { ok: false, stdout: '', stderr: '', message: 'cancelled' }
  const invocation = buildRemoteCommandInvocation(target, command)
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
    return { ok: true, stdout: stdout.trimEnd(), stderr: stderr.trimEnd() }
  } catch (err) {
    const e = err as { stdout?: unknown; stderr?: unknown; timedOut?: boolean; isCanceled?: boolean; message?: string }
    const stdout = typeof e.stdout === 'string' ? e.stdout.trimEnd() : ''
    const stderr = typeof e.stderr === 'string' ? e.stderr.trimEnd() : ''
    if (options?.signal?.aborted || e.isCanceled === true) {
      return { ok: false, stdout, stderr, message: 'cancelled' }
    }
    if (err instanceof ExecaError && e.timedOut) {
      return { ok: false, stdout, stderr, message: 'timeout', timedOut: true }
    }
    return { ok: false, stdout, stderr, message: stderr || e.message || 'unknown' }
  }
}

function scriptForCommand(command: RemoteCommandKind): string {
  switch (command.type) {
    case 'printHome':
      return `printf '%s\\n' "$HOME"`
    case 'checkShell':
      return `printf '%s\\n' ok`
    case 'checkGit':
      return 'command -v git'
    case 'testDirectory':
      return `test -d ${shellQuote(command.path)}`
    case 'listDirectories': {
      const limit = Math.max(1, Math.min(50, Math.floor(command.limit ?? 20)))
      return `find ${shellQuote(
        command.path,
      )} -mindepth 1 -maxdepth 1 -type d -print 2>/dev/null | LC_ALL=C sort | head -n ${limit}`
    }
    case 'revParseTopLevel':
      return `git -C ${shellQuote(command.path)} rev-parse --show-toplevel`
    case 'gitSnapshot': {
      const repo = shellQuote(command.path)
      const branchFormat = [
        '%(refname:short)',
        '%(objectname:short)',
        '%(subject)',
        '%(authordate:iso-strict)',
        '%(authorname)',
        '%(upstream:short)',
        '%(upstream:track)',
      ].join(FIELD_SEP)
      return [
        `printf '%s\\n' ${shellQuote(REMOTE_SNAPSHOT_CURRENT_MARKER)}`,
        `git -C ${repo} symbolic-ref --short HEAD 2>/dev/null || true`,
        `printf '%s\\n' ${shellQuote(REMOTE_SNAPSHOT_DEFAULT_MARKER)}`,
        `git -C ${repo} symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's#^origin/##'`,
        `printf '%s\\n' ${shellQuote(REMOTE_SNAPSHOT_BRANCHES_MARKER)}`,
        `git -C ${repo} for-each-ref --format=${shellQuote(branchFormat)} refs/heads/`,
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
    case 'gitRemoteBranches':
      return `git -C ${shellQuote(command.path)} for-each-ref ${shellQuote('--format=%(refname:short)')} refs/remotes/`
    case 'gitWorktreeAdd':
      return `git -C ${shellQuote(command.path)} worktree add ${remoteWorktreeAddArgs(command.input)}`
    case 'gitWorktreeRemove':
      return `git -C ${shellQuote(command.path)} worktree remove -- ${shellQuote(command.worktreePath)}`
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
  }
  const exhaustive: never = command
  return exhaustive
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

function findExecutableOnPath(name: string): string | null {
  const pathEnv = process.env.PATH || process.env.Path || process.env.path || ''
  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) continue
    for (const candidateName of executableNames(name)) {
      const candidate = path.join(dir, candidateName)
      if (existsSync(candidate)) return candidate
    }
  }
  return null
}

function executableNames(name: string): string[] {
  if (process.platform !== 'win32' || path.extname(name)) return [name]
  const extensions = (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD')
    .split(';')
    .map((ext) => ext.trim().toLowerCase())
    .filter(Boolean)
  return [name, ...extensions.map((ext) => `${name}${ext}`)]
}
