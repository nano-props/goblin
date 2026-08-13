import { readFileSync } from 'node:fs'
import { shellQuote } from '#/system/remote-shell.ts'

let cachedScript: string | undefined

function loadRemoteGitOperationStateScript(): string {
  cachedScript ??= readFileSync(new URL('./remote-git-operation-state.sh', import.meta.url), 'utf8')
  return cachedScript
}

export function remoteGitOperationStateScript(repoPath: string): string {
  return `exec bash -c ${shellQuote(loadRemoteGitOperationStateScript())} -- ${shellQuote(repoPath)}`
}
