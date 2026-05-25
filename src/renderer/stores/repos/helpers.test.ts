import { describe, expect, test } from 'vitest'
import { emptyRepo } from '#/renderer/stores/repos/helpers.ts'

describe('emptyRepo', () => {
  test('exposes resources without operation execution state', () => {
    const repo = emptyRepo('/tmp/goblin-helper-test', 'repo')

    expect(repo.resources).toBeDefined()
    expect(Object.prototype.hasOwnProperty.call(repo, 'ops')).toBe(false)
  })
})
