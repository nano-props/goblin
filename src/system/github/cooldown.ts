const GITHUB_RATE_LIMIT_COOLDOWN_MS = 5 * 60_000

const rateLimitedHosts = new Map<string, number>()

export function isGitHubHostCoolingDown(host: string): boolean {
  return (rateLimitedHosts.get(host) ?? 0) > Date.now()
}

export function markGitHubHostRateLimited(host: string, cooldownMs = GITHUB_RATE_LIMIT_COOLDOWN_MS): number {
  const until = Date.now() + cooldownMs
  rateLimitedHosts.set(host, until)
  return until
}

export function resetGitHubCooldownStateForTests(): void {
  rateLimitedHosts.clear()
}
