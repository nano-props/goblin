import { describe, expect, test } from 'vitest'
import { findTypeAssertionViolations } from '#scripts/type-assertion-policy.ts'

const file = 'src/example.ts'
const noAllowlist = new Map<string, readonly string[]>()

describe('type assertion policy', () => {
  test.each(['value as any', '<any>value'])('rejects any assertion syntax: %s', (source) => {
    expect(findTypeAssertionViolations(source, file, noAllowlist)).toEqual([
      `${file}:1: production any assertion is forbidden`,
    ])
  })

  test.each(['value as unknown as Target', '<Target>(<unknown>value)'])(
    'rejects double assertion syntax: %s',
    (source) => {
      expect(findTypeAssertionViolations(source, file, noAllowlist)).toEqual([`${file}:1: unreviewed double assertion`])
    },
  )

  test('allows only the complete reviewed expression', () => {
    const reviewed = 'value as unknown as Target'
    const allowlist = new Map([[file, [reviewed]]])

    expect(findTypeAssertionViolations(reviewed, file, allowlist)).toEqual([])
    expect(findTypeAssertionViolations(`(${reviewed}) as unknown as Other`, file, allowlist)).toEqual([
      `${file}:1: unreviewed double assertion`,
    ])
  })

  test('rejects ts-ignore directives', () => {
    expect(findTypeAssertionViolations('// @ts-ignore\ncall()', file, noAllowlist)).toEqual([
      `${file}:1: @ts-ignore is forbidden`,
    ])
  })
})
