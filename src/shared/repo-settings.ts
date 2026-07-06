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

/**
 * The canonical list of valid `WorkspaceExternalAppItem.id` values
 * that the server is willing to persist as a "most recently chosen
 * external app" per worktree. Mirrors `WORKSPACE_EXTERNAL_APPS` in
 * `src/web/external-workspace-apps.tsx`; the canonical web list lives
 * in the web layer (where React components are wired up) and this
 * readonly tuple exists so the server can validate persisted ids
 * without pulling in the React side.
 *
 * `as const` preserves the literal union so callers can derive
 * `WorkspaceExternalAppId` below without a parallel enum.
 *
 * ============================================================================
 * Adding a new external app — see the checklist in
 * `src/system/editors.ts` (top of file) for the full 7-10 step
 * process. For WebStorm in particular, the id to add here would be
 * `'editor:webstorm'`. The compile-time guard in
 * `src/web/external-workspace-apps.tsx` will reject the build if
 * you add a new id to the web array without also adding it here
 * (and vice versa) — that's by design, leave the guard in place.
 * ============================================================================
 */
export const WORKSPACE_EXTERNAL_APP_IDS = ['terminal:ghostty', 'terminal:terminal', 'editor:vscode', 'finder'] as const

export type WorkspaceExternalAppId = (typeof WORKSPACE_EXTERNAL_APP_IDS)[number]

const KNOWN_APP_ID_SET: ReadonlySet<string> = new Set(WORKSPACE_EXTERNAL_APP_IDS)

export function isKnownWorkspaceExternalAppItemId(value: unknown): value is WorkspaceExternalAppId {
  return typeof value === 'string' && KNOWN_APP_ID_SET.has(value)
}

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
