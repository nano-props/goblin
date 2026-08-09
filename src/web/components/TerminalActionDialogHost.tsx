import { defineComponent, watch } from 'vue'
import type { FunctionalComponent } from 'vue'
import type { AppNavigationActions } from '#/web/app-navigation-actions.ts'
import type { ParsedWorkspacePaneRoute } from '#/web/App.tsx'
import { ConfirmDialog } from '#/web/components/ConfirmDialog.tsx'
import { runConfirmCloseTerminalWorkspacePaneTabCommand } from '#/web/commands/workspace-commands.ts'
import { useLastNonNull } from '#/web/hooks/useLastNonNull.ts'
import { useStoreSelector } from '#/web/stores/store-selector.ts'
import { useT } from '#/web/stores/i18n-vue.ts'
import { terminalActionDialogsStore } from '#/web/stores/workspaces/terminal-action-dialogs.ts'

interface Props {
  currentWorkspaceId: string | null
  currentWorkspacePaneRoute: ParsedWorkspacePaneRoute | null
  navigation: AppNavigationActions
}

export const TerminalActionDialogHost = defineComponent<Props>({
  name: 'TerminalActionDialogHost',
  props: ['currentWorkspaceId', 'currentWorkspacePaneRoute', 'navigation'],

  setup(props) {
    const t = useT()
    const closeConfirm = useStoreSelector(terminalActionDialogsStore, (state) => state.closeConfirm)
    const displayCloseConfirm = useLastNonNull(closeConfirm)
    const { closeCloseConfirm, takeCloseConfirm, closeStaleDialogs } = terminalActionDialogsStore.getState()

    // A terminal-close payload belongs to one workspace authority.
    watch(
      [() => props.currentWorkspaceId, () => closeConfirm.value?.workspaceId ?? null],
      ([workspaceId]) => {
        if (workspaceId) closeStaleDialogs(workspaceId)
        else closeCloseConfirm()
      },
      { immediate: true },
    )

    return () => (
      <ConfirmDialog
        open={closeConfirm.value !== null}
        title={t('terminal.confirm-close-running-title')}
        message={
          displayCloseConfirm.value ? (
            <TerminalCloseConfirmBody
              body={t('terminal.confirm-close-running-body')}
              processName={displayCloseConfirm.value.processName}
            />
          ) : (
            ''
          )
        }
        confirmLabel={t('terminal.confirm-close-running-confirm')}
        destructive
        onCancel={closeCloseConfirm}
        onConfirm={async () => {
          const payload = takeCloseConfirm()
          if (!payload) return
          await runConfirmCloseTerminalWorkspacePaneTabCommand({
            workspaceId: payload.workspaceId,
            workspacePaneRoute: payload.workspacePaneRoute,
            routeTarget: payload.routeTarget,
            currentWorkspacePaneRoute: props.currentWorkspacePaneRoute,
            navigation: props.navigation,
            targetIdentity: payload.targetIdentity,
            selectedIdentity: payload.selectedIdentity,
            confirmedTerminal: {
              terminalSessionId: payload.terminalSessionId,
              base: payload.terminalBase,
            },
            ...(payload.presentationEffects ? { presentationEffects: payload.presentationEffects } : {}),
          })
        }}
      />
    )
  },
})

const TerminalCloseConfirmBody: FunctionalComponent<{ body: string; processName: string }> = (props) => (
  <div class="space-y-1">
    <p>{props.body}</p>
    <p class="break-all font-mono text-foreground">{props.processName}</p>
  </div>
)

TerminalCloseConfirmBody.props = ['body', 'processName']
