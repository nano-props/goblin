import { chmodSync, statSync } from 'node:fs'
import path from 'node:path'

interface NodePtyDarwinRuntimeOptions {
  packageRoot: string
  platform?: NodeJS.Platform
  arch?: NodeJS.Architecture
  stat?: typeof statSync
  chmod?: typeof chmodSync
}

export function prepareNodePtyDarwinRuntime(options: NodePtyDarwinRuntimeOptions): void {
  if ((options.platform ?? process.platform) !== 'darwin') return
  const helperPath = nodePtyDarwinSpawnHelperPath(options)
  const helperStat = (options.stat ?? statSync)(helperPath)
  if ((helperStat.mode & 0o111) === 0o111) return
  const chmod = options.chmod ?? chmodSync
  chmod(helperPath, 0o755)
}

export function validateNodePtyDarwinRuntime(options: NodePtyDarwinRuntimeOptions): void {
  if ((options.platform ?? process.platform) !== 'darwin') return
  const helperPath = nodePtyDarwinSpawnHelperPath(options)
  const helperStat = (options.stat ?? statSync)(helperPath)
  if ((helperStat.mode & 0o111) !== 0o111) {
    throw new Error(`node-pty spawn-helper is not executable: ${helperPath}`)
  }
}

function nodePtyDarwinSpawnHelperPath(options: NodePtyDarwinRuntimeOptions): string {
  return path.join(options.packageRoot, 'prebuilds', `darwin-${options.arch ?? process.arch}`, 'spawn-helper')
}
