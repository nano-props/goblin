import path from 'node:path'
import { parseBootstrapConfig, worktreeBootstrapConfigHash } from '#/system/git/worktree-bootstrap-config.ts'
import type { WorktreeBootstrapConfig } from '#/system/git/worktree-bootstrap-config.ts'
import { runRemoteCommand } from '#/system/ssh/commands.ts'
import { remoteBootstrapSummaryFromOutput } from '#/system/ssh/git/codec.ts'
import type { ExecResult } from '#/shared/git-types.ts'
import type { RemoteWorkspaceTarget } from '#/shared/remote-workspace.ts'
import {
  formatWorktreeBootstrapSummary,
  hasWorktreeBootstrapSummaryDetails,
  worktreeBootstrapPreviewFromConfig,
} from '#/shared/worktree-bootstrap-summary.ts'
import type {
  WorktreeBootstrapResult,
  WorktreeBootstrapPreviewResult,
  WorktreeBootstrapSummary,
} from '#/shared/worktree-bootstrap-summary.ts'
import type { RemoteCommandRunner } from '#/system/ssh/commands.ts'
import { REMOTE_GIT_BRANCH_OPERATION_TIMEOUT_MS } from '#/system/ssh/git/timeouts.ts'

const REMOTE_BOOTSTRAP_TIMEOUT_MS = 10 * 60_000

interface RemoteBootstrapConfigLoad {
  config?: WorktreeBootstrapConfig
  configHash?: string
  sourceRoot: string
}

async function loadRemoteBootstrapConfig(
  target: RemoteWorkspaceTarget,
  options: { signal?: AbortSignal; run: RemoteCommandRunner },
): Promise<{ ok: true; value: RemoteBootstrapConfigLoad } | { ok: false; message: string }> {
  const rootResult = await options.run({ type: 'revParseTopLevel', path: target.remotePath }, target, {
    signal: options.signal,
    timeoutMs: REMOTE_GIT_BRANCH_OPERATION_TIMEOUT_MS,
  })
  if (rootResult.message === 'cancelled') return { ok: false, message: 'cancelled' }
  if (!rootResult.ok) return { ok: false, message: rootResult.message || 'failed to resolve source repo root' }
  const sourceRoot = rootResult.stdout || target.remotePath

  const readResult = await options.run(
    { type: 'readRemoteFile', path: path.posix.join(sourceRoot, 'goblin.toml') },
    target,
    { signal: options.signal, timeoutMs: REMOTE_GIT_BRANCH_OPERATION_TIMEOUT_MS },
  )
  if (readResult.message === 'cancelled') return { ok: false, message: 'cancelled' }
  if (!readResult.ok) return { ok: false, message: readResult.message || 'failed to read goblin.toml' }

  const raw = readResult.stdout
  if (!raw.trim()) return { ok: true, value: { sourceRoot } }

  const loaded = parseBootstrapConfig(raw)
  if (loaded.kind === 'error') return { ok: false, message: loaded.message }
  if (loaded.kind === 'none') return { ok: true, value: { sourceRoot } }
  return { ok: true, value: { sourceRoot, config: loaded.config, configHash: worktreeBootstrapConfigHash(raw) } }
}

export async function getRemoteWorktreeBootstrapPreview(
  target: RemoteWorkspaceTarget,
  options: { signal?: AbortSignal; run?: RemoteCommandRunner } = {},
): Promise<WorktreeBootstrapPreviewResult> {
  const run: RemoteCommandRunner = options.run ?? ((command, t, runOptions) => runRemoteCommand(t, command, runOptions))
  const loaded = await loadRemoteBootstrapConfig(target, { signal: options.signal, run })
  if (!loaded.ok) return { ok: false, message: `Worktree bootstrap failed: ${loaded.message}` }
  return { ok: true, preview: worktreeBootstrapPreviewFromConfig(loaded.value.config, loaded.value.configHash) }
}

export async function bootstrapRemoteWorktreeAfterCreate(
  target: RemoteWorkspaceTarget,
  worktreePath: string,
  options: { signal?: AbortSignal; run?: RemoteCommandRunner; expectedConfigHash?: string } = {},
): Promise<WorktreeBootstrapResult> {
  const run: RemoteCommandRunner = options.run ?? ((command, t, runOptions) => runRemoteCommand(t, command, runOptions))
  const loaded = await loadRemoteBootstrapConfig(target, { signal: options.signal, run })
  if (!loaded.ok) return remoteBootstrapFailure(loaded)
  if (!loaded.value.config) {
    if (options.expectedConfigHash) {
      return { ok: false, message: 'Worktree bootstrap failed: goblin.toml changed after confirmation' }
    }
    return { ok: true, message: '' }
  }
  if (options.expectedConfigHash && loaded.value.configHash !== options.expectedConfigHash) {
    return { ok: false, message: 'Worktree bootstrap failed: goblin.toml changed after confirmation' }
  }

  const bootstrapResult = await run(
    {
      type: 'bootstrapRemoteWorktree',
      sourceRoot: loaded.value.sourceRoot,
      targetRoot: worktreePath,
      copy: loaded.value.config.copy,
      symlink: loaded.value.config.symlink,
      hardlink: loaded.value.config.hardlink,
      exclude: loaded.value.config.exclude,
      setup: loaded.value.config.setup,
    },
    target,
    { signal: options.signal, timeoutMs: REMOTE_BOOTSTRAP_TIMEOUT_MS },
  )
  const summary = remoteBootstrapSummaryFromOutput(bootstrapResult.stdout)
  if (bootstrapResult.message === 'cancelled') {
    return remoteBootstrapResultWithSummary({ ok: false, message: 'cancelled' }, summary)
  }
  if (!bootstrapResult.ok) {
    return remoteBootstrapResultWithSummary(
      { ok: false, message: `Worktree bootstrap failed: ${bootstrapResult.message}` },
      summary,
    )
  }
  return {
    ok: true,
    message: formatWorktreeBootstrapSummary(summary),
    ...(hasWorktreeBootstrapSummaryDetails(summary) ? { worktreeBootstrap: summary } : {}),
  }
}

function remoteBootstrapResultWithSummary(
  result: ExecResult,
  summary: WorktreeBootstrapSummary,
): WorktreeBootstrapResult {
  if (!hasWorktreeBootstrapSummaryDetails(summary)) return result
  return { ...result, worktreeBootstrap: summary }
}

function remoteBootstrapFailure(result: ExecResult): ExecResult {
  if (result.message === 'cancelled') return result
  return { ok: false, message: `Worktree bootstrap failed: ${result.message}` }
}
