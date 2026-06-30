import { useEffect } from 'react'
import { ConfirmDialog } from '#/web/components/ConfirmDialog.tsx'
import { runConfirmCloseTerminalWorkspacePaneTabCommand } from '#/web/commands/workspace-commands.ts'
import { useLastNonNull } from '#/web/hooks/useLastNonNull.ts'
import type { PrimaryWindowNavigationActions } from '#/web/primary-window-navigation.tsx'
import { useT } from '#/web/stores/i18n.ts'
import { useTerminalActionDialogsStore } from '#/web/stores/repos/terminal-action-dialogs.ts'

interface Props {
  activeRepoId: string | null
  navigation: PrimaryWindowNavigationActions
}

export function TerminalActionDialogHost({ activeRepoId, navigation }: Props) {
  const t = useT()
  const closeConfirm = useTerminalActionDialogsStore((s) => s.closeConfirm)
  const closeCloseConfirm = useTerminalActionDialogsStore((s) => s.closeCloseConfirm)
  const closeStaleDialogs = useTerminalActionDialogsStore((s) => s.closeStaleDialogs)
  const displayCloseConfirm = useLastNonNull(closeConfirm)

  useEffect(() => {
    if (activeRepoId) closeStaleDialogs(activeRepoId)
    else closeCloseConfirm()
  }, [activeRepoId, closeCloseConfirm, closeStaleDialogs])

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
          repoId: payload.repoId,
          navigation,
          targetIdentity: payload.targetIdentity,
          confirmedTerminal: {
            terminalKey: payload.terminalKey,
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
