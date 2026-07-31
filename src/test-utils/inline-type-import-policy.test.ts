import { describe, expect, test } from 'vitest'
import { findInlineTypeImportViolations, INLINE_TYPE_IMPORT_SOURCE_GLOBS } from '#scripts/inline-type-import-policy.ts'

const file = 'src/example.ts'

describe('inline type import policy', () => {
  test('covers repository TypeScript while excluding dependencies and generated output', () => {
    expect(INLINE_TYPE_IMPORT_SOURCE_GLOBS).toEqual([
      '**/*.{ts,tsx}',
      '!node_modules/**',
      '!dist/**',
      '!release/**',
      '!coverage/**',
    ])
  })

  test.each(['type Example = import("example").Example', 'type ExampleModule = typeof import("example")'])(
    'rejects inline type imports: %s',
    (source) => {
      expect(findInlineTypeImportViolations(source, file)).toEqual([
        `${file}:1: inline type imports are forbidden; use a top-level import type`,
      ])
    },
  )

  test('accepts top-level type imports', () => {
    expect(
      findInlineTypeImportViolations(
        "import type { Example } from 'example'\nimport type * as ExampleModule from 'example'\ntype Copy = Example\ntype ModuleCopy = typeof ExampleModule",
        file,
      ),
    ).toEqual([])
  })

  test('accepts runtime dynamic imports', () => {
    expect(findInlineTypeImportViolations("const module = await import('example')", file)).toEqual([])
  })
})
