import {
  runRemoteCommand,
  type RemoteCommandKind,
  type RemoteCommandResult,
} from '#/system/ssh/commands.ts'
import type { RemoteDiagnosticCategory, RemoteDiagnosticStage, RemoteDiagnosticStageName, RemoteDiagnosticsResult, RemoteRepoTarget } from '#/shared/remote-repo.ts'

type DiagnosticsRunner = (
  command: RemoteCommandKind,
  target: RemoteRepoTarget,
  options?: { signal?: AbortSignal },
) => Promise<RemoteCommandResult>

export async function testRemoteRepository(
  target: RemoteRepoTarget,
  options: { signal?: AbortSignal; run?: DiagnosticsRunner } = {},
): Promise<RemoteDiagnosticsResult> {
  const run: DiagnosticsRunner = options.run ?? ((command, t, runOptions) => runRemoteCommand(t, command, runOptions))
  const stages = createStages()
  const fail = (
    index: number,
    category: RemoteDiagnosticCategory,
    result: RemoteCommandResult,
  ): RemoteDiagnosticsResult => {
    stages[index] = {
      ...stages[index]!,
      status: 'failed',
      category,
      message: category,
      details: detailsFromResult(result),
    }
    for (let i = index + 1; i < stages.length; i += 1) stages[i] = { ...stages[i]!, status: 'skipped' }
    return {
      target,
      ok: false,
      category,
      message: category,
      details: detailsFromResult(result),
      stages,
    }
  }

  const shell = await run({ type: 'checkShell' }, target, { signal: options.signal })
  if (!shell.ok) return fail(0, classifySshFailure(shell), shell)
  stages[0] = { ...stages[0]!, status: 'passed' }
  if (shell.stdout.trim() !== 'ok') return fail(1, 'shell-failed', { ...shell, message: 'shell-failed' })
  stages[1] = { ...stages[1]!, status: 'passed' }

  const git = await run({ type: 'checkGit' }, target, { signal: options.signal })
  if (!git.ok) return fail(2, classifyCommandFailure(git, 'git-missing'), git)
  stages[2] = { ...stages[2]!, status: 'passed' }

  const path = await run({ type: 'testDirectory', path: target.remotePath }, target, { signal: options.signal })
  if (!path.ok) return fail(3, classifyCommandFailure(path, 'path-missing'), path)
  stages[3] = { ...stages[3]!, status: 'passed' }

  const repo = await run({ type: 'revParseTopLevel', path: target.remotePath }, target, { signal: options.signal })
  if (!repo.ok) return fail(4, classifyCommandFailure(repo, 'not-a-repo'), repo)
  stages[4] = { ...stages[4]!, status: 'passed' }

  return { target, ok: true, stages }
}

export function classifySshFailure(result: RemoteCommandResult): RemoteDiagnosticCategory {
  if (result.message === 'cancelled') return 'cancelled'
  if (result.timedOut || result.message === 'timeout') return 'timeout'
  const text = `${result.stderr}\n${result.stdout}\n${result.message ?? ''}`.toLowerCase()
  if (text.includes('host key verification failed') || text.includes('remote host identification has changed')) return 'host-key'
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

function detailsFromResult(result: RemoteCommandResult): string | undefined {
  return [result.stderr, result.stdout].map((part) => part.trim()).filter(Boolean).join('\n') || undefined
}
