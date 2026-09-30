#!/usr/bin/env bun
import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'

const repoRoot = path.resolve(import.meta.dirname, '..')
process.chdir(repoRoot)
if (process.platform !== 'linux' && process.platform !== 'darwin')
  throw new Error('Build on Linux or macOS; Bun PTY requires POSIX')
if (!existsSync('dist/web/index.html') || !existsSync('dist/web/boot.js'))
  throw new Error('Build the browser assets first: bun run build:web')
mkdirSync('dist', { recursive: true })
const result = await Bun.build({
  entrypoints: ['src/server/main.ts'],
  target: 'bun',
  minify: true,
  compile: { outfile: 'dist/goblin', assets: ['dist/web'], autoloadDotenv: false, autoloadBunfig: false },
})
if (!result.success) throw new AggregateError(result.logs, 'Goblin executable build failed')
console.log('Built dist/goblin (Bun runtime, browser assets, server, PTY worker, g command, SSH scripts)')
