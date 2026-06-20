const ACCESS_TOKEN_HEADER = 'x-goblin-access-token'

interface GoblinCommandIo {
  stdout(message: string): void
  stderr(message: string): void
  fetch?: typeof fetch
}

export async function runGoblinCommand(
  args: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
  io: GoblinCommandIo = consoleIo,
): Promise<number> {
  const command = args[0] || 'help'
  switch (command) {
    case 'help':
    case '--help':
    case '-h':
      io.stdout(usage())
      return 0
    case 'status': {
      const cwd = args[1] || env.GOBLIN_WORKTREE_PATH || process.cwd()
      const result = await requestJson('/api/repo/status', { cwd }, env, io)
      if (!result.ok) return result.code
      io.stdout(summarizeStatus(result.data))
      return 0
    }
    default:
      io.stderr(`g: unknown command: ${command}\n\n${usage()}`)
      return 2
  }
}

function usage(): string {
  return [
    'Goblin terminal command',
    '',
    'Usage:',
    '  g help',
    '  g status [cwd]',
    '',
    'Commands:',
    '  help       Show this help.',
    '  status     Print the Goblin status for the current worktree.',
  ].join('\n')
}

function readServerUrl(env: NodeJS.ProcessEnv): string {
  const explicit = env.GOBLIN_SERVER_URL?.trim()
  if (explicit) return explicit.replace(/\/$/, '')
  const port = env.GOBLIN_SERVER_PORT?.trim() || '32100'
  let host = env.GOBLIN_SERVER_HOST?.trim() || '127.0.0.1'
  if (host === '0.0.0.0') host = '127.0.0.1'
  if (host === '::') host = '[::1]'
  else if (host.includes(':') && !host.startsWith('[')) host = `[${host}]`
  return `http://${host}:${port}`
}

function readAccessToken(env: NodeJS.ProcessEnv): string | null {
  return env.GOBLIN_SERVER_ACCESS_TOKEN?.trim() || null
}

async function requestJson(
  pathname: string,
  query: Record<string, string>,
  env: NodeJS.ProcessEnv,
  io: GoblinCommandIo,
): Promise<{ ok: true; data: unknown } | { ok: false; code: number }> {
  const fetchImpl = io.fetch ?? globalThis.fetch
  if (typeof fetchImpl !== 'function') {
    io.stderr('g: fetch is not available in this runtime')
    return { ok: false, code: 1 }
  }
  const token = readAccessToken(env)
  if (!token) {
    io.stderr('g: GOBLIN_SERVER_ACCESS_TOKEN is not set')
    return { ok: false, code: 1 }
  }
  const url = new URL(pathname, readServerUrl(env))
  for (const [key, value] of Object.entries(query)) {
    if (value) url.searchParams.set(key, value)
  }
  try {
    const response = await fetchImpl(url, {
      headers: {
        [ACCESS_TOKEN_HEADER]: token,
      },
    })
    if (!response.ok) {
      io.stderr(`g: request failed (${response.status})`)
      return { ok: false, code: 1 }
    }
    return { ok: true, data: await response.json() }
  } catch (error) {
    io.stderr(`g: ${error instanceof Error ? error.message : String(error)}`)
    return { ok: false, code: 1 }
  }
}

export function summarizeStatus(status: unknown): string {
  if (!Array.isArray(status)) return JSON.stringify(status, null, 2)
  let total = 0
  for (const worktree of status) {
    const entries = Array.isArray(worktree?.entries) ? worktree.entries : []
    total += entries.length
  }
  if (total === 0) return 'clean'
  const lines = [`${total} change${total === 1 ? '' : 's'}`]
  for (const worktree of status) {
    const entries = Array.isArray(worktree?.entries) ? worktree.entries : []
    if (entries.length === 0) continue
    const label = typeof worktree.branch === 'string' && worktree.branch ? worktree.branch : worktree.path
    lines.push(`${label}:`)
    for (const entry of entries) {
      const x = typeof entry.x === 'string' ? entry.x : ' '
      const y = typeof entry.y === 'string' ? entry.y : ' '
      const filePath = typeof entry.path === 'string' ? entry.path : ''
      lines.push(`  ${x}${y} ${filePath}`)
    }
  }
  return lines.join('\n')
}

const consoleIo: GoblinCommandIo = {
  stdout(message) {
    console.log(message)
  },
  stderr(message) {
    console.error(message)
  },
}
