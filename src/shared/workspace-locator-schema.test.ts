import { describe, expect, test } from 'vitest'
import * as v from 'valibot'
import { WorkspaceIdSchema } from '#/shared/workspace-locator-schema.ts'

describe('WorkspaceIdSchema', () => {
  test.each(['goblin+file:///workspace', 'goblin+file:///C:/workspace', 'goblin+ssh://example/workspace'])(
    'accepts canonical cross-platform wire identity %s',
    (id) => {
      expect(v.safeParse(WorkspaceIdSchema, id).success).toBe(true)
    },
  )

  test.each(['/workspace', 'goblin+file:///workspace/', 'goblin+ssh://example/workspace/../other'])(
    'rejects noncanonical identity %s',
    (id) => {
      expect(v.safeParse(WorkspaceIdSchema, id).success).toBe(false)
    },
  )
})
