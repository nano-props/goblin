import { useCallback, useMemo } from 'react'
import type { TerminalPresentation, TerminalSessionBase } from '#/shared/terminal-types.ts'
import type { WorkspacePaneRuntimeTabType } from '#/shared/workspace-pane.ts'
import { useTerminalSessionContext } from '#/web/components/terminal/terminal-session-context.ts'
import type { TerminalCreateTranslator } from '#/web/components/terminal/terminal-create-feedback.ts'
import { captureWorkspacePaneActiveTabIdentity } from '#/web/workspace-pane/workspace-pane-tab-opener.ts'
import {
  type WorkspacePaneRuntimeTabCreateAction,
  type WorkspacePaneRuntimeTabCreateStateByType,
  workspacePaneRuntimeTabCreateAction,
} from '#/web/workspace-pane/workspace-pane-runtime-tab-create-action.ts'
import type { ParsedRepoBranchWorkspacePaneRoute } from '#/web/App.tsx'
import { runtimeWorkspacePaneTarget } from '#/shared/workspace-pane-tabs-target.ts'
import type { RuntimeWorkspacePaneTarget } from '#/shared/workspace-runtime.ts'

export interface UseWorkspacePaneRuntimeTabCreateActionInput {
  repoRoot: string
  repoRuntimeId: string
  branchName: string | null
  worktreePath: string | null
  runtimeTabStateByType: WorkspacePaneRuntimeTabCreateStateByType
  initialRuntimeProjectionHydrating: boolean
  workspacePaneRoute: ParsedRepoBranchWorkspacePaneRoute | null | undefined
  showCreatedRuntimeTab: (
    type: WorkspacePaneRuntimeTabType,
    sessionId: string,
    presentation: TerminalPresentation,
    target: RuntimeWorkspacePaneTarget,
  ) => boolean | Promise<boolean>
  t: TerminalCreateTranslator
}

export function useWorkspacePaneRuntimeTabCreateAction({
  repoRoot,
  repoRuntimeId,
  branchName,
  worktreePath,
  runtimeTabStateByType,
  initialRuntimeProjectionHydrating,
  workspacePaneRoute,
  showCreatedRuntimeTab,
  t,
}: UseWorkspacePaneRuntimeTabCreateActionInput): WorkspacePaneRuntimeTabCreateAction | null {
  const { createTerminalWithAdmission } = useTerminalSessionContext()
  const terminalBase = useMemo<TerminalSessionBase | null>(() => {
    if (!worktreePath) return null
    const paneTarget =
      branchName === null
        ? { kind: 'workspace-root' as const, repoRoot, branchName: null, worktreePath: null }
        : { repoRoot, branchName, worktreePath }
    const target = runtimeWorkspacePaneTarget(paneTarget, repoRuntimeId)
    if (!target || (target.kind !== 'workspace-root' && !branchName)) return null
    if (target.kind === 'workspace-root') return { target, presentation: { kind: 'workspace-root' } }
    if (target.kind === 'git-worktree' && branchName) {
      return { target, presentation: { kind: 'git-worktree', branchName } }
    }
    return null
  }, [branchName, repoRuntimeId, repoRoot, worktreePath])
  const captureOpenerIdentity = useCallback(
    () =>
      captureWorkspacePaneActiveTabIdentity(repoRoot, repoRuntimeId, branchName, {
        workspacePaneRoute,
      }),
    [branchName, repoRoot, repoRuntimeId, workspacePaneRoute],
  )

  return useMemo(
    () =>
      workspacePaneRuntimeTabCreateAction('terminal', {
        repoRoot,
        runtimeTabStateByType,
        initialRuntimeProjectionHydrating,
        showCreatedRuntimeTab: (type, sessionId, presentation) =>
          terminalBase?.target ? showCreatedRuntimeTab(type, sessionId, presentation, terminalBase.target) : false,
        t,
        terminal: {
          base: terminalBase,
          createTerminal: createTerminalWithAdmission,
          captureOpenerIdentity,
        },
      }),
    [
      captureOpenerIdentity,
      createTerminalWithAdmission,
      initialRuntimeProjectionHydrating,
      repoRoot,
      runtimeTabStateByType,
      showCreatedRuntimeTab,
      t,
      terminalBase,
    ],
  )
}
