import { createHash } from 'node:crypto'
import { accessSync, constants as fsConstants, statSync } from 'node:fs'
import { chmod, mkdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { RemoteWorkspaceTarget } from '#/shared/remote-workspace.ts'
import { shellQuote } from '#/system/remote-shell.ts'

const SSH_CONNECT_TIMEOUT_SEC = 10
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

export interface RemoteCommandInvocation {
  command: string
  args: string[]
  script: string
}

export interface SshConnectionSnapshotTarget {
  alias: string
  host: string
  user: string
  port: number
}

function controlPathFor(target: RemoteWorkspaceTarget): string {
  const key = target.sshConnection
    ? JSON.stringify([target.sshConnection.destination, ...target.sshConnection.options])
    : JSON.stringify([target.alias, target.host, target.port, target.user])
  const hash = createHash('sha256').update(key).digest('hex').slice(0, 16)
  return path.join(SSH_CONTROL_DIR, hash)
}

let controlDirReady: Promise<void> | null = null

export function ensureSshControlDirectory(): Promise<void> {
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

/** Converts one `ssh -G` result into argv-safe options that never consult config again. */
export function buildCanonicalSshConnectionSnapshot(
  target: SshConnectionSnapshotTarget,
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

export function buildCanonicalSshInvocation(
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

export function buildRemoteTerminalInvocation(
  target: RemoteWorkspaceTarget,
  remotePath: string,
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

function normalizeTerminalStartupShellCommand(command: string | undefined): string {
  const withoutTrailingNewline = (command ?? '').replace(/[\r\n]+$/u, '')
  return withoutTrailingNewline.trim().length === 0 ? '' : withoutTrailingNewline
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
