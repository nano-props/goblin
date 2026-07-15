import type { ProjectedRestoredWorkspaceRepoRuntime } from '#/shared/api-types.ts'
import type { WorkspacePaneTabsSnapshot } from '#/shared/workspace-pane-tabs.ts'
import { readOrCreateWebTerminalClientId } from '#/web/client-terminal-id.ts'
import { restoreRepoTabsOnView } from '#/web/settings-actions.ts'

export type RepoProjectionPromotionResult =
  | { ok: true; repo: ProjectedRestoredWorkspaceRepoRuntime; snapshot: WorkspacePaneTabsSnapshot | null }
  | { ok: false; message: string }

export interface RepoProjectionPromotionTarget {
  repoRoot: string
  repoRuntimeId: string
}

const inFlightPromotions = new Map<string, Promise<RepoProjectionPromotionResult>>()

export function runRepoProjectionPromotion(
  target: RepoProjectionPromotionTarget,
): Promise<RepoProjectionPromotionResult> {
  const key = `${target.repoRoot}\0${target.repoRuntimeId}`
  const existing = inFlightPromotions.get(key)
  if (existing) return existing

  const command = restoreRepoTabsOnView(readOrCreateWebTerminalClientId(), target.repoRoot, target.repoRuntimeId).then(
    (response) => ({ ok: true as const, repo: response.repo, snapshot: response.snapshot }),
    (err: unknown) => ({ ok: false as const, message: err instanceof Error ? err.message : String(err) }),
  )
  inFlightPromotions.set(key, command)
  void command.finally(() => {
    if (inFlightPromotions.get(key) === command) inFlightPromotions.delete(key)
  })
  return command
}
