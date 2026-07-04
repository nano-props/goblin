import { chmodSync, statSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

interface EnsureNodePtySpawnHelperExecutableOptions {
  platform?: NodeJS.Platform
  arch?: NodeJS.Architecture
  resolveNodePtyEntry?: () => string
  stat?: typeof statSync
  chmod?: typeof chmodSync
}

const require = createRequire(import.meta.url)
let nodePtySpawnHelperExecutableChecked = false

export function ensureNodePtyDarwinSpawnHelperExecutable(): void {
  if (nodePtySpawnHelperExecutableChecked) return
  nodePtySpawnHelperExecutableChecked = true
  ensureNodePtyDarwinSpawnHelperExecutableWithOptions()
}

export function resetNodePtyDarwinSpawnHelperExecutableCheckForTests(): void {
  nodePtySpawnHelperExecutableChecked = false
}

export function ensureNodePtyDarwinSpawnHelperExecutableWithOptions(
  options: EnsureNodePtySpawnHelperExecutableOptions = {},
): void {
  const platform = options.platform ?? process.platform
  if (platform !== 'darwin') return

  const helperPath = resolveNodePtyDarwinSpawnHelperPath({
    arch: options.arch ?? process.arch,
    resolveNodePtyEntry: options.resolveNodePtyEntry,
  })
  const stat = options.stat ?? statSync
  const chmod = options.chmod ?? chmodSync

  try {
    const helperStat = stat(helperPath)
    if ((helperStat.mode & 0o111) === 0o111) return
    chmod(helperPath, 0o755)
  } catch {
    // Let node-pty surface the real spawn failure. This repair path is a
    // best-effort guard for package managers that unpack spawn-helper without
    // executable bits.
  }
}

function resolveNodePtyDarwinSpawnHelperPath(input: {
  arch: NodeJS.Architecture
  resolveNodePtyEntry?: () => string
}): string {
  const nodePtyEntry = input.resolveNodePtyEntry?.() ?? require.resolve('node-pty')
  const packageRoot = path.resolve(path.dirname(nodePtyEntry), '..')
  return path.join(packageRoot, 'prebuilds', `darwin-${input.arch}`, 'spawn-helper')
}
