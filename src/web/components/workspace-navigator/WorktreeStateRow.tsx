import { GitCommitHorizontal } from '@lucide/vue'
import { computed, defineComponent } from 'vue'
import type { PropType } from 'vue'
import type { RepoWorktreeSnapshot } from '#/shared/git-types.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { formatTerminalFilesystemTargetKeyForPath } from '#/shared/terminal-filesystem-target-key.ts'
import { NavigatorRow } from '#/web/components/workspace-navigator/NavigatorRow.tsx'
import { TerminalBellBadge } from '#/web/components/terminal/TerminalBellBadge.tsx'
import { TerminalOutputActivityIndicator } from '#/web/components/terminal/TerminalOutputActivityIndicator.tsx'
import {
  useTerminalFilesystemTargetBellCount,
  useTerminalFilesystemTargetOutputActive,
} from '#/web/components/terminal/terminal-session-store.ts'
import type { ElementRef } from '#/web/components/ui/refs.ts'
import { useT } from '#/web/stores/i18n-vue.ts'
import { worktreePresentationLabel } from '#/web/worktree-presentation.ts'

interface WorktreeStateRowProps {
  workspaceId: WorkspaceId
  worktree: RepoWorktreeSnapshot
  selected: boolean
  selectedRef: ElementRef<HTMLLIElement>
  onSelect: () => void
  onOpenStatus: () => void
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
  },

  setup(props) {
    const t = useT()
    const targetKey = computed(() => formatTerminalFilesystemTargetKeyForPath(props.workspaceId, props.worktree.path))
    const bellCount = useTerminalFilesystemTargetBellCount(targetKey)
    const outputActive = useTerminalFilesystemTargetOutputActive(targetKey)

    return () => {
      const label = worktreePresentationLabel(props.worktree, t)
      const shortHead = props.worktree.headOid?.slice(0, 7) ?? ''
      const metadata = props.worktree.operation ? `${shortHead} · ${props.worktree.path}` : props.worktree.path
      return (
        <NavigatorRow
          rowRef={props.selected ? props.selectedRef : undefined}
          selected={props.selected}
          onClick={props.onSelect}
          onDblclick={props.onOpenStatus}
          content={
            <div class="flex min-w-0 items-center gap-1.5" title={`${label}, ${metadata}`}>
              <span class="flex w-4 shrink-0 items-center justify-center">
                <GitCommitHorizontal size={14} class="text-warning" aria-hidden="true" />
              </span>
              <span class="flex min-w-0 items-center gap-1.5 overflow-hidden">
                <span class="shrink-0 truncate text-[13px] font-normal leading-5" title={label}>
                  {label}
                </span>
                <span
                  class="min-w-0 truncate whitespace-nowrap text-xs text-muted-foreground"
                  title={props.worktree.path}
                >
                  {metadata}
                </span>
              </span>
            </div>
          }
          actions={
            <span class="flex items-center gap-1">
              {bellCount.value > 0 ? <TerminalBellBadge count={bellCount.value} /> : null}
              {bellCount.value === 0 && outputActive.value ? <TerminalOutputActivityIndicator /> : null}
            </span>
          }
        />
      )
    }
  },
})
