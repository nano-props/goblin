import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execa } from 'execa'
import SSHConfig, { LineType, type Line, type Section } from '#/system/ssh/vendor/ssh-config/index.ts'
import {
  normalizeRemoteRepoRef,
  normalizeRemoteTarget,
  type RemoteConnectionInput,
  type RemoteRepoRef,
  type ResolvedRemoteTarget,
  type SshConfigHost,
  type SshConfigHostsResult,
} from '#/shared/remote-repo.ts'

const SSH_CONFIG_PATH = path.join(os.homedir(), '.ssh', 'config')
const SSH_G_TIMEOUT_MS = 10_000

export async function listSshConfigHosts(configPath: string = SSH_CONFIG_PATH): Promise<SshConfigHostsResult> {
  try {
    return parseSshConfig(await fs.readFile(configPath, 'utf-8'))
  } catch {
    return { hosts: [], hasInclude: false }
  }
}

export function parseSshConfig(content: string): SshConfigHostsResult {
  const parsed = SSHConfig.parse(content)
  const hosts: SshConfigHost[] = []
  const seen = new Set<string>()
  const hasInclude = containsIncludeDirective(parsed)
  for (const line of parsed) {
    if (line.type !== LineType.DIRECTIVE || line.param.toLowerCase() !== 'host' || !('config' in line)) continue
    for (const alias of hostAliases(line)) {
      if (seen.has(alias)) continue
      seen.add(alias)
      const computed = parsed.compute(alias, { ignoreCase: true })
      const host: SshConfigHost = { alias }
      const hostName = firstString(computed.hostname)
      const user = firstString(computed.user)
      const port = normalizePort(firstString(computed.port))
      if (hostName) host.hostName = hostName
      if (user) host.user = user
      if (port !== null) host.port = port
      hosts.push(host)
    }
  }
  return { hosts, hasInclude }
}

export function parseSshConfigHosts(content: string): SshConfigHost[] {
  return parseSshConfig(content).hosts
}

export async function resolveRemoteTarget(
  input: RemoteConnectionInput,
  signal?: AbortSignal,
): Promise<ResolvedRemoteTarget> {
  const alias = input.alias.trim()
  if (!isConcreteAlias(alias)) throw new Error('Invalid SSH config host alias')
  const configState = await listSshConfigHosts()
  if (!configState.hasInclude && !configState.hosts.some((host) => host.alias === alias)) {
    throw new Error('error.ssh-config-changed')
  }
  const effective = await resolveEffectiveConfig(alias, signal)
  return toResolvedTarget({
    alias,
    host: effective.hostname ?? alias,
    user: effective.user ?? os.userInfo().username,
    port: effective.port ?? 22,
    remotePath: input.remotePath,
  })
}

export async function resolveTrackedRemoteTarget(
  ref: RemoteRepoRef,
  signal?: AbortSignal,
): Promise<ResolvedRemoteTarget> {
  const normalized = normalizeRemoteRepoRef(ref)
  if (!normalized) throw new Error('error.ssh-config-changed')
  return resolveRemoteTarget({ alias: normalized.alias, remotePath: normalized.remotePath }, signal)
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
  alias: string
  host: string
  user: string
  port: number
  remotePath: string
}): ResolvedRemoteTarget {
  const target = normalizeRemoteTarget(input)
  if (!target) throw new Error('Invalid remote repository target')
  return { target }
}

function isConcreteAlias(alias: string): boolean {
  return alias.length > 0 && !alias.includes('\0') && !alias.startsWith('!') && !/[?*]/.test(alias)
}

function containsIncludeDirective(config: ReturnType<typeof SSHConfig.parse>): boolean {
  return config.some((line: Line) => {
    if (line.type !== LineType.DIRECTIVE) return false
    if (line.param.toLowerCase() === 'include') return true
    return 'config' in line ? containsIncludeDirective(line.config) : false
  })
}

function hostAliases(section: Section): string[] {
  const value = typeof section.value === 'string' ? section.value : section.value.map((part) => part.val).join(' ')
  return value
    .split(/\s+/)
    .map((alias) => alias.trim())
    .filter((alias) => isConcreteAlias(alias))
}

function firstString(value: string | string[] | undefined): string | null {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : null
  return null
}

function normalizePort(value: string | null): number | null {
  if (!value) return null
  const port = Number(value)
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null
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
