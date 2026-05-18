#!/usr/bin/env bun
// Count lines of code in src/.
// Usage: ./scripts/count-lines.ts
import path from 'node:path'

const repoRoot = path.resolve(import.meta.dirname, '..')

function countLines(text: string): number {
  return text.split(/\r?\n/).filter((line) => line.trim().length > 0).length
}

async function scanDir(
  dir: string,
  patterns: string[],
): Promise<{ files: number; lines: number; nonEmptyLines: number }> {
  let files = 0
  let lines = 0
  let nonEmptyLines = 0

  for (const pattern of patterns) {
    const glob = new Bun.Glob(pattern)
    for await (const filePath of glob.scan({ cwd: dir, absolute: true, onlyFiles: true })) {
      const text = await Bun.file(filePath).text()
      const fileLines = text.split(/\r?\n/).length
      files++
      lines += fileLines
      nonEmptyLines += countLines(text)
    }
  }

  return { files, lines, nonEmptyLines }
}

async function main() {
  const srcPatterns = ['**/*.ts', '**/*.tsx', '**/*.css', '**/*.html', '**/*.cjs']

  const src = await scanDir(path.join(repoRoot, 'src'), srcPatterns)

  console.log('Line count summary')
  console.log('')
  console.log(`  src/ — ${src.files} files, ${src.lines} total lines (${src.nonEmptyLines} non-empty)`)
}

await main()
