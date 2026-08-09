import { describe, expect, test } from 'vitest'
import { workspaceIdFromSlug, workspaceSlugFromId } from '#/web/workspace-route-slugs.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'

describe('workspace route slugs', () => {
  test('round-trips local workspace identities as base64url slugs', () => {
    const workspaceId = workspaceIdForTest('goblin+file:///path/to/workspace')

    expect(workspaceIdFromSlug(workspaceSlugFromId(workspaceId))).toBe(workspaceId)
  })

  test('round-trips remote workspace identities', () => {
    const workspaceId = workspaceIdForTest('goblin+ssh://example.test/workspace')

    expect(workspaceIdFromSlug(workspaceSlugFromId(workspaceId))).toBe(workspaceId)
  })

  test('admits only canonical workspace identities at the route boundary', () => {
    expect(workspaceIdFromSlug(workspaceSlugFromId(workspaceIdForTest('goblin+file:///workspace')))).toBe(
      'goblin+file:///workspace',
    )
    expect(workspaceIdFromSlug(slugForTest('/workspace'))).toBeNull()
    expect(workspaceIdFromSlug(slugForTest('goblin+file:///workspace/'))).toBeNull()
    expect(workspaceIdFromSlug('%')).toBeNull()
  })
})

function slugForTest(value: string): string {
  return btoa(value).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}
