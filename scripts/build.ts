#!/usr/bin/env bun
// Build and package Goblin.
//   default → Goblin.app under release/mac*/ (via electron-builder mac dmg+dir)
//   install → builds the `dir` target only (no dmg packaging) and moves
//             Goblin.app into ~/Applications, closing any running instance
//             first. macOS-only.
//
// Usage: ./scripts/build.ts [install|i]
import { $ } from 'bun'
import { chmodSync, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { closeRunningApp } from './close-app.ts'

const repoRoot = path.resolve(import.meta.dirname, '..')
process.chdir(repoRoot)
$.cwd(repoRoot)

const APP_NAME = 'Goblin'
const APP_ID = 'goblin.app'

const { positionals } = parseArgs({ allowPositionals: true })
const mode = positionals[0]
const shouldInstall = mode === 'install' || mode === 'i'

async function findBuiltApp(): Promise<string | null> {
  // mac dir target emits one directory per declared arch (`mac-arm64`,
  // `mac` for x64). Pick the one matching the host so `install` puts the
  // right binary in ~/Applications.
  const hostDir = process.arch === 'arm64' ? 'mac-arm64' : 'mac'
  const candidate = path.join(repoRoot, 'release', hostDir, `${APP_NAME}.app`)
  return existsSync(candidate) ? candidate : null
}

// Clear any prior build output so `findBuiltApp` can't pick up a stale
// artifact if electron-builder fails partway through. A matching rm
// after a successful install is run below.
rmSync(path.join(repoRoot, 'release'), { recursive: true, force: true })

await $`bun install`
if (process.platform === 'darwin') {
  const ptySpawnHelperArches = shouldInstall ? [process.arch] : ['arm64', 'x64']
  const ptySpawnHelpers = ptySpawnHelperArches.map((arch) =>
    path.join(repoRoot, 'node_modules/node-pty/prebuilds', `darwin-${arch}`, 'spawn-helper'),
  )
  const missingPtySpawnHelpers = ptySpawnHelpers.filter((helper) => !existsSync(helper))
  if (missingPtySpawnHelpers.length > 0) {
    console.error(`Error: missing node-pty darwin spawn-helper(s): ${missingPtySpawnHelpers.join(', ')}`)
    process.exit(1)
  }
  for (const helper of ptySpawnHelpers) {
    chmodSync(helper, 0o755)
  }
}
await $`bun run typecheck`
// Renderer bundle MUST exist before electron-builder packs it (the
// `files` glob in electron-builder.ts expects `dist/web/`).
await $`bun run build:web`
await $`bun run build:server`
const webDist = path.join(repoRoot, 'dist/web')
for (const artifact of [path.join(webDist, 'index.html'), path.join(webDist, 'boot.js')]) {
  if (!existsSync(artifact)) {
    console.error(`Error: web build artifact missing: ${artifact}`)
    process.exit(1)
  }
}
const serverDistEntry = path.join(repoRoot, 'dist/server/main.js')
if (!existsSync(serverDistEntry)) {
  console.error(`Error: server build artifact missing: ${serverDistEntry}`)
  process.exit(1)
}
// `dir` target skips dmg packaging — faster, and `install` only needs the .app.
// In install mode we also pin to the host arch so we don't waste time
// cross-building the other architecture's binaries when we're going to
// throw them away.
const archFlag = process.arch === 'arm64' ? '--arm64' : '--x64'
const builderArgs = shouldInstall ? ['--mac', 'dir', archFlag] : ['--mac']
if (shouldInstall) {
  await $`bun run build:electron -- ${builderArgs}`
} else {
  // Build each arch serially to avoid proper-lockfile races in dmg-builder
  // when electron-builder parallelises multiple macOS architectures.
  for (const arch of ['arm64', 'x64']) {
    await $`bun run build:electron -- --mac dmg --${arch}`
  }
}

const srcApp = await findBuiltApp()
if (!srcApp) {
  console.error(`Error: could not find built ${APP_NAME}.app under release/`)
  process.exit(1)
}
console.log(`Built: ${path.relative(repoRoot, srcApp)}`)

if (shouldInstall) {
  if (process.platform !== 'darwin') {
    console.error('install mode is macOS-only')
    process.exit(1)
  }

  console.log(`Installing ${APP_NAME}.app to ~/Applications...`)

  // Close a running Goblin.app before replacing it. Relative path because
  // scripts/ sits outside src/ and isn't covered by the `#/` alias.
  await closeRunningApp()

  const appsDir = path.join(os.homedir(), 'Applications')
  mkdirSync(appsDir, { recursive: true })
  const destApp = path.join(appsDir, `${APP_NAME}.app`)
  rmSync(destApp, { recursive: true, force: true })
  renameSync(srcApp, destApp)
  console.log(`Installed: ${destApp}`)

  // electron-builder's ad-hoc signature (identity: null) uses the Electron
  // binary identifier and does not bind Info.plist. macOS Notification Center
  // identifies apps by the code-signing identifier, not CFBundleIdentifier, so
  // without re-signing the app appears as "Electron" in notification settings
  // and the NSUserNotificationAlertStyle plist key has no effect.
  // Re-signing with --identifier forces the correct bundle ID and binds the
  // Info.plist so notifications work and Goblin appears in System Settings.
  console.log('Re-signing with correct bundle identifier...')
  await $`codesign --force --deep --sign - --identifier ${APP_ID} ${destApp}`
  console.log('Re-signed.')

  rmSync(path.join(repoRoot, 'release'), { recursive: true, force: true })
  console.log('Done.')
}
