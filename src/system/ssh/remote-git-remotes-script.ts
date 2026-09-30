import script from '#/system/ssh/remote-git-remotes.sh' with { type: 'text' }
import { shellQuote } from '#/system/remote-shell.ts'

function loadRemoteGitRemotesScript(): string {
  return script
}

export function remoteGitRemotesScript(repoPath: string): string {
  return `exec bash -c ${shellQuote(loadRemoteGitRemotesScript())} -- ${shellQuote(repoPath)}`
}
