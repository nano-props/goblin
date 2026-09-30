import script from '#/system/ssh/remote-git-operation-state.sh' with { type: 'text' }
import { shellQuote } from '#/system/remote-shell.ts'

function loadRemoteGitOperationStateScript(): string {
  return script
}

export function remoteGitOperationStateScript(
  commonDir: string,
  worktreePath: string,
  isPrimary: boolean,
  attachedBranch: string | null,
): string {
  return `exec bash -c ${shellQuote(loadRemoteGitOperationStateScript())} -- ${shellQuote(commonDir)} ${shellQuote(worktreePath)} ${isPrimary ? '1' : '0'} ${shellQuote(attachedBranch ?? '')}`
}
