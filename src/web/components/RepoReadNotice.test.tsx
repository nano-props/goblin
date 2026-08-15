// @vitest-environment jsdom

import { screen } from '@testing-library/vue'
import { describe, expect, test, vi } from 'vitest'
import { REPO_MEMBERSHIP_READ_CONFLICT_KEY } from '#/shared/repo-membership-read.ts'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { RepoReadNotice } from '#/web/components/RepoReadNotice.tsx'

describe('RepoReadNotice', () => {
  test('reports a mixed stale and unavailable failure as unavailable', () => {
    renderInJsdom(
      <RepoReadNotice
        failures={[
          { message: 'snapshot failed', stale: true, retrying: false },
          { message: 'status failed', stale: false, retrying: false },
        ]}
      />,
    )

    expect(screen.getByRole('alert')).toBeTruthy()
    expect(screen.queryByRole('status')).toBeNull()
  })

  test('reports membership changes as a neutral in-progress condition', () => {
    renderInJsdom(
      <RepoReadNotice
        failures={[
          {
            message: REPO_MEMBERSHIP_READ_CONFLICT_KEY,
            stale: false,
            retrying: false,
            retry: vi.fn(),
          },
        ]}
      />,
    )

    expect(screen.getByRole('status')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByText(REPO_MEMBERSHIP_READ_CONFLICT_KEY)).toBeTruthy()
  })
})
