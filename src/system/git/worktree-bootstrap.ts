import path from 'node:path'
import { constants as fsConstants, promises as fs } from 'node:fs'
import { execa, ExecaError } from 'execa'
import { glob, isDynamicPattern } from 'tinyglobby'
import { getRepoRoot } from '#/system/git/branches.ts'
import { hasErrorCode } from '#/shared/error-code.ts'
import {
  compactWorktreeBootstrapPaths,
  formatWorktreeBootstrapSummary,
  hasWorktreeBootstrapSummaryDetails,
  worktreeBootstrapPreviewFromConfig,
  type WorktreeBootstrapResult,
  type WorktreeBootstrapSummary,
  type WorktreeBootstrapPreviewResult,
} from '#/shared/worktree-bootstrap-summary.ts'
import {
  WORKTREE_BOOTSTRAP_CONFIG_FILE,
  parseBootstrapConfig,
  worktreeBootstrapConfigHash,
  type WorktreeBootstrapConfig,
} from '#/system/git/worktree-bootstrap-config.ts'
import { copyPath, DestinationPermissionRestoreError } from '#/system/filesystem-copy.ts'

type MaterializationMode = 'copy' | 'symlink' | 'hardlink'
const MATERIALIZATION_MODES: readonly MaterializationMode[] = ['copy', 'symlink', 'hardlink']

export async function getWorktreeBootstrapPreview(
  sourceCwd: string,
  options?: { signal?: AbortSignal },
): Promise<WorktreeBootstrapPreviewResult> {
  try {
    if (options?.signal?.aborted) return { ok: false, message: 'cancelled' }
    const sourceRepoRoot = await getRepoRoot(sourceCwd, { signal: options?.signal })
    if (!sourceRepoRoot) return { ok: false, message: 'failed to resolve source repo root' }

    const loaded = await loadBootstrapConfig(path.resolve(sourceRepoRoot))
    if (loaded.kind === 'none') return { ok: true, preview: worktreeBootstrapPreviewFromConfig(undefined) }
    if (loaded.kind === 'error') return { ok: false, message: loaded.message }

    return { ok: true, preview: worktreeBootstrapPreviewFromConfig(loaded.config, loaded.configHash) }
  } catch (err) {
    if (options?.signal?.aborted) return { ok: false, message: 'cancelled' }
    return { ok: false, message: errorMessage(err) }
  }
}

interface ConcreteSource {
  rel: string
  abs: string
}

interface PlannedMaterialization extends ConcreteSource {
  mode: MaterializationMode
}

interface ReadyMaterialization extends PlannedMaterialization {
  dest: string
  stat: Awaited<ReturnType<typeof fs.lstat>>
}

type MaterializationResult =
  | { ok: true; completedOperations: ReadyMaterialization[] }
  | { ok: false; message: string; completedOperations: ReadyMaterialization[] }

const SETUP_TIMEOUT_MS = 10 * 60_000

export async function bootstrapWorktreeAfterCreate(
  sourceCwd: string,
  targetWorktreePath: string,
  options?: { signal?: AbortSignal; expectedConfigHash?: string },
): Promise<WorktreeBootstrapResult> {
  try {
    if (options?.signal?.aborted) return { ok: false, message: 'cancelled' }
    const sourceRepoRoot = await getRepoRoot(sourceCwd, { signal: options?.signal })
    if (!sourceRepoRoot) return bootstrapFailure('failed to resolve source repo root')

    const sourceRoot = path.resolve(sourceRepoRoot)
    const targetRoot = path.resolve(targetWorktreePath)
    const loaded = await loadBootstrapConfig(sourceRoot)
    if (loaded.kind === 'none') {
      if (options?.expectedConfigHash)
        return bootstrapFailure(`${WORKTREE_BOOTSTRAP_CONFIG_FILE} changed after confirmation`)
      return { ok: true, message: '' }
    }
    if (loaded.kind === 'error') return bootstrapFailure(loaded.message)
    if (options?.expectedConfigHash && loaded.configHash !== options.expectedConfigHash) {
      return bootstrapFailure(`${WORKTREE_BOOTSTRAP_CONFIG_FILE} changed after confirmation`)
    }

    const planned = await planMaterializations(sourceRoot, targetRoot, loaded.config, options?.signal)
    if (!planned.ok) return bootstrapStepFailure(planned)

    const materialized = await materializePlan(
      sourceRoot,
      targetRoot,
      planned.operations,
      planned.excludedPaths,
      options?.signal,
    )
    if (!materialized.ok) {
      const summary = bootstrapSummary(materialized.completedOperations, planned.missingSources, undefined)
      return bootstrapStepFailure(materialized, summary)
    }

    if (loaded.config.setup) {
      const setup = await runSetupCommand(targetRoot, loaded.config.setup, options?.signal)
      if (!setup.ok) {
        const summary = bootstrapSummary(materialized.completedOperations, planned.missingSources, undefined)
        return bootstrapStepFailure(setup, summary)
      }
    }

    const summary = bootstrapSummary(materialized.completedOperations, planned.missingSources, loaded.config.setup)
    return {
      ok: true,
      message: formatWorktreeBootstrapSummary(summary),
      ...(hasWorktreeBootstrapSummaryDetails(summary) ? { worktreeBootstrap: summary } : {}),
    }
  } catch (err) {
    if (options?.signal?.aborted) return { ok: false, message: 'cancelled' }
    return bootstrapFailure(errorMessage(err))
  }
}

async function loadBootstrapConfig(
  sourceRoot: string,
): Promise<
  | { kind: 'none' }
  | { kind: 'ready'; config: WorktreeBootstrapConfig; configHash: string }
  | { kind: 'error'; message: string }
> {
  let raw = ''
  try {
    raw = await fs.readFile(path.join(sourceRoot, WORKTREE_BOOTSTRAP_CONFIG_FILE), 'utf8')
  } catch (err) {
    if (hasErrorCode(err, 'ENOENT')) return { kind: 'none' }
    return { kind: 'error', message: `failed to read ${WORKTREE_BOOTSTRAP_CONFIG_FILE}: ${errorMessage(err)}` }
  }
  const loaded = parseBootstrapConfig(raw)
  return loaded.kind === 'ready' ? { ...loaded, configHash: worktreeBootstrapConfigHash(raw) } : loaded
}

async function planMaterializations(
  sourceRoot: string,
  targetRoot: string,
  config: WorktreeBootstrapConfig,
  signal: AbortSignal | undefined,
): Promise<
  | { ok: true; operations: ReadyMaterialization[]; missingSources: string[]; excludedPaths: Set<string> }
  | { ok: false; message: string }
> {
  const missingSources = new Set<string>()
  const expanded = {
    copy: new Map<string, ConcreteSource>(),
    symlink: new Map<string, ConcreteSource>(),
    hardlink: new Map<string, ConcreteSource>(),
  } satisfies Record<MaterializationMode, Map<string, ConcreteSource>>

  for (const mode of MATERIALIZATION_MODES) {
    const result = await expandSources(sourceRoot, config[mode], signal)
    if (!result.ok) return result
    for (const missing of result.missingSources) missingSources.add(missing)
    for (const source of result.sources) expanded[mode].set(source.rel, source)
  }

  const excludes = await expandExcludes(sourceRoot, config.exclude, signal)
  if (!excludes.ok) return excludes
  for (const mode of MATERIALIZATION_MODES) {
    for (const rel of expanded[mode].keys()) {
      if (isExcludedPath(rel, excludes.paths)) expanded[mode].delete(rel)
    }
  }

  const ambiguous = findAmbiguousSource(expanded)
  if (ambiguous) return { ok: false, message: `path matches multiple materialization modes: ${ambiguous}` }

  const planned: PlannedMaterialization[] = []
  for (const mode of MATERIALIZATION_MODES) {
    for (const source of expanded[mode].values()) planned.push({ ...source, mode })
  }

  const ready = await validateMaterializations(sourceRoot, targetRoot, planned, missingSources, signal)
  if (!ready.ok) return ready

  const nested = findNestedDestinationConflict(ready.operations)
  if (nested) return { ok: false, message: `materialization paths overlap: ${nested}` }

  return {
    ok: true,
    operations: ready.operations,
    missingSources: Array.from(missingSources),
    excludedPaths: excludes.paths,
  }
}

async function expandSources(
  sourceRoot: string,
  entries: string[],
  signal: AbortSignal | undefined,
): Promise<{ ok: true; sources: ConcreteSource[]; missingSources: string[] } | { ok: false; message: string }> {
  const sources = new Map<string, ConcreteSource>()
  const missingSources = new Set<string>()

  for (const entry of entries) {
    if (signal?.aborted) return { ok: false, message: 'cancelled' }
    if (!isDynamicPattern(entry)) {
      const source = resolveConfigPath(sourceRoot, normalizeRelativePath(entry))
      if (!source.ok) return source
      if (!(await pathExists(source.abs))) {
        missingSources.add(source.rel)
        continue
      }
      sources.set(source.rel, source)
      continue
    }

    const matches = await glob(entry, globOptions(sourceRoot, signal))
    for (const match of matches) {
      const source = resolveConfigPath(sourceRoot, normalizeRelativePath(match))
      if (!source.ok) return source
      sources.set(source.rel, source)
    }
  }

  return { ok: true, sources: Array.from(sources.values()), missingSources: Array.from(missingSources) }
}

async function expandExcludes(
  sourceRoot: string,
  entries: string[],
  signal: AbortSignal | undefined,
): Promise<{ ok: true; paths: Set<string> } | { ok: false; message: string }> {
  const paths = new Set<string>()
  for (const entry of entries) {
    if (signal?.aborted) return { ok: false, message: 'cancelled' }
    if (!isDynamicPattern(entry)) {
      const source = resolveConfigPath(sourceRoot, normalizeRelativePath(entry))
      if (!source.ok) return source
      if (await pathExists(source.abs)) paths.add(source.rel)
      continue
    }

    const matches = await glob(entry, globOptions(sourceRoot, signal))
    for (const match of matches) {
      const source = resolveConfigPath(sourceRoot, normalizeRelativePath(match))
      if (!source.ok) return source
      paths.add(source.rel)
    }
  }
  return { ok: true, paths }
}

async function validateMaterializations(
  sourceRoot: string,
  targetRoot: string,
  planned: PlannedMaterialization[],
  missingSources: Set<string>,
  signal: AbortSignal | undefined,
): Promise<{ ok: true; operations: ReadyMaterialization[] } | { ok: false; message: string }> {
  const operations: ReadyMaterialization[] = []
  let sourceRootReal = sourceRoot
  try {
    sourceRootReal = await fs.realpath(sourceRoot)
  } catch (err) {
    return { ok: false, message: `failed to inspect source repo root: ${errorMessage(err)}` }
  }
  for (const item of planned) {
    if (signal?.aborted) return { ok: false, message: 'cancelled' }

    let stat: Awaited<ReturnType<typeof fs.lstat>>
    try {
      stat = await fs.lstat(item.abs)
    } catch (err) {
      if (hasErrorCode(err, 'ENOENT')) {
        missingSources.add(item.rel)
        continue
      }
      return { ok: false, message: `failed to inspect ${item.rel}: ${errorMessage(err)}` }
    }

    if (item.mode === 'hardlink' && !stat.isFile()) {
      return { ok: false, message: `hardlink source is not a file: ${item.rel}` }
    }

    const safeSource = await validateSourcePathWithinRoot(sourceRoot, sourceRootReal, item.rel, item.abs, stat)
    if (!safeSource.ok) return safeSource

    const destination = resolveDestinationPath(targetRoot, item.rel)
    if (!destination.ok) return destination
    const safeDestination = await validateDestinationPathWithinRoot(targetRoot, item.rel)
    if (!safeDestination.ok) return safeDestination
    if (await pathExists(destination.abs, { useLstat: true })) {
      return { ok: false, message: `destination already exists: ${item.rel}` }
    }

    const source = resolveConfigPath(sourceRoot, item.rel)
    if (!source.ok) return source
    operations.push({ ...item, abs: source.abs, dest: destination.abs, stat })
  }
  return { ok: true, operations }
}

async function validateDestinationPathWithinRoot(
  targetRoot: string,
  rel: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const symlinkAncestor = await firstSymlinkAncestor(targetRoot, rel)
  if (symlinkAncestor) {
    return { ok: false, message: `bootstrap target path uses symlink parent: ${symlinkAncestor}` }
  }
  return { ok: true }
}

async function validateSourcePathWithinRoot(
  sourceRoot: string,
  sourceRootReal: string,
  rel: string,
  abs: string,
  stat: Awaited<ReturnType<typeof fs.lstat>>,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const symlinkAncestor = await firstSymlinkAncestor(sourceRoot, rel)
  if (symlinkAncestor) {
    return { ok: false, message: `bootstrap path uses symlink parent: ${symlinkAncestor}` }
  }
  if (stat.isSymbolicLink()) return { ok: true }

  let sourceReal = ''
  try {
    sourceReal = await fs.realpath(abs)
  } catch (err) {
    return { ok: false, message: `failed to inspect ${rel}: ${errorMessage(err)}` }
  }
  if (!isWithinRoot(sourceRootReal, sourceReal))
    return { ok: false, message: `bootstrap path escapes repo root: ${rel}` }
  return { ok: true }
}

async function firstSymlinkAncestor(sourceRoot: string, rel: string): Promise<string | null> {
  const segments = rel.split('/').filter(Boolean)
  let current = sourceRoot
  for (let index = 0; index < segments.length - 1; index += 1) {
    current = path.join(current, segments[index]!)
    try {
      const stat = await fs.lstat(current)
      if (stat.isSymbolicLink()) return segments.slice(0, index + 1).join('/')
    } catch (err) {
      if (hasErrorCode(err, 'ENOENT')) return null
      throw err
    }
  }
  return null
}

async function materializePlan(
  sourceRoot: string,
  targetRoot: string,
  operations: ReadyMaterialization[],
  excludedPaths: Set<string>,
  signal: AbortSignal | undefined,
): Promise<MaterializationResult> {
  const completedOperations: ReadyMaterialization[] = []
  for (const item of operations) {
    if (signal?.aborted) return { ok: false, message: 'cancelled', completedOperations }
    try {
      const safeDestination = await validateDestinationPathWithinRoot(targetRoot, item.rel)
      if (!safeDestination.ok) return { ...safeDestination, completedOperations }
      await fs.mkdir(path.dirname(item.dest), { recursive: true })
      switch (item.mode) {
        case 'copy':
          await copyPath(item.abs, item.dest, {
            signal,
            include: (sourcePath) => shouldCopyPath(sourceRoot, sourcePath, excludedPaths),
          })
          break
        case 'symlink':
          await fs.symlink(item.abs, item.dest, symlinkType(item.stat))
          break
        case 'hardlink':
          await fs.link(item.abs, item.dest)
          break
      }
      // Summaries report completed configured operations, not every path that
      // happened to land inside a failed directory copy. Listing a partial
      // directory as copied would turn an uncertain follow-up into false success.
      completedOperations.push(item)
    } catch (err) {
      if (signal?.aborted && !(err instanceof DestinationPermissionRestoreError)) {
        return { ok: false, message: 'cancelled', completedOperations }
      }
      if (hasErrorCode(err, 'EEXIST')) {
        return { ok: false, message: `destination already exists: ${item.rel}`, completedOperations }
      }
      return { ok: false, message: `failed to ${item.mode} ${item.rel}: ${errorMessage(err)}`, completedOperations }
    }
  }
  return { ok: true, completedOperations }
}

async function runSetupCommand(
  targetRoot: string,
  setup: string,
  signal: AbortSignal | undefined,
): Promise<WorktreeBootstrapResult> {
  if (signal?.aborted) return { ok: false, message: 'cancelled' }
  try {
    await fs.access(targetRoot, fsConstants.R_OK | fsConstants.W_OK)
    const invocation = buildSetupInvocation(setup)
    const result = await execa(invocation.command, invocation.args, {
      cwd: targetRoot,
      timeout: SETUP_TIMEOUT_MS,
      cancelSignal: signal,
      forceKillAfterDelay: 500,
      maxBuffer: 10 * 1024 * 1024,
    })
    return { ok: true, message: result.stdout.trim() }
  } catch (err) {
    if (err instanceof ExecaError) {
      if (signal?.aborted || err.isCanceled) return { ok: false, message: 'cancelled' }
      if (err.timedOut) return { ok: false, message: `setup timed out after ${SETUP_TIMEOUT_MS / 1000}s` }
      const output = [String(err.stderr ?? '').trim(), String(err.stdout ?? '').trim()].filter(Boolean)
      return { ok: false, message: output.join('\n').trim() || err.message || 'setup failed' }
    }
    return { ok: false, message: errorMessage(err) }
  }
}

function buildSetupInvocation(setup: string): { command: string; args: string[] } {
  const shell = process.env.SHELL?.trim()
  // An interactive login shell loads the user's normal terminal environment
  // (e.g. ~/.zshrc / ~/.bashrc as well as ~/.zprofile / ~/.bash_profile),
  // so tools like bun, nvm, and pnpm resolve without absolute paths.
  if (shell) return { command: shell, args: ['-il', '-c', setup] }
  return { command: '/bin/sh', args: ['-c', setup] }
}

function resolveConfigPath(
  sourceRoot: string,
  rel: string,
): { ok: true; rel: string; abs: string } | { ok: false; message: string } {
  if (hasGitSegment(rel)) return { ok: false, message: `bootstrap path must not target .git: ${rel}` }
  const abs = path.resolve(sourceRoot, rel)
  if (!isWithinRoot(sourceRoot, abs)) return { ok: false, message: `bootstrap path escapes repo root: ${rel}` }
  return { ok: true, rel, abs }
}

function resolveDestinationPath(
  targetRoot: string,
  rel: string,
): { ok: true; abs: string } | { ok: false; message: string } {
  if (hasGitSegment(rel)) return { ok: false, message: `bootstrap path must not target .git: ${rel}` }
  const abs = path.resolve(targetRoot, rel)
  if (!isWithinRoot(targetRoot, abs)) return { ok: false, message: `bootstrap path escapes target worktree: ${rel}` }
  return { ok: true, abs }
}

function normalizeRelativePath(value: string): string {
  const normalized = path.posix.normalize(value.replace(/\\/g, '/').replace(/\/+$/, ''))
  return normalized === '' ? '.' : normalized
}

function hasGitSegment(rel: string): boolean {
  return rel.split('/').includes('.git')
}

function isWithinRoot(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

function globOptions(sourceRoot: string, signal: AbortSignal | undefined) {
  return {
    cwd: sourceRoot,
    absolute: false,
    onlyFiles: false,
    dot: true,
    expandDirectories: false,
    followSymbolicLinks: false,
    ignore: ['.git', '.git/**', '**/.git', '**/.git/**'],
    signal,
  }
}

function findAmbiguousSource(expanded: Record<MaterializationMode, Map<string, ConcreteSource>>): string | null {
  const firstModeByPath = new Map<string, MaterializationMode>()
  for (const mode of MATERIALIZATION_MODES) {
    for (const rel of expanded[mode].keys()) {
      const existing = firstModeByPath.get(rel)
      if (existing && existing !== mode) return rel
      firstModeByPath.set(rel, mode)
    }
  }
  return null
}

function findNestedDestinationConflict(operations: ReadyMaterialization[]): string | null {
  const rels = operations.map((item) => item.rel).sort((a, b) => a.length - b.length)
  for (let i = 0; i < rels.length; i += 1) {
    const parent = rels[i]!
    for (let j = i + 1; j < rels.length; j += 1) {
      const child = rels[j]!
      if (child.startsWith(`${parent}/`)) return `${parent} contains ${child}`
    }
  }
  return null
}

function shouldCopyPath(sourceRoot: string, sourcePath: string, excludedPaths: Set<string>): boolean {
  const rel = normalizeRelativePath(path.relative(sourceRoot, sourcePath))
  if (hasGitSegment(rel)) return false
  return !isExcludedPath(rel, excludedPaths)
}

function isExcludedPath(rel: string, excludedPaths: Set<string>): boolean {
  if (excludedPaths.has(rel)) return true
  for (const excluded of excludedPaths) {
    if (rel.startsWith(`${excluded}/`)) return true
  }
  return false
}

function symlinkType(stat: Awaited<ReturnType<typeof fs.lstat>>): 'file' | 'dir' | 'junction' {
  if (!stat.isDirectory()) return 'file'
  return process.platform === 'win32' ? 'junction' : 'dir'
}

async function pathExists(target: string, options?: { useLstat?: boolean }): Promise<boolean> {
  try {
    if (options?.useLstat) await fs.lstat(target)
    else await fs.access(target, fsConstants.F_OK)
    return true
  } catch (err) {
    if (hasErrorCode(err, 'ENOENT')) return false
    throw err
  }
}

function bootstrapSummary(
  operations: ReadyMaterialization[],
  missingSources: string[],
  setupCommand: string | undefined,
): WorktreeBootstrapSummary {
  return {
    copy: compactWorktreeBootstrapPaths(pathsForMode(operations, 'copy')),
    symlink: compactWorktreeBootstrapPaths(pathsForMode(operations, 'symlink')),
    hardlink: compactWorktreeBootstrapPaths(pathsForMode(operations, 'hardlink')),
    skippedMissing: compactWorktreeBootstrapPaths(missingSources),
    ...(setupCommand ? { setup: { command: setupCommand } } : {}),
  }
}

function bootstrapFailure(message: string): WorktreeBootstrapResult {
  return { ok: false, message: `Worktree bootstrap failed: ${message}` }
}

function bootstrapStepFailure(
  result: WorktreeBootstrapResult,
  summary?: WorktreeBootstrapSummary,
): WorktreeBootstrapResult {
  if (result.ok) return result
  const failure = result.message === 'cancelled' ? result : bootstrapFailure(result.message)
  if (!hasWorktreeBootstrapSummaryDetails(summary)) return failure
  return { ...failure, worktreeBootstrap: summary }
}

function pathsForMode(operations: ReadyMaterialization[], mode: MaterializationMode): string[] {
  return operations.filter((operation) => operation.mode === mode).map((operation) => operation.rel)
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
