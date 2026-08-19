import { readFileSync } from 'node:fs'
import { shellQuote } from '#/system/remote-shell.ts'

let cachedScript: string | undefined

function loadRemoteGitRemotesScript(): string {
  cachedScript ??= readFileSync(new URL('./remote-git-remotes.sh', import.meta.url), 'utf8')
  return cachedScript
}

export function remoteGitRemotesScript(repoPath: string): string {
  return `exec bash -c ${shellQuote(loadRemoteGitRemotesScript())} -- ${shellQuote(repoPath)}`
}
