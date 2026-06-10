import { git } from '#/system/git/helper.ts'
import { parseRemoteTrackingRefs } from '#/shared/worktree-create.ts'

export async function getRemoteTrackingBranches(cwd: string, signal?: AbortSignal): Promise<string[]> {
  try {
    const output = await git(cwd, ['for-each-ref', '--format=%(refname:short)', 'refs/remotes/'], { signal })
    return parseRemoteTrackingRefs(output)
  } catch {
    return []
  }
}
