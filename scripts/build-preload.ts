#!/usr/bin/env bun
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const repoRoot = path.resolve(import.meta.dirname, '..')
const preloadSourcePath = path.join(repoRoot, 'src/preload/preload.cjs')
const preloadDistDir = path.join(repoRoot, 'dist/preload')
const packageJsonPath = path.join(repoRoot, 'package.json')

const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { version: string }
const preloadSource = readFileSync(preloadSourcePath)
const hash = createHash('sha256').update(preloadSource).digest('hex').slice(0, 12)
const file = `preload-${pkg.version}-${hash}.cjs`

rmSync(preloadDistDir, { recursive: true, force: true })
mkdirSync(preloadDistDir, { recursive: true })
writeFileSync(path.join(preloadDistDir, file), preloadSource)
writeFileSync(path.join(preloadDistDir, 'manifest.json'), `${JSON.stringify({ file })}\n`)
