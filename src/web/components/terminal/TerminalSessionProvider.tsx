import { useEffect, useMemo, type ReactNode } from 'react'

import '#/web/components/terminal/terminal-session.css'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { terminalClient } from '#/web/terminal.ts'
import {
  TerminalSessionContext,
  TerminalSessionReadContext,
} from '#/web/components/terminal/terminal-session-context.ts'
import { preloadTerminalFont } from '#/web/components/terminal/terminal-geometry.ts'
import { refreshWorkspacePaneTabs } from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import { useTerminalSessionProjection } from '#/web/components/terminal/use-terminal-session-projection.ts'
import { setTerminalSessionCommandBridge } from '#/web/components/terminal/terminal-session-command-bridge.ts'
import { useTerminalRuntimeMembershipIndex } from '#/web/components/terminal/terminal-runtime-membership-index.ts'
import type { TerminalSessionContextValue, TerminalSessionReadContextValue } from '#/web/components/terminal/types.ts'

interface TerminalSessionProviderProps {
  children: ReactNode
}

export function TerminalSessionProvider({ children }: TerminalSessionProviderProps) {
  const runtimeMembershipIndex = useTerminalRuntimeMembershipIndex()
  const selectedTerminalSessionIdByTerminalWorktree = useReposStore(
    (s) => s.selectedTerminalSessionIdByTerminalWorktree,
  )

  // T1.1: prewarm the terminal font at app startup. The provider lives at
  // the router root above the per-route App, so this fires once per app
  // run (no `key` prop on the provider). preloadTerminalFont is
  // idempotent — `document.fonts.check` short-circuits on the second
  // call when openPhase's own preload fires. Failure is swallowed
  // inside the function; we don't surface it.
  useEffect(() => {
    void preloadTerminalFont()
  }, [])

  const projection = useTerminalSessionProjection()

  // Projection state sync
  useEffect(() => {
    projection.setRuntimeMembershipIndex(runtimeMembershipIndex)
    projection.setPreferredSelectedTerminalSessionIds(selectedTerminalSessionIdByTerminalWorktree)
  }, [projection, runtimeMembershipIndex, selectedTerminalSessionIdByTerminalWorktree])

  // Projection event wiring (singleton lifecycle, see terminal-roadmap.md P1.7).
  // The projection is client-level; we only subscribe / unsubscribe client
  // events on mount/unmount. We do NOT destroy the projection — the singleton
  // outlives the Provider. StrictMode re-mounts simply re-register the same
  // listeners against the same instance.
  useEffect(() => {
    const offOutput = terminalClient.onOutput((event) => {
      projection.handleOutput(event)
    })
    const offBell = terminalClient.onBell((event) => {
      projection.handleServerBell(event)
    })
    const offTitle = terminalClient.onTitle((event) => {
      projection.handleServerTitle(event)
    })
    const offExit = terminalClient.onExit((event) => {
      projection.handleExit(event)
    })
    const offIdentity = terminalClient.onIdentity((event) => {
      projection.handleIdentity(event)
    })
    const offLifecycle = terminalClient.onLifecycle((event) => {
      projection.handleLifecycle(event)
    })
    // Per-session close broadcast. Sibling windows drop matching local
    // entries immediately. A window that owns an in-flight command close
    // keeps its projection visible until that close command settles.
    const offSessionClosed = terminalClient.onSessionClosed((event) => {
      projection.handleSessionClosed(event)
      const repoRuntimeId = useReposStore.getState().repos[event.repoRoot]?.repoRuntimeId
      if (typeof repoRuntimeId === 'string') refreshWorkspacePaneTabs(event.repoRoot, repoRuntimeId)
    })

    const disposeCommandBridge = setTerminalSessionCommandBridge({
      terminalWorktreeSnapshot: projection.terminalWorktreeSnapshot,
      createTerminal: projection.createTerminal,
      createTerminalWithAdmission: projection.createTerminalWithAdmission,
      selectTerminal: projection.selectTerminal,
      closeTerminalByDescriptor: projection.closeTerminalByDescriptor,
    })

    return () => {
      offOutput()
      offBell()
      offTitle()
      offExit()
      offIdentity()
      offLifecycle()
      offSessionClosed()
      disposeCommandBridge()
    }
  }, [projection])

  const commandValue = useMemo<TerminalSessionContextValue>(
    () => ({
      createTerminal: projection.createTerminal,
      createTerminalWithAdmission: projection.createTerminalWithAdmission,
      registerHost: projection.registerHost,
      unregisterHost: projection.unregisterHost,
      selectTerminal: projection.selectTerminal,
      scrollToBottom: projection.scrollToBottom,
      scrollLines: projection.scrollLines,
      clearBell: projection.clearBell,
      closeTerminalByDescriptor: projection.closeTerminalByDescriptor,
      attach: projection.attach,
      detach: projection.detach,
      restart: projection.restart,
      focusTerminal: projection.focusTerminal,
      isTerminalFocusTarget: projection.isTerminalFocusTarget,
      findNext: projection.findNext,
      findPrevious: projection.findPrevious,
      clearSearch: projection.clearSearch,
      writeInput: projection.writeInput,
      takeover: projection.takeover,
    }),
    [projection],
  )
  const readValue = useMemo<TerminalSessionReadContextValue>(
    () => ({
      terminalWorktreeSnapshot: projection.terminalWorktreeSnapshot,
      subscribeTerminalWorktree: projection.subscribeTerminalWorktree,
      repoBellCount: projection.repoBellCount,
      subscribeRepoBellCount: projection.subscribeRepoBellCount,
      snapshot: projection.snapshot,
      subscribeSnapshot: projection.subscribeSnapshot,
    }),
    [projection],
  )

  return (
    <TerminalSessionContext value={commandValue}>
      <TerminalSessionReadContext value={readValue}>{children}</TerminalSessionReadContext>
    </TerminalSessionContext>
  )
}
