import { describe, expect, test } from 'vitest'
import {
  isConfigTrustStateLoading,
  resolveConfigTrusted,
  resolveNextConfigTrustChoice,
  resolveWorktreeBootstrapDecision,
} from '#/web/components/create-worktree/create-worktree-bootstrap-host.logic.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'

const WORKSPACE_ID = workspaceIdForTest('goblin+file:///workspace')
const CONFIG_HASH = 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

describe('create worktree bootstrap host logic', () => {
  test('runs untrusted config by default when the server has no matching trust record', () => {
    expect(
      resolveWorktreeBootstrapDecision({
        preview: preview(CONFIG_HASH),
        workspaceSettings: [],
        workspaceId: WORKSPACE_ID,
        configTrustChoice: null,
      }),
    ).toEqual({ kind: 'run', configHash: CONFIG_HASH, configTrusted: false })
  })

  test('uses server trust as the default decision for a matching config hash', () => {
    expect(
      resolveConfigTrusted({
        workspaceSettings: trustedWorkspaceSettings(),
        workspaceId: WORKSPACE_ID,
        configHash: CONFIG_HASH,
        configTrustChoice: null,
      }),
    ).toBe(true)
  })

  test('user trust choice overrides the server default', () => {
    expect(
      resolveWorktreeBootstrapDecision({
        preview: preview(CONFIG_HASH),
        workspaceSettings: trustedWorkspaceSettings(),
        workspaceId: WORKSPACE_ID,
        configTrustChoice: false,
      }),
    ).toEqual({ kind: 'run', configHash: CONFIG_HASH, configTrusted: false })
  })

  test('skips bootstrap when preview has no runnable config operations', () => {
    expect(
      resolveWorktreeBootstrapDecision({
        preview: preview(null),
        workspaceSettings: trustedWorkspaceSettings(),
        workspaceId: WORKSPACE_ID,
        configTrustChoice: true,
      }),
    ).toEqual({ kind: 'skip' })
  })

  test('keeps local choice unchanged for controlled checkbox no-op changes', () => {
    expect(
      resolveNextConfigTrustChoice({
        next: false,
        currentTrusted: false,
        serverTrusted: true,
        currentChoice: false,
      }),
    ).toBe(false)
  })

  test('clears local choice when the next value matches the server default', () => {
    expect(
      resolveNextConfigTrustChoice({
        next: true,
        currentTrusted: false,
        serverTrusted: true,
        currentChoice: false,
      }),
    ).toBeNull()
  })

  test('blocks submit while a runnable config preview is waiting for settings', () => {
    expect(isConfigTrustStateLoading({ preview: preview(CONFIG_HASH), settingsReady: false })).toBe(true)
    expect(isConfigTrustStateLoading({ preview: preview(CONFIG_HASH), settingsReady: true })).toBe(false)
    expect(isConfigTrustStateLoading({ preview: preview(null), settingsReady: false })).toBe(false)
  })
})

function trustedWorkspaceSettings() {
  return [
    {
      workspaceId: WORKSPACE_ID,
      worktreeBootstrapTrust: {
        configHash: CONFIG_HASH,
        trustedAt: '2026-06-26T00:00:00.000Z',
      },
    },
  ]
}

function preview(configHash: string | null) {
  return {
    hasConfig: configHash !== null,
    hasOperations: configHash !== null,
    configHash,
    copyCount: configHash ? 1 : 0,
    symlinkCount: 0,
    hardlinkCount: 0,
    excludeCount: 0,
  }
}
