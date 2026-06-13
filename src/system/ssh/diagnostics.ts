import { runRemoteCommand, type RemoteCommandKind, type RemoteCommandResult } from '#/system/ssh/commands.ts'
import type {
  RemoteDiagnosticCategory,
  RemoteDiagnosticStage,
  RemoteDiagnosticStageName,
  RemoteDiagnosticsResult,
  RemoteRepoTarget,
} from '#/shared/remote-repo.ts'

type DiagnosticsRunner = (
  command: RemoteCommandKind,
  target: RemoteRepoTarget,
  options?: { signal?: AbortSignal; timeoutMs?: number },
) => Promise<RemoteCommandResult>

export async function testRemoteRepository(
  target: RemoteRepoTarget,
  options: { signal?: AbortSignal; run?: DiagnosticsRunner; timeoutMs?: number } = {},
): Promise<RemoteDiagnosticsResult> {
  const run: DiagnosticsRunner = options.run ?? ((command, t, runOptions) => runRemoteCommand(t, command, runOptions))
  const stages = createStages()
  // No default timeout: the boot-probe caller passes SSH_BOOT_PROBE_TIMEOUT_MS,
  // the manual diagnostic in OpenRemoteRepositoryDialog leaves it unset so
  // runRemoteCommand falls back to the full SSH_COMMAND_TIMEOUT_MS.
  const runOptions = { signal: options.signal, timeoutMs: options.timeoutMs }

  // Stage 0/1: ssh handshake + shell sanity ("ok" marker). One ssh
  // invocation covers both: any successful ssh call proves stage 0,
  // and the checkShell script prints 'ok' on stdout to mark stage 1.
  // These two have to be sequential because the shell check rides on
  // top of the ssh connection — and the stage is sequential, so a
  // failure here genuinely skips every downstream stage.
  const shell = await run({ type: 'checkShell' }, target, runOptions)
  if (!shell.ok) return failDiagnosticAt(target, stages, 0, classifySshFailure(shell), shell)
  stages[0] = { ...stages[0]!, status: 'passed' }
  if (shell.stdout.trim() !== 'ok') {
    return failDiagnosticAt(target, stages, 1, 'shell-failed', { ...shell, message: 'shell-failed' })
  }
  stages[1] = { ...stages[1]!, status: 'passed' }

  // Stages 2/3/4 are independent of each other (each is its own ssh
  // invocation, multiplexed over the ControlMaster socket). Run them
  // in parallel and merge per-stage status. The first failure in
  // execution order wins as the primary diagnostic, but we still
  // record the actual outcome of every stage we ran — earlier code
  // marked downstream stages as 'skipped' even though they had
  // already returned, which lost useful diagnostic detail.
  const [gitResult, pathResult, repoResult] = await Promise.all([
    run({ type: 'checkGit' }, target, runOptions),
    run({ type: 'testDirectory', path: target.remotePath }, target, runOptions),
    run({ type: 'revParseTopLevel', path: target.remotePath }, target, runOptions),
  ])
  const stageResults: Array<{ result: RemoteCommandResult; fallback: RemoteDiagnosticCategory }> = [
    { result: gitResult, fallback: 'git-missing' },
    { result: pathResult, fallback: 'path-missing' },
    { result: repoResult, fallback: 'not-a-repo' },
  ]
  let primary: { index: number; category: RemoteDiagnosticCategory; result: RemoteCommandResult } | null = null
  for (let i = 0; i < stageResults.length; i += 1) {
    const { result, fallback } = stageResults[i]!
    if (!result.ok) {
      const category = classifyCommandFailure(result, fallback)
      stages[2 + i] = {
        ...stages[2 + i]!,
        status: 'failed',
        category,
        message: category,
        details: detailsFromResult(result),
      }
      if (!primary) primary = { index: 2 + i, category, result }
    } else {
      stages[2 + i] = { ...stages[2 + i]!, status: 'passed' }
    }
  }
  if (primary)
    return {
      target,
      ok: false,
      category: primary.category,
      message: primary.category,
      details: detailsFromResult(primary.result),
      stages,
    }

  return { target, ok: true, stages }
}

export function classifySshFailure(result: RemoteCommandResult): RemoteDiagnosticCategory {
  if (result.message === 'cancelled') return 'cancelled'
  if (result.timedOut || result.message === 'timeout') return 'timeout'
  const text = `${result.stderr}\n${result.stdout}\n${result.message ?? ''}`.toLowerCase()
  if (text.includes('host key verification failed') || text.includes('remote host identification has changed'))
    return 'host-key'
  if (text.includes('permission denied') || text.includes('authentication failed')) return 'auth-failed'
  if (
    text.includes('kex_exchange_identification') ||
    text.includes('ssh_exchange_identification') ||
    text.includes('banner exchange') ||
    text.includes('connection reset by peer') ||
    text.includes('connection closed by remote host')
  ) {
    return 'handshake-failed'
  }
  if (
    text.includes('could not resolve hostname') ||
    text.includes('name or service not known') ||
    text.includes('connection timed out') ||
    text.includes('connection refused') ||
    text.includes('no route to host')
  ) {
    return 'unreachable'
  }
  return 'shell-failed'
}

function classifyCommandFailure(
  result: RemoteCommandResult,
  fallback: RemoteDiagnosticCategory,
): RemoteDiagnosticCategory {
  if (result.message === 'cancelled') return 'cancelled'
  if (result.timedOut || result.message === 'timeout') return 'timeout'
  return fallback
}

function createStages(): RemoteDiagnosticStage[] {
  return (['ssh', 'shell', 'git', 'path', 'repo'] as RemoteDiagnosticStageName[]).map((name) => ({
    name,
    label: name,
    status: 'pending',
  }))
}

/** Mark `stages[failedIndex]` as failed with the given category and
 *  every later stage as 'skipped' (the stages before have already
 *  passed, so they keep their passed status). Used by the sequential
 *  stage 0/1 path, where a failure genuinely hasn't run anything
 *  downstream yet. The parallel stage 2/3/4 path uses a different
 *  shape that records the actual outcome of every stage that ran —
 *  see the Promise.all block above. */
function failDiagnosticAt(
  target: RemoteRepoTarget,
  stages: RemoteDiagnosticStage[],
  failedIndex: number,
  category: RemoteDiagnosticCategory,
  result: RemoteCommandResult,
): RemoteDiagnosticsResult {
  const details = detailsFromResult(result)
  stages[failedIndex] = {
    ...stages[failedIndex]!,
    status: 'failed',
    category,
    message: category,
    details,
  }
  for (let i = failedIndex + 1; i < stages.length; i += 1) stages[i] = { ...stages[i]!, status: 'skipped' }
  return { target, ok: false, category, message: category, details, stages }
}

/** Build a fully-populated failure diagnostic for a target whose
 *  resolution never even reached the SSH handshake — e.g. the alias
 *  dropped out of ~/.ssh/config. Marks `ssh` as the failed stage and
 *  every subsequent stage as skipped, so the rendered failure matches
 *  the canonical stage ordering without callers having to mirror it. */
export function makeUnresolvedTargetDiagnostic(
  target: RemoteRepoTarget,
  category: RemoteDiagnosticCategory,
  message: string,
): RemoteDiagnosticsResult {
  const stages: RemoteDiagnosticStage[] = (['ssh', 'shell', 'git', 'path', 'repo'] as RemoteDiagnosticStageName[]).map(
    (name) => ({
      name,
      label: name,
      status: 'skipped',
    }),
  )
  stages[0] = {
    name: 'ssh',
    label: 'ssh',
    status: 'failed',
    category,
    message,
  }
  return { target, ok: false, category, message, stages }
}

function detailsFromResult(result: RemoteCommandResult): string | undefined {
  return (
    [result.stderr, result.stdout]
      .map((part) => part.trim())
      .filter(Boolean)
      .join('\n') || undefined
  )
}
