import { describe, expect, test } from 'vitest'
import { CodedError } from '#/shared/coded-error.ts'
import { assertWorkspaceCapabilityTransitionCommitted } from '#/server/workspace-capability-transition-host.ts'

describe('workspace capability transition host', () => {
  test('surfaces post-durable authority failure as an uncertain operation', () => {
    const cause = new Error('terminal authority commit failed')

    expect(() =>
      assertWorkspaceCapabilityTransitionCommitted({
        kind: 'committed-authority-uncertain',
        error: cause,
      }),
    ).toThrowError(
      expect.objectContaining({
        name: CodedError.name,
        code: 'OUTCOME_UNCERTAIN',
        message: 'error.operation-outcome-uncertain',
        cause,
      }),
    )
  })
})
