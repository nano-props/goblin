export interface WorktreeBootstrapTrust {
  configHash: string
  trustedAt: string
}

/**
 * Per-worktree record of the most recently chosen workspace external app
 * (the split-button primary in the workspace toolbar). The key is the
 * worktree's absolute path; an empty string represents the bare repo
 * (no worktree attached). Lives under
 * `RepoSettingsEntry.workspaceExternalAppRecent.byWorktree`.
 */
export interface WorkspaceExternalAppRecent {
  byWorktree: Record<string, string>
}

export interface RepoSettingsEntry {
  repoId: string
  worktreeBootstrapTrust?: WorktreeBootstrapTrust
  workspaceExternalAppRecent?: WorkspaceExternalAppRecent
}

export const WORKTREE_BOOTSTRAP_CONFIG_HASH_RE = /^sha256:[a-f0-9]{64}$/

export function isWorktreeBootstrapConfigHash(value: unknown): value is string {
  return typeof value === 'string' && WORKTREE_BOOTSTRAP_CONFIG_HASH_RE.test(value)
}

export function repoSettingsEntryForRepo(
  repoSettings: readonly RepoSettingsEntry[],
  repoId: string,
): RepoSettingsEntry | undefined {
  return repoSettings.find((entry) => entry.repoId === repoId)
}

export function isRepoWorktreeBootstrapConfigTrusted(
  repoSettings: readonly RepoSettingsEntry[],
  repoId: string,
  configHash: string | null | undefined,
): boolean {
  if (!configHash) return false
  return repoSettingsEntryForRepo(repoSettings, repoId)?.worktreeBootstrapTrust?.configHash === configHash
}

/**
 * Encode the persisted recent-app key for a worktree scope. Path validation
 * and canonicalization happen on the server before writes; this shared helper
 * intentionally stays browser-pure so client readers can use the same key
 * shape without importing Node built-ins.
 */
export function workspaceExternalAppRecentKey(worktreePath: string | null | undefined): string {
  return worktreePath ?? ''
}

/**
 * Read the most recently chosen workspace-external-app id for a
 * (repo, worktree) scope. Returns null when no entry exists for the repo
 * or for that worktree.
 */
export function getRecentWorkspaceExternalAppId(
  repoSettings: readonly RepoSettingsEntry[],
  repoId: string,
  worktreePath: string | null | undefined,
): string | null {
  const byWorktree = repoSettingsEntryForRepo(repoSettings, repoId)?.workspaceExternalAppRecent?.byWorktree
  if (!byWorktree) return null
  return byWorktree[workspaceExternalAppRecentKey(worktreePath)] ?? null
}
