import { describe, expect, test } from 'vitest'
import {
  workspaceGitCapabilityTransition,
  workspaceGitProbeConclusion,
} from '#/server/workspaces/runtime/capability-transition.ts'
import type { WorkspaceProbeState } from '#/shared/workspace-runtime.ts'

const PLAIN_PROBE: WorkspaceProbeState = {
  status: 'ready',
  capabilities: {
    files: { read: true, write: true },
    terminal: { available: true },
    git: { status: 'unavailable' },
  },
  diagnostics: [],
}

describe('workspace Git probe conclusion', () => {
  test('uses only Git-owned diagnostics to decide availability', () => {
    expect(workspaceGitProbeConclusion(PLAIN_PROBE)).toBe('conclusive-unavailable')
    expect(
      workspaceGitProbeConclusion({
        ...PLAIN_PROBE,
        diagnostics: [{ scope: 'transport', message: 'Transport recovered with a warning' }],
      }),
    ).toBe('conclusive-unavailable')
    expect(
      workspaceGitProbeConclusion({
        ...PLAIN_PROBE,
        diagnostics: [{ scope: 'git', message: 'Git probe timed out' }],
      }),
    ).toBe('inconclusive')
  })

  test('requires a settled conclusion before cleanup', () => {
    expect(workspaceGitProbeConclusion({ status: 'probing' })).toBe('inconclusive')
    expect(
      workspaceGitCapabilityTransition(
        { status: 'probing' },
        { ...PLAIN_PROBE, diagnostics: [{ scope: 'git', message: 'Git probe timed out' }] },
      ),
    ).toBeNull()
    expect(workspaceGitCapabilityTransition({ status: 'probing' }, PLAIN_PROBE)).toBe('removal')
  })

  test('classifies capability promotion and removal', () => {
    const gitProbe: WorkspaceProbeState = {
      ...PLAIN_PROBE,
      capabilities: {
        ...PLAIN_PROBE.capabilities,
        git: { status: 'available', worktrees: true, pullRequests: { provider: 'none' } },
      },
    }
    expect(workspaceGitCapabilityTransition(PLAIN_PROBE, gitProbe)).toBe('promotion')
    expect(workspaceGitCapabilityTransition(gitProbe, PLAIN_PROBE)).toBe('removal')
    expect(workspaceGitCapabilityTransition(gitProbe, gitProbe)).toBeNull()
    expect(workspaceGitCapabilityTransition({ status: 'probing' }, gitProbe)).toBe('promotion')
  })
})
