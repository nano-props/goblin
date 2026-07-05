import type { RepoSettingsEntry } from '#/shared/repo-settings.ts'
import { isRepoWorktreeBootstrapConfigTrusted } from '#/shared/repo-settings.ts'
import type { WorktreeBootstrapDecision, WorktreeBootstrapPreview } from '#/shared/worktree-bootstrap-summary.ts'

export function resolveConfigTrusted(input: {
  repoSettings: readonly RepoSettingsEntry[]
  repoId: string
  configHash: string | null | undefined
  configTrustChoice: boolean | null
}): boolean {
  return (
    input.configTrustChoice ??
    isRepoWorktreeBootstrapConfigTrusted(input.repoSettings, input.repoId, input.configHash)
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
  repoSettings: readonly RepoSettingsEntry[]
  repoId: string
  configTrustChoice: boolean | null
}): WorktreeBootstrapDecision {
  const configHash = input.preview?.hasOperations ? input.preview.configHash : null
  if (!configHash) return { kind: 'skip' }
  return {
    kind: 'run',
    configHash,
    configTrusted: resolveConfigTrusted({
      repoSettings: input.repoSettings,
      repoId: input.repoId,
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
