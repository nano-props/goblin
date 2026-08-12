import { AlertCircle, SquareTerminal } from '@lucide/vue'
import { computed, defineComponent, ref } from 'vue'
import type { VNodeChild } from 'vue'
import { toast } from 'vue-sonner'
import { Button } from '#/web/components/ui/button.tsx'
import { terminalExecutionPath, terminalPresentationBranch } from '#/shared/terminal-types.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { TerminalBellBadge } from '#/web/components/terminal/TerminalBellBadge.tsx'
import { TerminalOutputActivityIndicator } from '#/web/components/terminal/TerminalOutputActivityIndicator.tsx'
import {
  useTerminalWorkspaceProjectionHydrationEntry,
  useWorkspaceTerminalSessions,
} from '#/web/components/terminal/terminal-session-store.ts'
import type { WorkspaceTerminalSessionSummary } from '#/web/components/terminal/types.ts'
import { DashboardEmptySection, DashboardSection } from '#/web/components/workspace-pages/dashboard-ui.tsx'
import { useAppNavigation } from '#/web/app-navigation.tsx'
import type { AppNavigationActions } from '#/web/app-navigation-actions.ts'
import { cn } from '#/web/lib/cn.ts'
import { useT } from '#/web/stores/i18n-vue.ts'
import { useTerminalProjectionRecoveryActions } from '#/web/runtime/terminal-projection-recovery-context.ts'
import { useStoreSelector } from '#/web/stores/store-selector.ts'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'
import { useRepoSnapshotReadModel } from '#/web/repo-queries.ts'
import { useWorkspacePaneTabsQuery } from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import { orderWorkspaceDashboardTerminals } from '#/web/components/workspace-pages/workspace-dashboard-terminal-order.ts'
import {
  gitWorktreePaneTargetLease,
  workspaceRootPaneTargetLease,
  type FilesystemWorkspacePaneTargetLease,
} from '#/web/workspace-pane/workspace-pane-tab-target.ts'
import { clearWorkspacePaneTabOpener } from '#/web/workspace-pane/workspace-pane-tab-opener.ts'
import { workspacePaneTabEntryIdentity } from '#/shared/workspace-pane.ts'
import {
  commitWorkspacePaneTerminalDestination,
} from '#/web/workspace-pane/workspace-pane-terminal-destination-navigation.ts'
import { surfaceWorkspacePaneTerminalDestinationOutcome } from '#/web/workspace-pane/workspace-pane-terminal-destination-feedback.ts'
import type { WorkspacePaneActionOutcome } from '#/web/workspace-pane/workspace-pane-action-outcome.ts'

export const WorkspaceDashboardTerminals = defineComponent<{ workspaceId: WorkspaceId }>({
  name: 'WorkspaceDashboardTerminals',
  props: ['workspaceId'],

  setup(props) {
    const t = useT()
    const navigation = useAppNavigation()
    const recovery = useTerminalProjectionRecoveryActions()
    const sessions = useWorkspaceTerminalSessions(() => props.workspaceId)
    const hydration = useTerminalWorkspaceProjectionHydrationEntry(() => props.workspaceId)
    const openingTerminal = ref<{
      workspaceId: WorkspaceId
      workspaceRuntimeId: string
      terminalSessionId: string
    } | null>(null)
    const workspaces = useStoreSelector(workspacesStore, (state) => state.workspaces)
    const workspace = computed(() => workspaces.value[props.workspaceId] ?? null)
    const workspaceRuntimeId = computed(() => workspace.value?.workspaceRuntimeId ?? '')
    const hasWorkspaceRuntime = computed(() => workspaceRuntimeId.value.length > 0)
    const repoSnapshot = useRepoSnapshotReadModel(
      () => props.workspaceId,
      workspaceRuntimeId,
      { enabled: computed(() => hasWorkspaceRuntime.value && workspace.value?.capability.kind === 'git') },
    )
    const paneTabs = useWorkspacePaneTabsQuery(() => props.workspaceId, workspaceRuntimeId, {
      enabled: hasWorkspaceRuntime,
    })
    const orderedSessions = computed(() =>
      orderWorkspaceDashboardTerminals({
        workspaceId: props.workspaceId,
        sessions: sessions.value,
        branches: repoSnapshot.data.value?.snapshot.branches ?? [],
        paneTabs: paneTabs.data.value,
      }),
    )
    const description = computed(() => {
      if (hydration.value.phase === 'failed') return t('dashboard.terminals.unavailable')
      if (hydration.value.phase === 'pending') return t('dashboard.terminals.loading')
      return t('dashboard.terminals.description', { count: orderedSessions.value.length })
    })

    async function openTerminal(session: WorkspaceTerminalSessionSummary): Promise<void> {
      const pending = terminalOpeningLease(session)
      if (sameTerminalOpeningScope(openingTerminal.value, pending)) return
      if (hydration.value.phase === 'failed') {
        toast.warning(t('dashboard.terminals.stale'))
        return
      }
      openingTerminal.value = pending
      try {
        const outcome = await commitTerminalRoute(navigation, session)
        surfaceWorkspacePaneTerminalDestinationOutcome(outcome)
      } catch (error) {
        surfaceWorkspacePaneTerminalDestinationOutcome(null, error)
      } finally {
        if (sameTerminalOpeningLease(openingTerminal.value, pending)) openingTerminal.value = null
      }
    }

    function renderContent(): VNodeChild {
      if (hydration.value.phase === 'failed' && orderedSessions.value.length === 0) {
        return (
          <div
            class="flex min-h-24 flex-col items-center justify-center gap-3 px-4 py-6 text-sm text-destructive"
            role="alert"
          >
            <span class="flex items-center gap-2">
              <AlertCircle size={16} />
              <span>{t('terminal.restore-failed')}</span>
            </span>
            {renderRetryButton()}
          </div>
        )
      }
      if (hydration.value.phase !== 'ready' && orderedSessions.value.length === 0) {
        return (
          <div
            class="flex min-h-24 items-center justify-center gap-2 px-4 py-6 text-sm text-muted-foreground"
            role="status"
          >
            <SquareTerminal size={16} class="animate-pulse" />
            <span>{t('dashboard.terminals.loading')}</span>
          </div>
        )
      }
      if (orderedSessions.value.length === 0) {
        return <DashboardEmptySection icon={SquareTerminal} label={t('terminal.empty')} />
      }
      return (
        <div>
          {renderStaleProjectionNotice()}
          <div class="divide-y divide-separator">{orderedSessions.value.map(renderTerminalRow)}</div>
        </div>
      )
    }

    function renderStaleProjectionNotice(): VNodeChild {
      if (hydration.value.phase !== 'failed') return null
      return (
        <div
          class="flex items-center gap-2 border-b border-warning-border bg-warning-surface px-3 py-2 text-xs text-warning"
          role="alert"
        >
          <AlertCircle size={14} class="shrink-0" />
          <span class="min-w-0 flex-1">{t('dashboard.terminals.stale')}</span>
          {renderRetryButton()}
        </div>
      )
    }

    function renderRetryButton(): VNodeChild {
      return (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          class="h-6 shrink-0 px-2 text-xs"
          onClick={() => recovery.retryWorkspace(props.workspaceId)}
        >
          {t('error.try-again')}
        </Button>
      )
    }

    function renderTerminalRow(session: WorkspaceTerminalSessionSummary): VNodeChild {
      const opening = sameTerminalOpeningLease(openingTerminal.value, terminalOpeningLease(session))
      const target = terminalTargetLabel(session, t)
      const titleId = `dashboard-terminal-title-${session.terminalSessionId}`
      const detailsId = `dashboard-terminal-details-${session.terminalSessionId}`
      const statusId = `dashboard-terminal-status-${session.terminalSessionId}`
      const statusText = terminalStatusText(session, t)
      let errorBadge: VNodeChild = null
      let bellBadge: VNodeChild = null
      let outputActivity: VNodeChild = null
      if (session.phase === 'error') {
        errorBadge = (
          <span class="shrink-0 text-[10px] font-medium uppercase tracking-wide text-destructive">
            {t('dashboard.terminals.error')}
          </span>
        )
      }
      if (session.hasBell) bellBadge = <TerminalBellBadge count={1} />
      if (session.hasRecentOutput) outputActivity = <TerminalOutputActivityIndicator />

      return (
        <button
          key={session.terminalSessionId}
          type="button"
          class={cn(
            'group flex w-full min-w-0 items-center gap-3 px-3 py-2.5 text-left transition-colors',
            'hover:bg-accent/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/45',
          )}
          aria-labelledby={titleId}
          aria-describedby={`${detailsId} ${statusId}`}
          aria-busy={opening || undefined}
          disabled={sameTerminalOpeningScope(openingTerminal.value, terminalOpeningLease(session))}
          onClick={() => void openTerminal(session)}
        >
          <span class="flex size-7 shrink-0 items-center justify-center rounded-md border border-border/60 bg-muted/35 text-muted-foreground">
            <SquareTerminal size={15} />
          </span>
          <span class="min-w-0 flex-1">
            <span class="flex min-w-0 items-center gap-2">
              <span id={titleId} class="truncate text-[13px] font-medium text-foreground" title={session.fullTitle}>
                {session.title}
              </span>
              {errorBadge}
            </span>
            <span id={detailsId} class="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
              <span class="shrink-0">{target.label}</span>
              <span aria-hidden="true">·</span>
              <span class="truncate" title={target.path}>
                {target.path}
              </span>
            </span>
          </span>
          <span class="flex shrink-0 items-center gap-1.5">
            {bellBadge}
            {outputActivity}
          </span>
          <span id={statusId} class="sr-only">
            {statusText}
          </span>
        </button>
      )
    }

    return () => (
      <DashboardSection title={t('terminal.sessions')} description={description.value}>
        {renderContent()}
      </DashboardSection>
    )
  },
})

type DashboardTranslator = (key: string, params?: Record<string, string | number>) => string

function terminalStatusText(session: WorkspaceTerminalSessionSummary, t: DashboardTranslator): string {
  const labels: string[] = []
  if (session.phase === 'error') labels.push(t('dashboard.terminals.error'))
  if (session.hasBell) labels.push(t('terminal.bell-unread-count', { count: 1 }))
  if (session.hasRecentOutput) labels.push(t('terminal.output-active'))
  return labels.join(', ')
}

interface TerminalOpeningLease {
  workspaceId: WorkspaceId
  workspaceRuntimeId: string
  terminalSessionId: string
}

function terminalOpeningLease(session: WorkspaceTerminalSessionSummary): TerminalOpeningLease {
  return {
    workspaceId: session.base.target.workspaceId,
    workspaceRuntimeId: session.base.target.workspaceRuntimeId,
    terminalSessionId: session.terminalSessionId,
  }
}

function sameTerminalOpeningScope(left: TerminalOpeningLease | null, right: TerminalOpeningLease): boolean {
  return left?.workspaceId === right.workspaceId && left.workspaceRuntimeId === right.workspaceRuntimeId
}

function sameTerminalOpeningLease(left: TerminalOpeningLease | null, right: TerminalOpeningLease): boolean {
  return sameTerminalOpeningScope(left, right) && left?.terminalSessionId === right.terminalSessionId
}

function commitTerminalRoute(
  navigation: AppNavigationActions,
  session: WorkspaceTerminalSessionSummary,
): Promise<WorkspacePaneActionOutcome> {
  const target = dashboardTerminalTargetLease(session)
  if (!target) return Promise.resolve({ kind: 'target-missing' })
  return commitWorkspacePaneTerminalDestination({
    base: session.base,
    terminalSessionId: session.terminalSessionId,
    navigation,
  }).then((outcome) => {
    if (outcome.kind === 'completed' || outcome.kind === 'already-current') {
      clearWorkspacePaneTabOpener(
        target.routeTarget,
        target.workspaceRuntimeId,
        workspacePaneTabEntryIdentity({ type: 'terminal', runtimeSessionId: session.terminalSessionId }),
      )
    }
    return outcome
  })
}

function dashboardTerminalTargetLease(
  session: WorkspaceTerminalSessionSummary,
): FilesystemWorkspacePaneTargetLease | null {
  if (session.base.target.kind === 'workspace-root') {
    return workspaceRootPaneTargetLease(session.base.target.workspaceId, session.base.target.workspaceRuntimeId)
  }
  if (session.base.presentation.kind !== 'git-worktree') return null
  return gitWorktreePaneTargetLease(
    session.base.target.workspaceId,
    session.base.target.workspaceRuntimeId,
    terminalExecutionPath(session.base.target),
    session.base.presentation.head,
  )
}

function terminalTargetLabel(
  session: WorkspaceTerminalSessionSummary,
  t: DashboardTranslator,
): { label: string; path: string } {
  const path = terminalExecutionPath(session.base.target)
  if (session.base.target.kind === 'workspace-root') {
    return { label: t('dashboard.terminals.workspace-root'), path }
  }
  const branch = terminalPresentationBranch(session.base.presentation)
  return {
    label: branch ?? t('dashboard.terminals.detached-worktree'),
    path,
  }
}
