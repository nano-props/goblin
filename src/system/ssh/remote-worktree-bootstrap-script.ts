import { readFileSync } from 'node:fs'

let cachedScript: string | undefined

export function loadRemoteWorktreeBootstrapScript(): string {
  cachedScript ??= readFileSync(new URL('./remote-worktree-bootstrap.sh', import.meta.url), 'utf8')
  return cachedScript
}
