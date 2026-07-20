import { describe, expect, test } from 'vitest'
import {
  workspaceGitCleanupRequired,
  workspaceGitProbeConclusion,
} from '#/server/modules/workspace-capability-transition.ts'
import type { WorkspaceProbeState } from '#/shared/workspace-runtime.ts'

const PLAIN_PROBE: WorkspaceProbeState = {
  status: 'ready',
  name: 'workspace',
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
      workspaceGitCleanupRequired(
        { status: 'probing' },
        { ...PLAIN_PROBE, diagnostics: [{ scope: 'git', message: 'Git probe timed out' }] },
      ),
    ).toBe(false)
    expect(workspaceGitCleanupRequired({ status: 'probing' }, PLAIN_PROBE)).toBe(true)
  })
})
