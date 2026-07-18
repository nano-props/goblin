import type { WorkspaceSettingsEntry } from '#/shared/workspace-settings.ts'
import { isWorkspaceWorktreeBootstrapConfigTrusted } from '#/shared/workspace-settings.ts'
import type { WorktreeBootstrapDecision, WorktreeBootstrapPreview } from '#/shared/worktree-bootstrap-summary.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'

export function resolveConfigTrusted(input: {
  workspaceSettings: readonly WorkspaceSettingsEntry[]
  workspaceId: WorkspaceId
  configHash: string | null | undefined
  configTrustChoice: boolean | null
}): boolean {
  return (
    input.configTrustChoice ??
    isWorkspaceWorktreeBootstrapConfigTrusted(input.workspaceSettings, input.workspaceId, input.configHash)
  )
}

export function resolveNextConfigTrustChoice(input: {
  next: boolean
  currentTrusted: boolean
  serverTrusted: boolean
  currentChoice: boolean | null
}): boolean | null {
  if (input.next === input.currentTrusted) return input.currentChoice
  return input.next === input.serverTrusted ? null : input.next
}

export function resolveWorktreeBootstrapDecision(input: {
  preview: WorktreeBootstrapPreview | null
  workspaceSettings: readonly WorkspaceSettingsEntry[]
  workspaceId: WorkspaceId
  configTrustChoice: boolean | null
}): WorktreeBootstrapDecision {
  const configHash = input.preview?.hasOperations ? input.preview.configHash : null
  if (!configHash) return { kind: 'skip' }
  return {
    kind: 'run',
    configHash,
    configTrusted: resolveConfigTrusted({
      workspaceSettings: input.workspaceSettings,
      workspaceId: input.workspaceId,
      configHash,
      configTrustChoice: input.configTrustChoice,
    }),
  }
}

export function isConfigTrustStateLoading(input: {
  preview: WorktreeBootstrapPreview | null
  settingsReady: boolean
}): boolean {
  return input.preview?.hasOperations === true && !!input.preview.configHash && !input.settingsReady
}
