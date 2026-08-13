import { readFileSync } from 'node:fs'
import { shellQuote } from '#/system/remote-shell.ts'

let cachedScript: string | undefined

function loadRemoteGitOperationStateScript(): string {
  cachedScript ??= readFileSync(new URL('./remote-git-operation-state.sh', import.meta.url), 'utf8')
  return cachedScript
}

export function remoteGitOperationStateScript(
  commonDir: string,
  worktreePath: string,
  isPrimary: boolean,
  attachedBranch: string | null,
): string {
  return `exec bash -c ${shellQuote(loadRemoteGitOperationStateScript())} -- ${shellQuote(commonDir)} ${shellQuote(worktreePath)} ${isPrimary ? '1' : '0'} ${shellQuote(attachedBranch ?? '')}`
}
