import { GitCommitHorizontal } from '@lucide/vue'
import { computed, defineComponent } from 'vue'
import type { PropType } from 'vue'
import type { RepoWorktreeSnapshot } from '#/shared/git-types.ts'
import type { WorkspacePaneStaticTabType } from '#/shared/workspace-pane.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { formatTerminalFilesystemTargetKeyForPath } from '#/shared/terminal-filesystem-target-key.ts'
import { NavigatorRow } from '#/web/components/workspace-navigator/NavigatorRow.tsx'
import { TerminalBellBadge } from '#/web/terminal/components/TerminalBellBadge.tsx'
import { TerminalOutputActivityIndicator } from '#/web/terminal/components/TerminalOutputActivityIndicator.tsx'
import {
  useTerminalFilesystemTargetBellCount,
  useTerminalFilesystemTargetOutputActive,
} from '#/web/terminal/components/terminal-session-store.ts'
import type { ElementRef } from '#/web/components/ui/refs.ts'
import { useT } from '#/web/stores/i18n-vue.ts'
import { worktreePresentationLabel } from '#/web/repos/worktree-presentation.ts'
import { useIsCompactUi } from '#/web/hooks/useResponsiveUiMode.tsx'
import { NavigatorRowActionSlot } from '#/web/components/workspace-navigator/NavigatorRowActionSlot.tsx'
import { WorktreeActionsMenu } from '#/web/components/workspace-navigator/WorktreeActionsMenu.tsx'

interface WorktreeStateRowProps {
  workspaceId: WorkspaceId
  worktree: RepoWorktreeSnapshot
  selected: boolean
  selectedRef: ElementRef<HTMLLIElement>
  onSelect: () => void
  onOpenStatus: () => void
  onOpenTab: (type: WorkspacePaneStaticTabType) => void
  actionMenuOpen?: boolean
  onActionMenuOpenChange?: (open: boolean) => void
}

export const WorktreeStateRow = defineComponent<WorktreeStateRowProps>({
  name: 'WorktreeStateRow',
  props: {
    workspaceId: { type: null, required: true },
    worktree: { type: Object as PropType<RepoWorktreeSnapshot>, required: true },
    selected: Boolean,
    selectedRef: { type: null, required: true },
    onSelect: { type: Function as PropType<() => void>, required: true },
    onOpenStatus: { type: Function as PropType<() => void>, required: true },
    onOpenTab: { type: Function as PropType<(type: WorkspacePaneStaticTabType) => void>, required: true },
    actionMenuOpen: Boolean,
    onActionMenuOpenChange: Function as PropType<(open: boolean) => void>,
  },

  setup(props) {
    const t = useT()
    const compact = useIsCompactUi()
    const targetKey = computed(() => formatTerminalFilesystemTargetKeyForPath(props.workspaceId, props.worktree.path))
    const bellCount = useTerminalFilesystemTargetBellCount(targetKey)
    const outputActive = useTerminalFilesystemTargetOutputActive(targetKey)

    return () => {
      const label = worktreePresentationLabel(props.worktree, t)
      const shortHead = props.worktree.headOid?.slice(0, 7) ?? ''
      const metadata = props.worktree.operation ? shortHead : null
      const actionHidden = !compact.value && !props.actionMenuOpen
      const leadingTerminalBellCount = compact.value ? bellCount.value : 0
      const leadingTerminalOutputActive = compact.value && bellCount.value <= 0 && outputActive.value
      const actionTerminalBellCount = compact.value ? 0 : bellCount.value
      const actionTerminalOutputActive = !compact.value && bellCount.value <= 0 && outputActive.value
      return (
        <NavigatorRow
          rowRef={props.selected ? props.selectedRef : undefined}
          selected={props.selected}
          onClick={props.onSelect}
          onDblclick={props.onOpenStatus}
          content={
            <div class="flex min-w-0 items-center gap-1.5" title={label}>
              <span class="flex w-4 shrink-0 items-center justify-center">
                <GitCommitHorizontal size={14} class="text-warning" aria-hidden="true" />
              </span>
              {leadingTerminalBellCount > 0 ? <TerminalBellBadge count={leadingTerminalBellCount} /> : null}
              {leadingTerminalOutputActive ? <TerminalOutputActivityIndicator /> : null}
              <span class="flex min-w-0 items-center gap-1.5 overflow-hidden">
                <span class="shrink-0 truncate text-[13px] font-normal leading-5" title={label}>
                  {label}
                </span>
                {metadata ? <span class="truncate text-xs text-muted-foreground">{metadata}</span> : null}
              </span>
            </div>
          }
          actions={
            <NavigatorRowActionSlot
              actionHidden={actionHidden}
              terminalBellCount={actionTerminalBellCount}
              terminalOutputActive={actionTerminalOutputActive}
              action={
                <WorktreeActionsMenu
                  open={props.actionMenuOpen}
                  onOpenChange={props.onActionMenuOpenChange}
                  onOpenTab={props.onOpenTab}
                />
              }
            />
          }
        />
      )
    }
  },
})
