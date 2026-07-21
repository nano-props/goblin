import type { RestoredWorkspaceRuntime } from '#/shared/api-types.ts'
import type { WorkspacePaneTabsSnapshot } from '#/shared/workspace-pane-tabs.ts'
import { readClientPageId } from '#/web/client-page-id.ts'
import { restoreWorkspaceTabsOnView } from '#/web/settings-actions.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'

export type WorkspaceProjectionPromotionResult =
  | { ok: true; workspace: RestoredWorkspaceRuntime; snapshot: WorkspacePaneTabsSnapshot | null }
  | { ok: false; message: string }

export interface WorkspaceProjectionPromotionTarget {
  workspaceId: WorkspaceId
  workspaceRuntimeId: string
}

const inFlightPromotions = new Map<string, Promise<WorkspaceProjectionPromotionResult>>()

export function runWorkspaceProjectionPromotion(
  target: WorkspaceProjectionPromotionTarget,
): Promise<WorkspaceProjectionPromotionResult> {
  const key = `${target.workspaceId}\0${target.workspaceRuntimeId}`
  const existing = inFlightPromotions.get(key)
  if (existing) return existing

  const command = restoreWorkspaceTabsOnView(
    readClientPageId(),
    target.workspaceId,
    target.workspaceRuntimeId,
  ).then(
    (response) => ({ ok: true as const, workspace: response.workspace, snapshot: response.snapshot }),
    (err: unknown) => ({ ok: false as const, message: err instanceof Error ? err.message : String(err) }),
  )
  inFlightPromotions.set(key, command)
  void command.finally(() => {
    if (inFlightPromotions.get(key) === command) inFlightPromotions.delete(key)
  })
  return command
}
