#!/usr/bin/env bun
// Build and package Goblin.
//
//   default → Goblin.app under release/mac*/ (mac) or NSIS installer
//             under release/win-unpacked/ + release/*.exe (win).
//   install → builds the unpacked dir target only and:
//             - mac: moves Goblin.app into ~/Applications, closing any
//               running instance first.
//             - win: moves the unpacked dir into %LOCALAPPDATA%\Programs
//               (the default NSIS per-user install path). The NSIS .exe
//               is *not* produced in install mode — install is the
//               "fast rebuild and put it on this machine" hot path.
//
// Usage: ./scripts/build.ts [install|i] [--clean]
import { $ } from 'bun'
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { closeRunningApp } from '#scripts/close-app.ts'

const repoRoot = path.resolve(import.meta.dirname, '..')
process.chdir(repoRoot)
$.cwd(repoRoot)

const APP_NAME = 'Goblin'
const APP_ID = 'goblin.app'

// Tunable behaviour. CLI flags win; env vars fill the gap so shell/CI can
// set them once. Install-mode defaults are tuned for a fast rebuild
// (`install.ts` is the hot path; `bun run build` keeps upstream
// behaviour).
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
  // --npm-mirror, env vars, or --mirror/--binaries-mirror. install.ts
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

interface PlatformPlan {
  /** electron-builder's --platform / target arguments for `install` mode. */
  installArgs: string[]
  /** electron-builder's --platform / target arguments for full release mode. */
  releaseArgsByArch: Record<'arm64' | 'x64', string[]>
  /** Resolver from `release/<dir>` to the unpacked-app path for this platform. */
  findBuiltApp(hostArch: 'arm64' | 'x64'): string | null
  /** Resources directory inside an unpacked application artifact. */
  resourcesDir(builtApp: string): string
  /** Where `install` mode places the unpacked app. */
  installDestination(hostArch: 'arm64' | 'x64'): string
  /** What install mode does after copying — signing, registry registration, etc. */
  postInstall(destPath: string): Promise<void>
  /** Pre-build native-prebuild sanity check. */
  verifyPrebuilds(hostArch: 'arm64' | 'x64'): void
  /** Cache directories cleaned by --clean. */
  cacheDirs(): string[]
}

function planDarwin(): PlatformPlan {
  return {
    // `dir` target skips dmg packaging — faster, and `install` only needs
    // the .app.
    installArgs: ['--mac', 'dir', process.arch === 'arm64' ? '--arm64' : '--x64'],
    releaseArgsByArch: {
      arm64: ['--mac', 'dmg', '--arm64'],
      x64: ['--mac', 'dmg', '--x64'],
    },
    findBuiltApp(hostArch) {
      // mac dir target emits one directory per declared arch
      // (`mac-arm64`, `mac` for x64). Pick the one matching the host so
      // `install` puts the right binary in ~/Applications.
      const hostDir = hostArch === 'arm64' ? 'mac-arm64' : 'mac'
      const candidate = path.join(repoRoot, 'release', hostDir, `${APP_NAME}.app`)
      return existsSync(candidate) ? candidate : null
    },
    resourcesDir(builtApp) {
      return path.join(builtApp, 'Contents', 'Resources')
    },
    installDestination() {
      const appsDir = path.join(os.homedir(), 'Applications')
      mkdirSync(appsDir, { recursive: true })
      return path.join(appsDir, `${APP_NAME}.app`)
    },
    async postInstall(destPath) {
      // electron-builder's ad-hoc signature (identity: null) uses the
      // Electron binary identifier and does not bind Info.plist. macOS
      // Notification Center identifies apps by the code-signing
      // identifier, not CFBundleIdentifier, so without re-signing the
      // app appears as "Electron" in notification settings and the
      // NSUserNotificationAlertStyle plist key has no effect.
      // Re-signing with --identifier forces the correct bundle ID and
      // binds the Info.plist so notifications work and Goblin appears
      // in System Settings.
      console.log('Re-signing with correct bundle identifier...')
      await $`codesign --force --deep --sign - --identifier ${APP_ID} ${destPath}`
      console.log('Re-signed.')

      // electron-builder 26.15.2 embeds a SHA-256 hash of app.asar in
      // Info.plist under ElectronAsarIntegrity, but the hash it writes
      // disagrees with what `shasum -a 256` actually produces for the
      // file on disk. Electron validates this hash at startup — on
      // mismatch the app exits silently (exit 0, no window, no crash
      // report). Fix the hash after the build so the app can start.
      const asarPath = path.join(destPath, 'Contents', 'Resources', 'app.asar')
      const asarHash = createHash('sha256').update(readFileSync(asarPath)).digest('hex')
      const integrityJson = JSON.stringify({
        [`Resources/app.asar`]: { algorithm: 'SHA256', hash: asarHash },
      })
      const plistPath = path.join(destPath, 'Contents', 'Info.plist')
      console.log('Fixing ElectronAsarIntegrity hash in Info.plist...')
      await $`plutil -replace ElectronAsarIntegrity -json ${integrityJson} ${plistPath}`
      await $`codesign --force --deep --sign - --identifier ${APP_ID} ${destPath}`
      console.log('Hash fixed and re-signed.')
    },
    verifyPrebuilds(hostArch) {
      // node-pty ships `spawn-helper` as a separate executable on macOS
      // that Electron forks; if it's missing or non-executable, every
      // terminal spawn fails at runtime. Verify here so a fresh checkout
      // without `bun install` artifacts fails fast instead of producing
      // a .app that crashes on first terminal use.
      const arches = shouldInstall ? [hostArch] : (['arm64', 'x64'] as const)
      const helpers = arches.map((arch) =>
        path.join(repoRoot, 'node_modules/node-pty/prebuilds', `darwin-${arch}`, 'spawn-helper'),
      )
      const missing = helpers.filter((helper) => !existsSync(helper))
      if (missing.length > 0) {
        console.error(`Error: missing node-pty darwin spawn-helper(s): ${missing.join(', ')}`)
        process.exit(1)
      }
      for (const helper of helpers) chmodSync(helper, 0o755)
    },
    cacheDirs() {
      return [
        path.join(os.homedir(), 'Library/Caches/electron'),
        path.join(os.homedir(), 'Library/Caches/electron-builder'),
      ]
    },
  }
}

function planWindows(): PlatformPlan {
  return {
    // `dir` target skips the NSIS .exe build — faster, and `install` only
    // needs the unpacked directory.
    installArgs: ['--win', 'dir', process.arch === 'arm64' ? '--arm64' : '--x64'],
    releaseArgsByArch: {
      arm64: ['--win', 'nsis', '--arm64'],
      x64: ['--win', 'nsis', '--x64'],
    },
    findBuiltApp(hostArch) {
      // win dir target emits `win-unpacked/` containing Goblin.exe and
      // the unpacked asar.
      const hostDir = hostArch === 'arm64' ? 'win-arm64-unpacked' : 'win-unpacked'
      const candidate = path.join(repoRoot, 'release', hostDir)
      return existsSync(candidate) ? candidate : null
    },
    resourcesDir(builtApp) {
      return path.join(builtApp, 'resources')
    },
    installDestination(hostArch) {
      // Default NSIS per-user install path. Matches what the NSIS
      // installer would produce if the user ran the .exe with default
      // options, so swapping install mode for the installer is seamless.
      const localAppData = process.env.LOCALAPPDATA?.trim() || path.join(os.homedir(), 'AppData', 'Local')
      const hostDir = hostArch === 'arm64' ? 'Goblin-arm64' : 'Goblin'
      return path.join(localAppData, 'Programs', hostDir)
    },
    async postInstall() {
      // No signing configured for Windows yet — the unsigned installer
      // builds rely on the user explicitly trusting the binary. Signing
      // can be added here once a code-signing certificate is wired up.
    },
    verifyPrebuilds(hostArch) {
      // On Windows the native binding lives in `pty.node` (conpty.node
      // and the rest of the conpty.dll sibling files are also required).
      // electron-builder's `asarUnpack` glob handles this at packaging
      // time; here we just confirm the per-arch prebuild directory
      // shipped something node-pty can load.
      const arches = shouldInstall ? [hostArch] : (['arm64', 'x64'] as const)
      for (const arch of arches) {
        const prebuildDir = path.join(repoRoot, 'node_modules', 'node-pty', 'prebuilds', `win32-${arch}`)
        const binding = path.join(prebuildDir, 'pty.node')
        if (!existsSync(binding)) {
          console.error(`Error: missing node-pty Windows prebuild: ${binding}`)
          process.exit(1)
        }
      }
    },
    cacheDirs() {
      // electron-builder / @electron/get cache Electron downloads under
      // %LOCALAPPDATA%\electron-builder\Cache on Windows.
      const localAppData = process.env.LOCALAPPDATA?.trim() || path.join(os.homedir(), 'AppData', 'Local')
      return [path.join(localAppData, 'electron-builder', 'Cache'), path.join(localAppData, 'electron', 'Cache')]
    },
  }
}

function pickPlan(): PlatformPlan {
  if (process.platform === 'darwin') return planDarwin()
  if (process.platform === 'win32') return planWindows()
  console.error(
    `Error: Goblin's build script does not yet support ${process.platform}. ` +
      `Run on macOS for the .dmg/.app or on Windows for the NSIS installer.`,
  )
  process.exit(1)
}

const plan = pickPlan()

// Clear any prior build output so the findBuiltApp resolver can't pick
// up a stale artifact if electron-builder fails partway through. A
// matching rm after a successful install is run below.
rmSync(path.join(repoRoot, 'release'), { recursive: true, force: true })

if (shouldClean) {
  for (const cacheDir of plan.cacheDirs()) {
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

plan.verifyPrebuilds(process.arch === 'arm64' ? 'arm64' : 'x64')

if (!options.skipTypecheck) {
  await $`bun run typecheck`
}
// Client bundle MUST exist before electron-builder packs it (the
// `files` glob in electron-builder.ts expects `dist/web/`).
await $`bun run build:web`
await $`bun run build:preload`
await $`bun run build:server`
const webDist = path.join(repoRoot, 'dist/web')
for (const artifact of [path.join(webDist, 'index.html'), path.join(webDist, 'boot.js')]) {
  if (!existsSync(artifact)) {
    console.error(`Error: web build artifact missing: ${artifact}`)
    process.exit(1)
  }
}
const preloadManifest = path.join(repoRoot, 'dist/preload/manifest.json')
if (!existsSync(preloadManifest)) {
  console.error(`Error: preload build artifact missing: ${preloadManifest}`)
  process.exit(1)
}
const serverDistEntry = path.join(repoRoot, 'dist/server/main.js')
if (!existsSync(serverDistEntry)) {
  console.error(`Error: server build artifact missing: ${serverDistEntry}`)
  process.exit(1)
}
const ptyWorkerDistEntry = path.join(repoRoot, 'dist/server/pty-worker.js')
if (!existsSync(ptyWorkerDistEntry)) {
  console.error(`Error: PTY worker build artifact missing: ${ptyWorkerDistEntry}`)
  process.exit(1)
}
const gCommandDistEntry = path.join(repoRoot, 'dist/server/g-command.js')
if (!existsSync(gCommandDistEntry)) {
  console.error(`Error: g command build artifact missing: ${gCommandDistEntry}`)
  process.exit(1)
}

// Skip @electron/rebuild when native prebuilds are already in place
// (bun install fetched them and the plan verified them above). Saves a
// few minutes by avoiding a no-op rebuild that still re-verifies
// prebuilds over the network.
function appendRebuildFlag(args: string[]): string[] {
  return options.skipRebuild ? [...args, '--config.npmRebuild=false'] : args
}

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
  await $`bun run build:electron -- ${appendRebuildFlag(plan.installArgs)}`
} else if (process.platform === 'darwin') {
  // Build each arch serially to avoid proper-lockfile races in dmg-builder
  // when electron-builder parallelises multiple macOS architectures.
  for (const arch of ['arm64', 'x64'] as const) {
    await $`bun run build:electron -- ${appendRebuildFlag(plan.releaseArgsByArch[arch])}`
  }
} else {
  // Windows: NSIS for each arch. electron-builder doesn't run multiple
  // Windows targets in parallel, but for safety we still go serially.
  for (const arch of ['arm64', 'x64'] as const) {
    await $`bun run build:electron -- ${appendRebuildFlag(plan.releaseArgsByArch[arch])}`
  }
}

const hostArch: 'arm64' | 'x64' = process.arch === 'arm64' ? 'arm64' : 'x64'
const builtArches = shouldInstall ? [hostArch] : (['arm64', 'x64'] as const)
const builtApps = builtArches.map((arch) => {
  const app = plan.findBuiltApp(arch)
  if (!app) {
    console.error(`Error: could not find built ${APP_NAME} ${arch} app under release/`)
    process.exit(1)
  }
  verifyPackagedServerRuntime(plan.resourcesDir(app), arch)
  return { arch, app }
})
const srcApp = builtApps.find(({ arch }) => arch === hostArch)?.app
if (!srcApp) {
  console.error(`Error: could not select built ${APP_NAME} ${hostArch} app`)
  process.exit(1)
}
console.log(`Built: ${path.relative(repoRoot, srcApp)}`)

if (shouldInstall) {
  // Close any running instance before replacing it. close-app.ts is
  // a no-op on non-darwin, so this is effectively mac-only today, but
  // we still call it unconditionally for symmetry.
  await closeRunningApp()

  const destApp = plan.installDestination(hostArch)
  rmSync(destApp, { recursive: true, force: true })
  renameSync(srcApp, destApp)
  console.log(`Installed: ${destApp}`)

  await plan.postInstall(destApp)

  rmSync(path.join(repoRoot, 'release'), { recursive: true, force: true })
  console.log('Done.')
}

function verifyPackagedServerRuntime(resourcesDir: string, arch: 'arm64' | 'x64'): void {
  const unpackedRoot = path.join(resourcesDir, 'app.asar.unpacked')
  const platformPrebuild = process.platform === 'darwin' ? `darwin-${arch}` : `win32-${arch}`
  const requiredArtifacts = [
    'dist/server/main.js',
    'dist/server/pty-worker.js',
    'dist/server/g-command.js',
    'dist/web/index.html',
    'dist/web/boot.js',
    'node_modules/node-pty/package.json',
    'node_modules/node-pty/lib/index.js',
    `node_modules/node-pty/prebuilds/${platformPrebuild}/pty.node`,
    ...(process.platform === 'darwin' ? [`node_modules/node-pty/prebuilds/${platformPrebuild}/spawn-helper`] : []),
  ]
  const missing = requiredArtifacts.filter((artifact) => !existsSync(path.join(unpackedRoot, artifact)))
  if (missing.length > 0) {
    console.error(`Error: packaged server runtime is incomplete: ${missing.join(', ')}`)
    process.exit(1)
  }
}
