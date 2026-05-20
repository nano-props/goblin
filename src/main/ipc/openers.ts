import { ipcMain, shell } from 'electron'
import { getBranchPullRequest } from '#/main/git/pull-requests.ts'
import { getGitHubUrl, getPullRequestUrl } from '#/main/git/remote.ts'
import { isGhosttyInstalled, openInGhostty } from '#/main/system/ghostty.ts'
import { isVSCodeInstalled, openInVSCode } from '#/main/system/vscode.ts'
import { isValidAbsolutePath, isValidCwd, isValidOptionalBranch } from '#/main/ipc/validation.ts'

const PROJECT_GITHUB_URL = 'https://github.com/nano-props/goblin'

async function openHttpsExternal(url: string): Promise<boolean> {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:') return false
    await shell.openExternal(parsed.toString())
    return true
  } catch {
    return false
  }
}

export function wireOpenersIpc(): void {
  ipcMain.handle('app:open-project-github', async () => {
    if (!(await openHttpsExternal(PROJECT_GITHUB_URL))) return { ok: false, message: 'error.invalid-url' }
    return { ok: true, message: PROJECT_GITHUB_URL }
  })

  ipcMain.handle('repo:open-github', async (_e, cwd: string, branch?: string) => {
    if (!isValidCwd(cwd) || !isValidOptionalBranch(branch)) return { ok: false, message: 'error.invalid-arguments' }
    if (branch) {
      const detectedPr = await getBranchPullRequest(cwd, branch)
      if (detectedPr?.url) {
        if (await openHttpsExternal(detectedPr.url)) return { ok: true, message: detectedPr.url }
      }
    }
    // Prefer a PR-shaped URL when we know the branch: GitHub's
    // `/pull/new/{branch}` redirects to the existing open PR if one
    // exists, otherwise lands on the create-PR page. That covers
    // both "show me the PR for this branch" and "start a PR" with a
    // single URL. Fall back to the repo home for callers that don't
    // pass a branch (or the default branch, where a PR doesn't make
    // sense).
    const isDefaultBranch = branch === 'main' || branch === 'master' || branch === 'trunk'
    if (typeof branch === 'string' && branch && !isDefaultBranch) {
      const prUrl = await getPullRequestUrl(cwd, branch)
      if (prUrl) {
        if (await openHttpsExternal(prUrl)) return { ok: true, message: prUrl }
      }
    }
    const url = await getGitHubUrl(cwd)
    if (!url) return { ok: false, message: 'error.open-github-no-origin' }
    if (!(await openHttpsExternal(url))) return { ok: false, message: 'error.invalid-url' }
    return { ok: true, message: url }
  })

  // `showItemInFolder` reveals the path in Finder/Explorer without
  // launching it — strictly safer than `openPath`, which on macOS will
  // run any executable / .app / .command at the given path. Worktree
  // paths come from `git worktree list` which are always directories,
  // but defending against future callers / a malicious renderer is
  // cheap and worth it given the IPC bridge surface.
  ipcMain.handle('repo:open-in-finder', async (_e, p: string) => {
    if (!isValidAbsolutePath(p)) return { ok: false, message: 'error.invalid-path' }
    shell.showItemInFolder(p)
    return { ok: true, message: p }
  })

  ipcMain.handle('repo:ghostty-installed', () => isGhosttyInstalled())
  ipcMain.handle('repo:vscode-installed', () => isVSCodeInstalled())

  ipcMain.handle('repo:open-in-ghostty', async (_e, p: string) => {
    if (!isValidAbsolutePath(p)) return { ok: false, message: 'error.invalid-path' }
    return openInGhostty(p)
  })

  ipcMain.handle('repo:open-in-vscode', async (_e, p: string) => {
    if (!isValidAbsolutePath(p)) return { ok: false, message: 'error.invalid-path' }
    return openInVSCode(p)
  })
}
