import { describe, expect, test, vi } from 'vitest'
import type { TerminalSessionBase } from '#/shared/terminal-types.ts'
import { runCreateTerminalTabCommand } from '#/web/commands/terminal-create-command.ts'
import type { TerminalCreateAdmissionResult } from '#/web/components/terminal/terminal-create-admission.ts'
import { canonicalWorkspaceLocator } from '#/shared/workspace-locator.ts'

const REPO_ID = 'goblin+file:///tmp/goblin-terminal-create-command-repo'
const WORKSPACE_RUNTIME_ID = 'repo-runtime-terminal-create-command'
const WORKTREE_PATH = '/tmp/goblin-terminal-create-command-worktree'
const BASE: TerminalSessionBase = {
  target: {
    kind: 'git-worktree' as const,
    workspaceId: canonicalWorkspaceLocator(REPO_ID)!,
    workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
    root: canonicalWorkspaceLocator(`goblin+file://${WORKTREE_PATH}`)!,
  },
  presentation: { kind: 'git-worktree' as const, head: { kind: 'branch' as const, branchName: 'main' } },
}

describe('terminal create command', () => {
  test('surfaces a changed workspace target instead of treating it as cancellation', async () => {
    const error = new Error('error.workspace-target-stale')
    await expect(
      runCreateTerminalTabCommand({
        base: BASE,
        createTerminal: vi.fn(async () => {
          throw error
        }),
        commitCreatedTerminalTab: vi.fn(),
      }),
    ).resolves.toEqual({ ok: false, error, messageKey: 'error.workspace-target-stale' })
  })

  test('commits the leader admission after the server creates the session', async () => {
    const admission = createAdmission()
    const createTerminal = vi.fn(async () => admission)
    const commitCreatedTerminalTab = vi.fn(() => ({ status: 'committed' as const }))

    await expect(
      runCreateTerminalTabCommand({
        base: BASE,
        createTerminal,
        commitCreatedTerminalTab,
      }),
    ).resolves.toEqual({
      ok: true,
      terminalSessionId: admission.terminalSessionId,
      presentationStatus: 'committed',
    })

    expect(createTerminal).toHaveBeenCalledOnce()
    expect(commitCreatedTerminalTab).toHaveBeenCalledWith(admission)
  })

  test('passes the captured insertion anchor to the server application operation', async () => {
    const admission = createAdmission()
    const createTerminal = vi.fn(async () => admission)
    const commitCreatedTerminalTab = vi.fn(() => ({ status: 'committed' as const }))

    await runCreateTerminalTabCommand({
      base: BASE,
      createTerminal,
      insertAfterIdentity: 'workspace-pane:status',
      commitCreatedTerminalTab,
    })

    expect(createTerminal).toHaveBeenCalledWith(BASE, undefined, { insertAfterIdentity: 'workspace-pane:status' })
    expect(commitCreatedTerminalTab).toHaveBeenCalledWith(admission)
  })

  test('does not repeat presentation side effects for a duplicate create observer', async () => {
    const admission = createAdmission({ requestRole: 'observer' })
    const commitCreatedTerminalTab = vi.fn(() => ({ status: 'committed' as const }))

    await expect(
      runCreateTerminalTabCommand({
        base: BASE,
        createTerminal: vi.fn(async () => admission),
        commitCreatedTerminalTab,
      }),
    ).resolves.toEqual({ ok: true, terminalSessionId: admission.terminalSessionId, presentationStatus: 'observer' })

    expect(commitCreatedTerminalTab).not.toHaveBeenCalled()
  })

  test('treats a superseded client presentation as a committed server operation', async () => {
    const admission = createAdmission()

    await expect(
      runCreateTerminalTabCommand({
        base: BASE,
        createTerminal: vi.fn(async () => admission),
        commitCreatedTerminalTab: vi.fn(() => ({ status: 'superseded' as const })),
      }),
    ).resolves.toEqual({ ok: true, terminalSessionId: admission.terminalSessionId, presentationStatus: 'superseded' })
  })

  test('keeps a server create successful when local projection is deferred to recovery', async () => {
    const admission = createAdmission()
    await expect(
      runCreateTerminalTabCommand({
        base: BASE,
        createTerminal: vi.fn(async () => admission),
        commitCreatedTerminalTab: vi.fn(() => ({ status: 'projection-failed' as const })),
      }),
    ).resolves.toEqual({
      ok: true,
      terminalSessionId: admission.terminalSessionId,
      presentationStatus: 'projection-failed',
    })
  })

  test('reports exact-route rejection without destroying the committed server session', async () => {
    await expect(
      runCreateTerminalTabCommand({
        base: BASE,
        createTerminal: vi.fn(async () => createAdmission()),
        commitCreatedTerminalTab: vi.fn(() => ({ status: 'navigation-rejected' as const })),
      }),
    ).resolves.toMatchObject({ ok: true, presentationStatus: 'navigation-rejected' })
  })

  test('reports presentation exceptions without destroying the committed server session', async () => {
    const commitCreatedTerminalTab = vi.fn(() => {
      throw new Error('workspace presentation failed')
    })

    await expect(
      runCreateTerminalTabCommand({
        base: BASE,
        createTerminal: vi.fn(async () => createAdmission()),
        commitCreatedTerminalTab,
      }),
    ).resolves.toMatchObject({ ok: true, presentationStatus: 'presentation-failed' })

    expect(commitCreatedTerminalTab).toHaveBeenCalledOnce()
  })

  test('reports provider create failure without running client presentation', async () => {
    const createTerminal = vi.fn(async () => {
      throw new Error('provider create failed')
    })
    const commitCreatedTerminalTab = vi.fn(() => ({ status: 'committed' as const }))

    await expect(
      runCreateTerminalTabCommand({
        base: BASE,
        createTerminal,
        commitCreatedTerminalTab,
      }),
    ).resolves.toMatchObject({ ok: false, messageKey: 'error.terminal-create-failed' })

    expect(createTerminal).toHaveBeenCalledOnce()
    expect(commitCreatedTerminalTab).not.toHaveBeenCalled()
  })

})

function createAdmission(overrides: Partial<TerminalCreateAdmissionResult> = {}): TerminalCreateAdmissionResult {
  return {
    terminalSessionId: 'term-111111111111111111111',
    presentation: { kind: 'git-worktree' as const, head: { kind: 'branch' as const, branchName: 'main' } },
    requestRole: 'leader',
    resourceDisposition: 'created',
    runtimeProjectionApplied: true,
    ...overrides,
  }
}
