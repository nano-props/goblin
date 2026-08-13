import { GitCommitHorizontal } from '@lucide/vue'
import { computed, defineComponent } from 'vue'
import type { PropType } from 'vue'
import type { RepoWorktreeSnapshot } from '#/shared/git-types.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { formatTerminalFilesystemTargetKeyForPath } from '#/shared/terminal-filesystem-target-key.ts'
import { NavigatorRow } from '#/web/components/branch-navigator/NavigatorRow.tsx'
import { TerminalBellBadge } from '#/web/components/terminal/TerminalBellBadge.tsx'
import { TerminalOutputActivityIndicator } from '#/web/components/terminal/TerminalOutputActivityIndicator.tsx'
import {
  useTerminalFilesystemTargetBellCount,
  useTerminalFilesystemTargetOutputActive,
} from '#/web/components/terminal/terminal-session-store.ts'
import type { ElementRef } from '#/web/components/ui/refs.ts'
import { useT } from '#/web/stores/i18n-vue.ts'

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
      const shortHead = props.worktree.headOid.slice(0, 7)
      return (
        <NavigatorRow
          rowRef={props.selected ? props.selectedRef : undefined}
          selected={props.selected}
          onClick={props.onSelect}
          onDblclick={props.onOpenStatus}
          contentClass="gap-2"
          content={
            <>
              <GitCommitHorizontal size={15} class="shrink-0 text-warning" />
              <span class="min-w-0 flex-1">
                <span class="block truncate text-sm font-medium" title={label}>
                  {label}
                </span>
                <span class="block truncate text-[10px] text-muted-foreground" title={props.worktree.path}>
                  {shortHead} · {props.worktree.path}
                </span>
              </span>
            </>
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

type Translator = (key: string, params?: Record<string, string | number>) => string

export function worktreePresentationLabel(worktree: RepoWorktreeSnapshot, t: Translator): string {
  if (worktree.head.kind === 'branch' && !worktree.operation) return worktree.head.branchName
  const operation = worktree.operation
  if (!operation) return t('worktree-state.detached')
  if (operation.kind === 'rebase') {
    return worktree.materializedBranch
      ? t('worktree-state.rebase-branch', { branch: worktree.materializedBranch })
      : t('worktree-state.rebase')
  }
  const operationKey = WORKTREE_OPERATION_KEYS[operation.kind]
  return t(operationKey)
}

const WORKTREE_OPERATION_KEYS = {
  merge: 'worktree-state.merge',
  'cherry-pick': 'worktree-state.cherry-pick',
  revert: 'worktree-state.revert',
  bisect: 'worktree-state.bisect',
} as const
