export interface ParsedGitRemoteUrl {
  host: string
  path: string
}

export function parseGitRemoteUrl(url: string): ParsedGitRemoteUrl | null {
  const sshUrl = url.match(/^ssh:\/\/(?:[^@]+@)?([^:/]+)(?::\d+)?\/(.+)(?:\.git)?\/?$/)
  const httpsUrl = url.match(/^https?:\/\/(?:[^@/]+@)?([^/]+)\/(.+)(?:\.git)?\/?$/)
  const scpUrl = url.match(/^(?:[^@]+@)?([^:/\s]+):([^/].*)(?:\.git)?\/?$/)
  const match = sshUrl ?? httpsUrl ?? scpUrl
  if (!match?.[1] || !match[2]) return null
  const host = match[1].toLowerCase()
  if (/[\s\0-\x1f\x7f]/.test(host)) return null
  const path = match[2].replace(/\.git$/, '').replace(/\/$/, '')
  if (/[\s\0-\x1f\x7f]/.test(path)) return null
  if (!path) return null
  return { host, path }
}

export function remoteUrlToHttps(url: string): string | null {
  const parsed = parseGitRemoteUrl(url)
  return parsed ? `https://${parsed.host}/${parsed.path}` : null
}

export function isGitLabHost(host: string): boolean {
  const normalized = host.toLowerCase()
  return normalized === 'gitlab.com' || normalized.startsWith('gitlab.') || normalized.includes('.gitlab.')
}

export function isGitHubHost(host: string): boolean {
  const normalized = host.toLowerCase()
  return (
    normalized === 'github.com' ||
    normalized.endsWith('.ghe.com') ||
    normalized.startsWith('github.') ||
    normalized.includes('.github.')
  )
}
