import * as v from 'valibot'
import { describe, expect, test } from 'vitest'
import { RepoTreePrefixSchema } from '#/shared/repo-tree-schema.ts'

describe('RepoTreePrefixSchema', () => {
  const cases: { input: string; ok: boolean; label: string }[] = [
    { input: 'src', ok: true, label: 'top-level relative' },
    { input: 'src/util', ok: true, label: 'nested relative' },
    { input: 'src/util/helper.ts', ok: true, label: 'file under prefix' },
    { input: 'a-b_c.d', ok: true, label: 'dotted filename' },
    { input: '中文目录/文件.ts', ok: true, label: 'non-ASCII characters' },
    { input: '', ok: false, label: 'empty string' },
    { input: '.', ok: false, label: 'current directory literal' },
    { input: './src', ok: false, label: 'leading ./' },
    { input: 'src/./util', ok: false, label: 'mid-path .' },
    { input: '..', ok: false, label: 'parent directory literal' },
    { input: '../etc/passwd', ok: false, label: 'top-level escape' },
    { input: 'src/../../etc', ok: false, label: 'mid-path escape' },
    { input: '/abs/path', ok: false, label: 'leading slash' },
    { input: 'src//util', ok: false, label: 'double slash' },
    { input: 'src\\\\util', ok: false, label: 'backslash separator' },
    { input: 'src/\0/evil', ok: false, label: 'embedded NUL byte' },
    { input: 'src/\n/util', ok: false, label: 'embedded LF' },
    { input: 'src/\t/util', ok: false, label: 'embedded TAB' },
  ]

  for (const { input, ok, label } of cases) {
    test(`validates ${label} as ${ok ? 'ok' : 'rejected'}`, () => {
      const result = v.safeParse(RepoTreePrefixSchema, input)
      if (ok) {
        expect(result.success).toBe(true)
      } else {
        expect(result.success).toBe(false)
      }
    })
  }

  test('rejects strings longer than 4096 characters', () => {
    const result = v.safeParse(RepoTreePrefixSchema, 'a'.repeat(4097))
    expect(result.success).toBe(false)
  })
})