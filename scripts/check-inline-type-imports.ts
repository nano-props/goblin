#!/usr/bin/env bun
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { glob } from 'tinyglobby'
import { findInlineTypeImportViolations, INLINE_TYPE_IMPORT_SOURCE_GLOBS } from '#scripts/inline-type-import-policy.ts'

const repoRoot = path.resolve(import.meta.dirname, '..')
const sourceFiles = await glob(INLINE_TYPE_IMPORT_SOURCE_GLOBS, { cwd: repoRoot })
const violations: string[] = []

for (const file of sourceFiles) {
  const source = await readFile(path.join(repoRoot, file), 'utf8')
  violations.push(...findInlineTypeImportViolations(source, file))
}

if (violations.length > 0) {
  console.error(
    ['[inline-type-imports] inline type imports found:', ...violations.map((item) => `  - ${item}`)].join('\n'),
  )
  process.exit(1)
}

console.log('[inline-type-imports] all type dependencies use top-level imports')
