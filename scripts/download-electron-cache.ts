#!/usr/bin/env bun
// Download Electron zip from npmmirror to the local Electron cache.
// Usage: ./scripts/download-electron-cache.ts [--clean]
import { $ } from 'bun'
import { existsSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseArgs } from 'node:util'

const repoRoot = path.resolve(import.meta.dirname, '..')
process.chdir(repoRoot)

const { values } = parseArgs({
  options: {
    clean: { type: 'boolean' },
  },
})

interface PackageJson {
  devDependencies?: Record<string, string>
  dependencies?: Record<string, string>
}

const pkg = (await Bun.file(path.join(repoRoot, 'package.json')).json()) as PackageJson
const rawVersion = pkg.devDependencies?.electron ?? pkg.dependencies?.electron ?? ''
if (!rawVersion) {
  console.error('Error: Cannot get electron version from package.json')
  process.exit(1)
}

// Strip semver prefixes
const version = rawVersion.replace(/^[~^]/, '')

const arch = process.arch
const platform = process.platform

const cacheDir = path.join(os.homedir(), 'Library/Caches/electron')
const zipName = `electron-v${version}-${platform}-${arch}.zip`
const zipPath = path.join(cacheDir, zipName)
const url = `https://npmmirror.com/mirrors/electron/v${version}/${zipName}`

if (values.clean) {
  console.log('Cleaning Electron caches...')
  rmSync(path.join(os.homedir(), 'Library/Caches/electron'), { recursive: true, force: true })
  rmSync(path.join(os.homedir(), 'Library/Caches/electron-builder'), { recursive: true, force: true })
} else if (existsSync(zipPath)) {
  // Idempotent: skip re-download when the zip already exists. Note that
  // electron-builder itself uses a SHA1-hashed subdirectory under
  // ~/Library/Caches/electron and does NOT read this flat path; this script
  // exists as a manual warm-up, not as an electron-builder shortcut.
  const sizeMB = (Bun.file(zipPath).size / 1024 / 1024).toFixed(1)
  console.log(`Electron cache already populated (${sizeMB} MB), skipping download.`)
  console.log(`Path: ${zipPath}`)
  process.exit(0)
}

console.log(`Creating cache dir: ${cacheDir}`)
await $`mkdir -p ${cacheDir}`

console.log(`Downloading Electron ${version} (${arch})...`)
console.log(`URL: ${url}`)

const curlRes = await $`curl -L --progress-bar -o ${zipPath} ${url}`.nothrow()
if (curlRes.exitCode !== 0) {
  console.error('Error: download failed')
  process.exit(1)
}

console.log(`Done! Cached at: ${zipPath}`)
