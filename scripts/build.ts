#!/usr/bin/env bun
// Build and package Goblin.
//   default → Goblin.app under release/mac*/ (via electron-builder mac dmg+dir)
//   install → builds the `dir` target only (no dmg packaging) and moves
//             Goblin.app into ~/Applications, closing any running instance
//             first. macOS-only.
//
// Usage: ./scripts/build.ts [install|i] [--clean]
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

// Tunable behaviour. CLI flags win; env vars fill the gap so shell/CI can
// set them once. Install-mode defaults are tuned for a fast rebuild
// (`install.sh` is the hot path; `bun run build` keeps upstream behaviour).
const shouldInstallMode = (mode: string) => mode === 'install' || mode === 'i'
const truthy = (v: string | undefined) => v === '1' || v === 'true'

interface BuildOptions {
  clean: boolean
  skipTypecheck: boolean
  skipRebuild: boolean
  prewarm: boolean
  electronMirror: string | null
  binariesMirror: string | null
}

interface CliFlags {
  clean?: boolean
  'skip-typecheck'?: boolean
  'keep-typecheck'?: boolean
  'skip-rebuild'?: boolean
  'keep-rebuild'?: boolean
  prewarm?: boolean
  'no-prewarm'?: boolean
  'npm-mirror'?: boolean
}

const NPM_MIRROR_ELECTRON = 'https://npmmirror.com/mirrors/electron/'
const NPM_MIRROR_BINARIES = 'https://npmmirror.com/mirrors/electron-builder-binaries/'

function resolveOptions(mode: string, cli: CliFlags): BuildOptions {
  const shouldInstall = shouldInstallMode(mode)
  // Defaults: mirrors off (use GitHub). The user opts into a mirror via
  // --npm-mirror, env vars, or --mirror/--binaries-mirror. install.sh
  // translates --npmmirror into the env vars before invoking this script,
  // so the two paths share the same env-driven config.
  const defaults: BuildOptions = {
    clean: false,
    skipTypecheck: shouldInstall,
    skipRebuild: shouldInstall,
    // prewarm is opt-in: download-electron-cache.ts writes the Electron zip
    // to a flat path that electron-builder does not read (it uses a
    // SHA1-hashed subdirectory). ELECTRON_MIRROR alone reroutes
    // electron-builder's own download, which is the real win.
    prewarm: false,
    electronMirror: null,
    binariesMirror: null,
  }
  const opts: BuildOptions = {
    ...defaults,
    skipTypecheck:
      process.env.SKIP_TYPECHECK !== undefined ? truthy(process.env.SKIP_TYPECHECK) : defaults.skipTypecheck,
    skipRebuild: process.env.SKIP_REBUILD !== undefined ? truthy(process.env.SKIP_REBUILD) : defaults.skipRebuild,
    prewarm: process.env.PREWARM !== undefined ? truthy(process.env.PREWARM) : defaults.prewarm,
    electronMirror:
      process.env.ELECTRON_MIRROR !== undefined
        ? process.env.ELECTRON_MIRROR === ''
          ? null
          : process.env.ELECTRON_MIRROR
        : defaults.electronMirror,
    binariesMirror:
      process.env.ELECTRON_BUILDER_BINARIES_MIRROR !== undefined
        ? process.env.ELECTRON_BUILDER_BINARIES_MIRROR === ''
          ? null
          : process.env.ELECTRON_BUILDER_BINARIES_MIRROR
        : defaults.binariesMirror,
  }
  // CLI overrides; --npm-mirror is a shortcut for both env defaults.
  if (cli.clean) opts.clean = true
  if (cli['skip-typecheck']) opts.skipTypecheck = true
  if (cli['keep-typecheck']) opts.skipTypecheck = false
  if (cli['skip-rebuild']) opts.skipRebuild = true
  if (cli['keep-rebuild']) opts.skipRebuild = false
  if (cli.prewarm) opts.prewarm = true
  if (cli['no-prewarm']) opts.prewarm = false
  if (cli['npm-mirror']) {
    opts.electronMirror = NPM_MIRROR_ELECTRON
    opts.binariesMirror = NPM_MIRROR_BINARIES
  }
  return opts
}

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    clean: { type: 'boolean', default: false },
    'skip-typecheck': { type: 'boolean', default: false },
    'keep-typecheck': { type: 'boolean', default: false },
    'skip-rebuild': { type: 'boolean', default: false },
    'keep-rebuild': { type: 'boolean', default: false },
    prewarm: { type: 'boolean', default: false },
    'no-prewarm': { type: 'boolean', default: false },
    'npm-mirror': { type: 'boolean', default: false },
  },
})
const mode = positionals[0] ?? ''
const options = resolveOptions(mode, values)
const shouldInstall = shouldInstallMode(mode)
const shouldClean = options.clean

// Surface effective config on the install hot path so a slow run is easy to
// debug. `bun run build` skips this to keep normal release output tidy.
if (shouldInstall) {
  console.log(
    `Build options: skipTypecheck=${options.skipTypecheck} skipRebuild=${options.skipRebuild} prewarm=${options.prewarm} electronMirror=${options.electronMirror ?? '(none)'} binariesMirror=${options.binariesMirror ?? '(none)'}`,
  )
}

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

if (shouldClean) {
  const caches = [
    path.join(os.homedir(), 'Library/Caches/electron'),
    path.join(os.homedir(), 'Library/Caches/electron-builder'),
  ]
  for (const cacheDir of caches) {
    if (existsSync(cacheDir)) {
      rmSync(cacheDir, { recursive: true, force: true })
      console.log(`Cleaned cache: ${cacheDir}`)
    }
  }
}

// Apply mirror env vars to every subprocess so electron-builder and
// @electron/rebuild both pick them up. Set before `bun install` so postinstall
// hooks (e.g. node-pty) also use the mirror.
if (options.electronMirror) process.env.ELECTRON_MIRROR = options.electronMirror
if (options.binariesMirror) process.env.ELECTRON_BUILDER_BINARIES_MIRROR = options.binariesMirror

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
if (!options.skipTypecheck) {
  await $`bun run typecheck`
}
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
const terminalWorkerDistEntry = path.join(repoRoot, 'dist/server/terminal-worker.js')
if (!existsSync(terminalWorkerDistEntry)) {
  console.error(`Error: server build artifact missing: ${terminalWorkerDistEntry}`)
  process.exit(1)
}
// `dir` target skips dmg packaging — faster, and `install` only needs the .app.
// In install mode we also pin to the host arch so we don't waste time
// cross-building the other architecture's binaries when we're going to
// throw them away.
const archFlag = process.arch === 'arm64' ? '--arm64' : '--x64'
const builderArgs = shouldInstall ? ['--mac', 'dir', archFlag] : ['--mac']
// Skip @electron/rebuild when native prebuilds are already in place
// (bun install fetched them and build.ts chmod'd spawn-helper above). On
// macOS this saves ~4 minutes by avoiding a no-op rebuild that still
// re-verifies prebuilds over the network.
if (options.skipRebuild) builderArgs.push('--config.npmRebuild=false')

if (options.prewarm) {
  // Opt-in only. Useful as a manual warm-up before a known-offline build;
  // during normal installs ELECTRON_MIRROR alone already routes
  // electron-builder's own download through the mirror.
  const result = await $`bun scripts/download-electron-cache.ts`.nothrow()
  if (result.exitCode !== 0) {
    console.warn(
      `Warning: prewarm failed (exit ${result.exitCode}); electron-builder will fall back to its own download path.`,
    )
  }
}

if (shouldInstall) {
  await $`bun run build:electron -- ${builderArgs}`
} else {
  // Build each arch serially to avoid proper-lockfile races in dmg-builder
  // when electron-builder parallelises multiple macOS architectures.
  for (const arch of ['arm64', 'x64']) {
    await $`bun run build:electron -- --mac dmg --${arch} ${options.skipRebuild ? '--config.npmRebuild=false' : ''}`
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
