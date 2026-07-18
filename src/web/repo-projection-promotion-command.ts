import type { RestoredWorkspaceRuntime } from '#/shared/api-types.ts'
import type { WorkspacePaneTabsSnapshot } from '#/shared/workspace-pane-tabs.ts'
import { readOrCreateWebTerminalClientId } from '#/web/client-terminal-id.ts'
import { restoreRepoTabsOnView } from '#/web/settings-actions.ts'

export type RepoProjectionPromotionResult =
  | { ok: true; workspace: RestoredWorkspaceRuntime; snapshot: WorkspacePaneTabsSnapshot | null }
  | { ok: false; message: string }

export interface RepoProjectionPromotionTarget {
  repoRoot: string
  workspaceRuntimeId: string
}

const inFlightPromotions = new Map<string, Promise<RepoProjectionPromotionResult>>()

export function runRepoProjectionPromotion(
  target: RepoProjectionPromotionTarget,
): Promise<RepoProjectionPromotionResult> {
  const key = `${target.repoRoot}\0${target.workspaceRuntimeId}`
  const existing = inFlightPromotions.get(key)
  if (existing) return existing

  const command = restoreRepoTabsOnView(readOrCreateWebTerminalClientId(), target.repoRoot, target.workspaceRuntimeId).then(
    (response) => ({ ok: true as const, workspace: response.workspace, snapshot: response.snapshot }),
    (err: unknown) => ({ ok: false as const, message: err instanceof Error ? err.message : String(err) }),
  )
  inFlightPromotions.set(key, command)
  void command.finally(() => {
    if (inFlightPromotions.get(key) === command) inFlightPromotions.delete(key)
  })
  return command
}
