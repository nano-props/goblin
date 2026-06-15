#!/usr/bin/env bun
/**
 * Cross-platform fast-reinstall for Goblin. Replaces the old install.sh /
 * install.ps1 pair with a single TS script. Mirrors their behaviour: builds
 * the dir target only (no NSIS .exe), moves the unpacked app into the
 * per-user install path, and closes any running instance first. Defaults
 * enable the skip-rebuild + skip-typecheck fast path; --full re-enables
 * them.
 *
 * Usage:
 *   ./install.ts [options]            # POSIX (shebang-resolved `bun`)
 *   bun install.ts [options]          # cross-platform (Windows too)
 *   bun run install:app -- [options]  # via package.json
 *
 * On macOS this lands the .app in ~/Applications; on Windows the unpacked
 * dir lands in %LOCALAPPDATA%\Programs\Goblin[-arm64]. To build the NSIS
 * installer instead of the unpacked dir, run `bun run build` (no `install`
 * positional). The NSIS installer is what `scripts/publish.ts` ships to
 * GitHub releases.
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { parseArgs } from 'node:util'

// npm mirror defaults — only applied when --npmmirror is passed (or the
// matching env var is non-empty). Mirrors off by default so the user opts
// in explicitly; matches build.ts's "use GitHub unless told otherwise".
const NPM_MIRROR_ELECTRON = 'https://npmmirror.com/mirrors/electron/'
const NPM_MIRROR_BINARIES = 'https://npmmirror.com/mirrors/electron-builder-binaries/'

const repoRoot = path.resolve(import.meta.dirname)
process.chdir(repoRoot)

const USAGE = `Usage: ./install.ts [options]
   (or: bun install.ts [options] on Windows / via package.json)

Fast-reinstall Goblin into ~/Applications (mac) or
%LOCALAPPDATA%\\Programs\\Goblin[-arm64] (win). Defaults enable the
skip-rebuild + skip-typecheck fast path but do NOT touch mirrors — pass
--npmmirror (or set ELECTRON_MIRROR / ELECTRON_BUILDER_BINARIES_MIRROR) when
GitHub is unreachable. Pass --full to run the full typecheck + rebuild
pipeline.

  --clean                Clear electron / electron-builder caches before building.
  --npmmirror            Route electron + electron-builder-binaries downloads
                         through npmmirror (equivalent to setting both
                         ELECTRON_MIRROR and ELECTRON_BUILDER_BINARIES_MIRROR
                         to the npmmirror URLs).
  --mirror=URL           Electron download mirror (overrides --npmmirror).
  --binaries-mirror=URL  electron-builder-binaries mirror (overrides --npmmirror).
  --full                 Force-run typecheck + @electron/rebuild (disable the
                         skip-* fast-path defaults).
  -h, --help             Show this help.

Mirror env vars take a URL; leave unset/empty to disable:
  ELECTRON_MIRROR, ELECTRON_BUILDER_BINARIES_MIRROR
`

// parseArgs throws on unknown flags; catch and print usage so the UX
// matches the old bash switch (which printed usage + exited 2).
const options = {
  clean: { type: 'boolean' as const },
  npmmirror: { type: 'boolean' as const },
  mirror: { type: 'string' as const },
  'binaries-mirror': { type: 'string' as const },
  full: { type: 'boolean' as const },
  help: { type: 'boolean' as const, short: 'h' as const },
}
let values: ReturnType<typeof parseArgs<typeof options>>['values']
try {
  values = parseArgs({ options, strict: true }).values
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err)
  process.stderr.write(`${msg}\n\n${USAGE}`)
  process.exit(2)
}

if (values.help) {
  process.stdout.write(USAGE)
  process.exit(0)
}

// macOS only: surface a heads-up if Goblin.app is running. build.ts calls
// closeRunningApp() before replacing the .app, so this is just a notice —
// the install will close it. The caller is responsible for launching the
// fresh install: ad-hoc signed Electron apps via launchd hit a Mach guard
// abort on macOS 26.5.1+.
if (process.platform === 'darwin') {
  const proc = spawnSync('pgrep', ['-f', '/Goblin.app/Contents/MacOS/'], { stdio: 'ignore' })
  if (proc.status === 0) {
    console.log('Goblin is running; install will close it before replacing the .app.')
  }
}

// --full re-enables typecheck + @electron/rebuild. The fast path is
// already build.ts's install-mode default (skipTypecheck: shouldInstall),
// so we only need to override when the user explicitly asks for --full.
// Leaving these env vars unset in the fast path lets the env propagate as
// is (e.g. CI setting SKIP_TYPECHECK=0 stays in effect).
const env: NodeJS.ProcessEnv = { ...process.env }
if (values.full) {
  env.SKIP_TYPECHECK = '0'
  env.SKIP_REBUILD = '0'
}

// Mirrors: --npmmirror populates both with the npmmirror defaults; the more
// specific --mirror / --binaries-mirror flags override whichever side they
// name, matching the "last argument wins" order of the old bash switch.
if (values.npmmirror) {
  env.ELECTRON_MIRROR = NPM_MIRROR_ELECTRON
  env.ELECTRON_BUILDER_BINARIES_MIRROR = NPM_MIRROR_BINARIES
}
if (values.mirror?.trim()) env.ELECTRON_MIRROR = values.mirror.trim()
if (values['binaries-mirror']?.trim()) {
  env.ELECTRON_BUILDER_BINARIES_MIRROR = values['binaries-mirror'].trim()
}

// --clean is the only flag build.ts understands directly; everything else
// is consumed by this script (env vars) so it does not get forwarded.
const passthrough: string[] = []
if (values.clean) passthrough.push('--clean')

const proc = spawnSync('bun', ['scripts/build.ts', 'install', ...passthrough], {
  stdio: 'inherit',
  env,
})
process.exit(proc.status ?? 1)
