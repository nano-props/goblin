export interface WorktreeBootstrapTrust {
  configHash: string
  trustedAt: string
}

export interface RepoSettingsEntry {
  repoId: string
  worktreeBootstrapTrust?: WorktreeBootstrapTrust
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
