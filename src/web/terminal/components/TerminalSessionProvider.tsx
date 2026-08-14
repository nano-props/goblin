import { defineComponent, onMounted, onScopeDispose, watch } from 'vue'
import '#/web/terminal/components/terminal-session.css'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'
import { terminalClient } from '#/web/terminal/client-facade.ts'
import {
  provideTerminalSessionContext,
  provideTerminalSessionReadContext,
} from '#/web/terminal/components/terminal-session-context.ts'
import { preloadTerminalFont } from '#/web/terminal/components/terminal-font.ts'
import { useTerminalSessionProjection } from '#/web/terminal/components/use-terminal-session-projection.ts'
import { setTerminalSessionCommandBridge } from '#/web/terminal/components/terminal-session-command-bridge.ts'
import { useTerminalRuntimeMembershipIndex } from '#/web/terminal/components/terminal-runtime-membership-index.ts'
import type { TerminalSessionContextValue, TerminalSessionReadContextValue } from '#/web/terminal/components/types.ts'
import { useStoreSelector } from '#/web/stores/store-selector.ts'

export const TerminalSessionProvider = defineComponent({
  name: 'TerminalSessionProvider',
  setup(_props, { slots }) {
    const runtimeMembershipIndex = useTerminalRuntimeMembershipIndex()
    const selectedSessionIds = useStoreSelector(
      workspacesStore,
      (state) => state.selectedTerminalSessionIdByTerminalFilesystemTarget,
    )
    const projection = useTerminalSessionProjection()

    onMounted(() => {
      void preloadTerminalFont()
    })

    // The client projection is an external owner. Keep its membership and
    // preferred-selection inputs synchronized with their authoritative store.
    watch(
      [runtimeMembershipIndex, selectedSessionIds],
      ([membershipIndex, preferredSessionIds]) => {
        projection.setRuntimeMembershipIndex(membershipIndex)
        projection.setPreferredSelectedTerminalSessionIds(preferredSessionIds)
      },
      { immediate: true },
    )

    const unsubscribers = [
      terminalClient.onOutput((event) => projection.handleOutput(event)),
      terminalClient.onBell((event) => projection.handleServerBell(event)),
      terminalClient.onTitle((event) => projection.handleServerTitle(event)),
      terminalClient.onExit((event) => projection.handleExit(event)),
      terminalClient.onIdentity((event) => projection.handleIdentity(event)),
      terminalClient.onLifecycle((event) => projection.handleLifecycle(event)),
      terminalClient.onSessionClosed((event) => projection.handleSessionClosed(event)),
    ]
    const disposeCommandBridge = setTerminalSessionCommandBridge({
      terminalFilesystemTargetSnapshot: projection.terminalFilesystemTargetSnapshot,
      createTerminal: projection.createTerminal,
      createTerminalWithAdmission: projection.createTerminalWithAdmission,
      selectTerminal: projection.selectTerminal,
      focusTerminal: projection.focusTerminal,
      closeTerminalByDescriptor: projection.closeTerminalByDescriptor,
    })
    onScopeDispose(() => {
      for (const unsubscribe of unsubscribers) unsubscribe()
      disposeCommandBridge()
    })

    const commandValue: TerminalSessionContextValue = {
      createTerminal: projection.createTerminal,
      createTerminalWithAdmission: projection.createTerminalWithAdmission,
      selectTerminal: projection.selectTerminal,
      scrollToBottom: projection.scrollToBottom,
      readCopyText: projection.readCopyText,
      clearBell: projection.clearBell,
      closeTerminalByDescriptor: projection.closeTerminalByDescriptor,
      attach: projection.attach,
      detach: projection.detach,
      restart: projection.restart,
      focusTerminal: projection.focusTerminal,
      findNext: projection.findNext,
      findPrevious: projection.findPrevious,
      clearSearch: projection.clearSearch,
      captureInputWriter: projection.captureInputWriter,
      sendVirtualKey: projection.sendVirtualKey,
      openComposer: projection.openComposer,
      closeComposer: projection.closeComposer,
      setComposerMode: projection.setComposerMode,
      setComposerDraft: projection.setComposerDraft,
      replaceComposerDraft: projection.replaceComposerDraft,
      submitText: projection.submitText,
      takeover: projection.takeover,
      retryPresentation: projection.retryPresentation,
    }
    const readValue: TerminalSessionReadContextValue = {
      terminalFilesystemTargetSnapshot: projection.terminalFilesystemTargetSnapshot,
      subscribeTerminalFilesystemTarget: projection.subscribeTerminalFilesystemTarget,
      workspaceBellCount: projection.workspaceBellCount,
      subscribeWorkspaceBellCount: projection.subscribeWorkspaceBellCount,
      workspaceTerminalSessions: projection.workspaceTerminalSessions,
      subscribeWorkspaceTerminalSessions: projection.subscribeWorkspaceTerminalSessions,
      snapshot: projection.snapshot,
      subscribeSnapshot: projection.subscribeSnapshot,
    }
    provideTerminalSessionContext(commandValue)
    provideTerminalSessionReadContext(readValue)

    return () => slots.default?.()
  },
})
