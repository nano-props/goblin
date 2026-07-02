import { createOpaqueId } from '#/shared/opaque-id.ts'

const RECENT_SOURCE_TOKEN_TTL_MS = 10_000

const activeSourceTokens = new Set<string>()
const recentSourceTokens = new Map<string, number>()

function createRepoInvalidationSourceToken(prefix: 'manual' | 'branch'): string {
  return createOpaqueId(`repo-${prefix}`)
}

export function beginRepoInvalidationSource(token: string): void {
  clearExpiredRecentSourceTokens()
  recentSourceTokens.delete(token)
  activeSourceTokens.add(token)
}

export function settleRepoInvalidationSource(token: string, now: number = Date.now()): void {
  activeSourceTokens.delete(token)
  recentSourceTokens.set(token, now + RECENT_SOURCE_TOKEN_TTL_MS)
}

export function shouldSuppressRepoInvalidationSource(token: string | undefined, now: number = Date.now()): boolean {
  if (!token) return false
  clearExpiredRecentSourceTokens(now)
  if (activeSourceTokens.has(token)) return true
  const expiresAt = recentSourceTokens.get(token)
  if (expiresAt === undefined) return false
  if (expiresAt <= now) {
    recentSourceTokens.delete(token)
    return false
  }
  return true
}

export async function runWithRepoInvalidationSource<T>(
  prefix: 'manual' | 'branch',
  task: (sourceToken: string) => Promise<T>,
): Promise<T> {
  const sourceToken = createRepoInvalidationSourceToken(prefix)
  beginRepoInvalidationSource(sourceToken)
  try {
    return await task(sourceToken)
  } finally {
    settleRepoInvalidationSource(sourceToken)
  }
}

export function resetRepoInvalidationSourceState(): void {
  activeSourceTokens.clear()
  recentSourceTokens.clear()
}

function clearExpiredRecentSourceTokens(now: number = Date.now()): void {
  for (const [token, expiresAt] of recentSourceTokens) {
    if (expiresAt <= now) recentSourceTokens.delete(token)
  }
}
