import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execa } from 'execa'
import {
  normalizeRemoteTarget,
  type RemoteConnectionInput,
  type ResolvedRemoteTarget,
  type SshConfigHost,
} from '#/shared/remote-repo.ts'

const SSH_CONFIG_PATH = path.join(os.homedir(), '.ssh', 'config')
const SSH_G_TIMEOUT_MS = 10_000
const SSH_CONFIG_DIR_MODE = 0o700
const SSH_CONFIG_FILE_MODE = 0o600
const DEFAULT_IDENTITY_FILE = '~/.ssh/id_ed25519'

export type SshConfigHostUpdateStatus = 'created' | 'existing'

export interface EnsureSshConfigHostInput {
  host: string
  user: string
  port: number
  identityFile?: string
}

export async function listSshConfigHosts(configPath: string = SSH_CONFIG_PATH): Promise<SshConfigHost[]> {
  try {
    return parseSshConfigHosts(await fs.readFile(configPath, 'utf-8'))
  } catch {
    return []
  }
}

export function parseSshConfigHosts(content: string): SshConfigHost[] {
  const hosts: SshConfigHost[] = []
  const seen = new Set<string>()
  let current: SshConfigHost[] = []
  for (const rawLine of content.split(/\r?\n/)) {
    const line = stripComment(rawLine).trim()
    if (!line) continue
    const [rawKey, ...parts] = line.split(/\s+/)
    const key = rawKey?.toLowerCase()
    if (key === 'host') {
      current = parts
        .filter((alias) => isConcreteAlias(alias) && !seen.has(alias))
        .map((alias) => {
          seen.add(alias)
          const host = { alias }
          hosts.push(host)
          return host
        })
      continue
    }
    if (current.length === 0) continue
    const value = parts.join(' ')
    if (!value) continue
    for (const host of current) {
      if (key === 'hostname') host.hostName = value
      else if (key === 'user') host.user = value
      else if (key === 'port') {
        const port = Number(value)
        if (Number.isInteger(port) && port >= 1 && port <= 65535) host.port = port
      }
    }
  }
  return hosts
}

export async function ensureSshConfigHost(
  input: EnsureSshConfigHostInput,
  configPath: string = SSH_CONFIG_PATH,
): Promise<SshConfigHostUpdateStatus> {
  const host = input.host.trim()
  const user = input.user.trim()
  const identityFile = (input.identityFile ?? DEFAULT_IDENTITY_FILE).trim()
  if (!isSafeSshConfigToken(host) || !isSafeSshConfigToken(user) || !isSafeSshConfigToken(identityFile)) {
    throw new Error('Invalid SSH config host')
  }
  if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535) {
    throw new Error('Invalid SSH config port')
  }

  await fs.mkdir(path.dirname(configPath), { recursive: true, mode: SSH_CONFIG_DIR_MODE })
  const content = await readSshConfig(configPath)
  if (parseSshConfigHosts(content).some((item) => item.alias === host)) return 'existing'

  const prefix = sshConfigAppendPrefix(content)
  await fs.appendFile(
    configPath,
    `${prefix}${formatSshConfigHostBlock({ host, user, port: input.port, identityFile })}`,
    {
      mode: SSH_CONFIG_FILE_MODE,
    },
  )
  await fs.chmod(configPath, SSH_CONFIG_FILE_MODE)
  return 'created'
}

export async function resolveRemoteTarget(
  input: RemoteConnectionInput,
  signal?: AbortSignal,
): Promise<ResolvedRemoteTarget> {
  if (input.mode === 'config') {
    const alias = input.alias.trim()
    if (!isConcreteAlias(alias)) throw new Error('Invalid SSH config host alias')
    const effective = await resolveEffectiveConfig(alias, signal)
    return toResolvedTarget({
      alias,
      host: effective.hostname ?? alias,
      user: effective.user ?? os.userInfo().username,
      port: effective.port ?? 22,
      remotePath: input.remotePath,
      identityFile: input.identityFile,
    })
  }
  return toResolvedTarget({
    alias: null,
    host: input.host,
    user: input.user,
    port: input.port ?? 22,
    remotePath: input.remotePath,
    identityFile: input.identityFile,
  })
}

interface EffectiveSshConfig {
  hostname?: string
  user?: string
  port?: number
}

async function resolveEffectiveConfig(alias: string, signal?: AbortSignal): Promise<EffectiveSshConfig> {
  const { stdout } = await execa('ssh', ['-G', alias], {
    timeout: SSH_G_TIMEOUT_MS,
    cancelSignal: signal,
    forceKillAfterDelay: 500,
    maxBuffer: 1024 * 1024,
  })
  const parsed: EffectiveSshConfig = {}
  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    const firstSpace = line.search(/\s/)
    const key = (firstSpace === -1 ? line : line.slice(0, firstSpace)).toLowerCase()
    const value = firstSpace === -1 ? '' : line.slice(firstSpace + 1).trim()
    if (key === 'hostname' || key === 'user') parsed[key] = value
    if (key === 'port') {
      const port = Number(value)
      if (Number.isInteger(port) && port >= 1 && port <= 65535) parsed.port = port
    }
  }
  return parsed
}

function toResolvedTarget(input: {
  alias: string | null
  host: string
  user: string
  port: number
  remotePath: string
  identityFile?: string
}): ResolvedRemoteTarget {
  const target = normalizeRemoteTarget(input)
  if (!target) throw new Error('Invalid remote repository target')
  return { target }
}

function isConcreteAlias(alias: string): boolean {
  return alias.length > 0 && !alias.includes('\0') && !alias.startsWith('!') && !/[?*]/.test(alias)
}

function stripComment(line: string): string {
  const index = line.indexOf('#')
  return index === -1 ? line : line.slice(0, index)
}

export function findSshAliasForHost(configContent: string, host: string, user: string, port: number): string | null {
  const hosts = parseSshConfigHosts(configContent)
  for (const h of hosts) {
    const effectiveHost = h.hostName ?? h.alias
    if (effectiveHost === host && h.user === user && h.port === port) {
      return h.alias
    }
  }
  return null
}

async function readSshConfig(configPath: string): Promise<string> {
  try {
    return await fs.readFile(configPath, 'utf-8')
  } catch {
    return ''
  }
}

function formatSshConfigHostBlock(input: Required<EnsureSshConfigHostInput>): string {
  return [
    `Host ${input.host}`,
    `  HostName ${input.host}`,
    `  User ${input.user}`,
    ...(input.port === 22 ? [] : [`  Port ${input.port}`]),
    `  IdentityFile ${input.identityFile}`,
    '  IdentitiesOnly yes',
    '',
  ].join('\n')
}

function sshConfigAppendPrefix(content: string): string {
  if (content.length === 0) return ''
  if (content.endsWith('\n\n')) return ''
  if (content.endsWith('\n')) return '\n'
  return '\n\n'
}

function isSafeSshConfigToken(value: string): boolean {
  return value.length > 0 && !/[\x00-\x20\x7f#]/.test(value)
}
