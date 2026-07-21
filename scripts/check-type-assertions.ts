#!/usr/bin/env bun
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { glob } from 'tinyglobby'
import { findTypeAssertionViolations } from '#scripts/type-assertion-policy.ts'

const repoRoot = path.resolve(import.meta.dirname, '..')

const DOUBLE_ASSERTION_ALLOWLIST = new Map([
  ['src/server/terminal/terminal-render-state.ts', ['serializer as unknown as ITerminalAddon']],
  [
    'src/web/components/terminal/terminal-session-view.ts',
    ['term as unknown as { _core?: { coreService?: { onUserInput?: unknown } } }'],
  ],
])

const sourceFiles = await glob(
  [
    'src/**/*.{ts,tsx}',
    '!src/**/*.test.{ts,tsx}',
    '!src/**/*.component.test.{ts,tsx}',
    '!src/test-utils/**',
    '!src/**/test-utils/**',
  ],
  { cwd: repoRoot },
)

const violations: string[] = []
for (const file of sourceFiles) {
  const source = await readFile(path.join(repoRoot, file), 'utf8')
  violations.push(...findTypeAssertionViolations(source, file, DOUBLE_ASSERTION_ALLOWLIST))
}

if (violations.length > 0) {
  console.error(
    ['[type-assertions] unsafe type escape hatches found:', ...violations.map((item) => `  - ${item}`)].join('\n'),
  )
  process.exit(1)
}

console.log('[type-assertions] production escape hatches are reviewed')
