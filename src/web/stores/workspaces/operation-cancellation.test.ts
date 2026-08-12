import { describe, expect, test } from 'vitest'
import { CodedError } from '#/shared/coded-error.ts'
import {
  isExpectedRepoOperationCancellation,
  RepoOperationCancelledError,
} from '#/web/stores/workspaces/operation-cancellation.ts'

describe('repo operation cancellation classification', () => {
  test('does not hide an uncertain command outcome behind the aborted operation signal', () => {
    const controller = new AbortController()
    controller.abort(new RepoOperationCancelledError())

    expect(
      isExpectedRepoOperationCancellation(
        new CodedError({ code: 'OUTCOME_UNCERTAIN', message: 'repository command outcome uncertain' }),
        controller.signal,
      ),
    ).toBe(false)
  })
})
