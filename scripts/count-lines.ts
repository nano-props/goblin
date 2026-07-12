#!/usr/bin/env bun
// Count lines of code in src/.
// Usage: ./scripts/count-lines.ts
import path from 'node:path'

const repoRoot = path.resolve(import.meta.dirname, '..')
const numberFormatter = new Intl.NumberFormat()

type LineStats = { files: number; lines: number; nonEmptyLines: number }

function countLines(text: string): number {
  return text.split(/\r?\n/).filter((line) => line.trim().length > 0).length
}

function createLineStats(): LineStats {
  return { files: 0, lines: 0, nonEmptyLines: 0 }
}

function addFileStats(stats: LineStats, text: string) {
  stats.files++
  stats.lines += text.split(/\r?\n/).length
  stats.nonEmptyLines += countLines(text)
}

function isTestFile(filePath: string, rootDir: string): boolean {
  const relativePath = path.relative(rootDir, filePath).split(path.sep).join('/')
  const pathSegments = relativePath.split('/')

  return pathSegments.includes('test-utils') || /\.(test|spec)\.[cm]?[jt]sx?$/.test(relativePath)
}

async function scanDir(
  dir: string,
  patterns: string[],
): Promise<{ all: LineStats; nonTests: LineStats; tests: LineStats }> {
  const stats = { all: createLineStats(), nonTests: createLineStats(), tests: createLineStats() }
  const seen = new Set<string>()

  for (const pattern of patterns) {
    const glob = new Bun.Glob(pattern)
    for await (const filePath of glob.scan({ cwd: dir, absolute: true, onlyFiles: true })) {
      if (seen.has(filePath)) continue
      seen.add(filePath)

      const text = await Bun.file(filePath).text()
      addFileStats(stats.all, text)
      addFileStats(isTestFile(filePath, dir) ? stats.tests : stats.nonTests, text)
    }
  }

  return stats
}

function formatStats(label: string, stats: LineStats): string {
  return `  ${label.padEnd(16)} - ${numberFormatter.format(stats.files)} files, ${numberFormatter.format(stats.lines)} total lines (${numberFormatter.format(stats.nonEmptyLines)} non-empty)`
}

async function main() {
  const srcPatterns = ['**/*.ts', '**/*.tsx', '**/*.css', '**/*.html', '**/*.cjs']

  const src = await scanDir(path.join(repoRoot, 'src'), srcPatterns)

  console.log('Line count summary')
  console.log('')
  console.log(formatStats('src/ (all)', src.all))
  console.log(formatStats('src/ (non-test)', src.nonTests))
  console.log(formatStats('src/ test code', src.tests))
}

await main()
