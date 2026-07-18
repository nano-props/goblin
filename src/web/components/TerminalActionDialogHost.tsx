import { useEffect } from 'react'
import { ConfirmDialog } from '#/web/components/ConfirmDialog.tsx'
import { runConfirmCloseTerminalWorkspacePaneTabCommand } from '#/web/commands/workspace-commands.ts'
import { useLastNonNull } from '#/web/hooks/useLastNonNull.ts'
import type { PrimaryWindowNavigationActions } from '#/web/primary-window-navigation.tsx'
import { useT } from '#/web/stores/i18n.ts'
import { useTerminalActionDialogsStore } from '#/web/stores/workspaces/terminal-action-dialogs.ts'
import type { ParsedWorkspacePaneRoute } from '#/web/App.tsx'

interface Props {
  currentWorkspaceId: string | null
  currentWorkspacePaneRoute: ParsedWorkspacePaneRoute | null
  navigation: PrimaryWindowNavigationActions
}

export function TerminalActionDialogHost({
  currentWorkspaceId,
  currentWorkspacePaneRoute,
  navigation,
}: Props) {
  const t = useT()
  const closeConfirm = useTerminalActionDialogsStore((s) => s.closeConfirm)
  const closeCloseConfirm = useTerminalActionDialogsStore((s) => s.closeCloseConfirm)
  const closeStaleDialogs = useTerminalActionDialogsStore((s) => s.closeStaleDialogs)
  const displayCloseConfirm = useLastNonNull(closeConfirm)

  useEffect(() => {
    if (currentWorkspaceId) closeStaleDialogs(currentWorkspaceId)
    else closeCloseConfirm()
  }, [currentWorkspaceId, closeCloseConfirm, closeStaleDialogs])

  return (
    <ConfirmDialog
      open={closeConfirm !== null}
      title={t('terminal.confirm-close-running-title')}
      message={
        displayCloseConfirm ? (
          <TerminalCloseConfirmBody
            body={t('terminal.confirm-close-running-body')}
            processName={displayCloseConfirm.processName}
          />
        ) : (
          ''
        )
      }
      confirmLabel={t('terminal.confirm-close-running-confirm')}
      destructive
      onCancel={closeCloseConfirm}
      onConfirm={async () => {
        if (!closeConfirm) return
        const payload = closeConfirm
        closeCloseConfirm()
        await runConfirmCloseTerminalWorkspacePaneTabCommand({
          workspaceId: payload.workspaceId,
          workspacePaneRoute: payload.workspacePaneRoute,
          currentWorkspacePaneRoute,
          navigation,
          targetIdentity: payload.targetIdentity,
          selectedIdentity: payload.selectedIdentity,
          confirmedTerminal: {
            terminalSessionId: payload.terminalSessionId,
            base: payload.terminalBase,
          },
        })
      }}
    />
  )
}

function TerminalCloseConfirmBody({ body, processName }: { readonly body: string; readonly processName: string }) {
  return (
    <div className="space-y-1">
      <p>{body}</p>
      <p className="break-all font-mono text-foreground">{processName}</p>
    </div>
  )
}
