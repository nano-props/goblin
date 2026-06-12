import { probeGitHubCli } from '#/system/github-cli.ts'
import type { GitHubCliState } from '#/shared/api-types.ts'

export async function getServerGitHubCliState(
  signal?: AbortSignal,
  hosts?: string[],
  options?: { force?: boolean },
): Promise<GitHubCliState> {
  return await probeGitHubCli(signal, hosts, options)
}
