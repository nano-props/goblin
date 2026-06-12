import { execa } from 'execa'
import path from 'node:path'
import type { GitHubCliHostState, GitHubCliState } from '#/shared/api-types.ts'
import { hasCommand } from '#/system/command.ts'

const GITHUB_CLI_TIMEOUT_MS = 5_000
const GITHUB_CLI_CACHE_TTL_MS = 5_000
export const GITHUB_CLI_EXTRA_PATHS = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin']

interface GitHubCliAuthStatusPayload {
  hosts?: Record<
    string,
    Array<{
      state?: string
      active?: boolean
      host?: string
      login?: string
      tokenSource?: string
    }>
  >
}

interface GitHubCliSnapshot {
  available: boolean
  version: string | null
  detectedAt: number
  hosts: Record<string, GitHubCliHostState>
}

let cachedGitHubCliSnapshot: GitHubCliSnapshot | null = null
let pendingGitHubCliSnapshot: Promise<GitHubCliSnapshot> | null = null

export function buildGitHubCliPath(currentPath = process.env.PATH): string {
  const values = [...(currentPath?.split(path.delimiter) ?? []), ...GITHUB_CLI_EXTRA_PATHS]
  const seen = new Set<string>()
  const directories: string[] = []
  for (const value of values) {
    const directory = value.trim()
    if (!directory || seen.has(directory)) continue
    seen.add(directory)
    directories.push(directory)
  }
  return directories.join(path.delimiter)
}

function ghEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GH_PROMPT_DISABLED: '1',
    PATH: buildGitHubCliPath(),
  }
}

function normalizeHosts(hosts?: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of hosts ?? []) {
    const host = value.trim().toLowerCase()
    if (!host || seen.has(host)) continue
    seen.add(host)
    result.push(host)
  }
  return result
}

function emptyGitHubCliHostState(host: string): GitHubCliHostState {
  return {
    host,
    authenticated: false,
    activeLogin: null,
    logins: [],
    tokenSource: null,
  }
}

function parseGitHubCliHostStates(payload: GitHubCliAuthStatusPayload): Record<string, GitHubCliHostState> {
  return Object.fromEntries(
    Object.entries(payload.hosts ?? {}).map(([rawHost, accounts]) => {
      const host = rawHost.trim().toLowerCase()
      const active = accounts.find((account) => account.active === true && account.state === 'success')
      const successes = accounts.filter((account) => account.state === 'success' && typeof account.login === 'string')
      return [
        host,
        {
          host,
          authenticated: successes.length > 0,
          activeLogin: active?.login ?? successes[0]?.login ?? null,
          logins: successes.flatMap((account) => (account.login ? [account.login] : [])),
          tokenSource: active?.tokenSource ?? successes[0]?.tokenSource ?? null,
        } satisfies GitHubCliHostState,
      ]
    }),
  )
}

function selectGitHubCliHostStates(
  allHosts: Record<string, GitHubCliHostState>,
  hosts?: string[],
): Record<string, GitHubCliHostState> {
  const normalizedHosts = normalizeHosts(hosts)
  if (normalizedHosts.length === 0) return allHosts
  return Object.fromEntries(normalizedHosts.map((host) => [host, allHosts[host] ?? emptyGitHubCliHostState(host)]))
}

async function probeGitHubAuthStatuses(signal?: AbortSignal): Promise<Record<string, GitHubCliHostState>> {
  const result = await execa('gh', ['auth', 'status', '--json', 'hosts'], {
    timeout: GITHUB_CLI_TIMEOUT_MS,
    forceKillAfterDelay: 500,
    cancelSignal: signal,
    reject: false,
    env: ghEnv(),
  })
  let payload: GitHubCliAuthStatusPayload = {}
  if (result.stdout) {
    try {
      payload = JSON.parse(result.stdout) as GitHubCliAuthStatusPayload
    } catch {
      payload = {}
    }
  }
  return parseGitHubCliHostStates(payload)
}

function cachedGitHubCliSnapshotFresh(): boolean {
  return !!cachedGitHubCliSnapshot && Date.now() - cachedGitHubCliSnapshot.detectedAt < GITHUB_CLI_CACHE_TTL_MS
}

async function detectGitHubCliSnapshot(signal?: AbortSignal): Promise<GitHubCliSnapshot> {
  const detectedAt = Date.now()
  if (!hasCommand('gh', GITHUB_CLI_EXTRA_PATHS)) {
    return { available: false, version: null, detectedAt, hosts: {} }
  }
  const result = await execa('gh', ['--version'], {
    timeout: GITHUB_CLI_TIMEOUT_MS,
    forceKillAfterDelay: 500,
    cancelSignal: signal,
    reject: false,
    env: ghEnv(),
  })
  if (result.failed || result.exitCode !== 0) {
    return { available: false, version: null, detectedAt, hosts: {} }
  }
  const version = result.stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line.length > 0)
  return {
    available: version !== undefined,
    version: version ?? null,
    detectedAt,
    hosts: await probeGitHubAuthStatuses(signal),
  }
}

export async function probeGitHubCli(
  signal?: AbortSignal,
  hosts?: string[],
  options?: { force?: boolean },
): Promise<GitHubCliState> {
  const normalizedHosts = normalizeHosts(hosts)
  const force = options?.force === true
  let snapshot: GitHubCliSnapshot
  if (!force && cachedGitHubCliSnapshotFresh()) {
    snapshot = cachedGitHubCliSnapshot!
  } else if (!force && pendingGitHubCliSnapshot) {
    snapshot = await pendingGitHubCliSnapshot
  } else {
    const work = detectGitHubCliSnapshot(signal)
    if (!force) pendingGitHubCliSnapshot = work
    try {
      snapshot = await work
    } finally {
      if (!force && pendingGitHubCliSnapshot === work) pendingGitHubCliSnapshot = null
    }
  }
  cachedGitHubCliSnapshot = snapshot
  return {
    available: snapshot.available,
    version: snapshot.version,
    detectedAt: snapshot.detectedAt,
    hosts: selectGitHubCliHostStates(snapshot.hosts, normalizedHosts),
  }
}

export async function canQueryGitHubHost(host: string, signal?: AbortSignal): Promise<boolean> {
  const normalizedHost = host.trim().toLowerCase()
  if (!normalizedHost) return false
  const state = await probeGitHubCli(signal, [normalizedHost])
  return state.available && state.hosts[normalizedHost]?.authenticated === true
}
