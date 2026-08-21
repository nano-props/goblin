// Read-only branch status strip. The exported icon and metadata primitives
// share the same derived branch state with the complete row.

import { defineComponent } from 'vue'
import type { FunctionalComponent, HTMLAttributes } from 'vue'
import { ArrowDown, ArrowUp, FolderTree, GitBranch } from '@lucide/vue'
import { i18nStore } from '#/web/stores/i18n.ts'
import type { Lang } from '#/shared/settings.ts'
import { useT } from '#/web/stores/i18n-vue.ts'
import type { BranchSnapshotInfo, RepoWorktreeSnapshot } from '#/shared/git-types.ts'
import type { WorktreeStatus } from '#/shared/git-types.ts'
import { Badge } from '#/web/components/ui/badge.tsx'
import { cn } from '#/web/lib/cn.ts'
import { formatRelativeTimeOrNull } from '#/web/lib/dates.ts'
import { worktreeChanges } from '#/web/stores/workspaces/worktree-state.ts'
import { TerminalBellBadge } from '#/web/terminal/components/TerminalBellBadge.tsx'
import { TerminalOutputActivityIndicator } from '#/web/terminal/components/TerminalOutputActivityIndicator.tsx'
import { useStoreSelector } from '#/web/stores/store-selector.ts'

export interface BranchSummaryInlineRepo {
  status: WorktreeStatus[] | undefined
}

interface BranchSummaryInlineProps {
  repo: BranchSummaryInlineRepo
  branch: BranchSnapshotInfo
  worktree?: RepoWorktreeSnapshot
  selected?: boolean
  leadingTerminalBellCount?: number
  leadingTerminalOutputActive?: boolean
  worktreeIconDirty?: boolean
  class?: HTMLAttributes['class']
}

const Delta: FunctionalComponent<{ direction: 'ahead' | 'behind'; count: number; label: string }> = (props) => {
  const Icon = props.direction === 'ahead' ? ArrowUp : ArrowDown
  return (
    <span
      role="img"
      aria-label={props.label}
      title={props.label}
      class={cn(
        'inline-flex items-center gap-0.5 font-mono text-xs',
        props.direction === 'ahead' ? 'text-success' : 'text-attention',
      )}
    >
      <Icon size={11} />
      {props.count}
    </span>
  )
}

// Shared by the icon, metadata strip, and accessible title.
export function computeBranchSummaryState(
  branch: BranchSnapshotInfo,
  worktree: RepoWorktreeSnapshot | undefined,
  repo: BranchSummaryInlineRepo,
  lang: Lang,
) {
  const hasWorktree = !!worktree
  const worktreeDirty = worktreeChanges(repo.status, worktree?.path)?.dirty
  const commitMeta = formatRelativeTimeOrNull(branch.lastCommitDate, lang)
  return { hasWorktree, worktreeDirty, commitMeta }
}

type BranchSummaryState = ReturnType<typeof computeBranchSummaryState>

// Mirrors the visible body in the row's title attribute.
export function buildBranchSummaryTitle(
  state: BranchSummaryState,
  branch: BranchSnapshotInfo,
  t: (key: string, params?: Record<string, string | number>) => string,
  leadingTerminalBellCount = 0,
  leadingTerminalOutputActive = false,
): string {
  const worktreeStateLabelKey = state.worktreeDirty === true ? 'branches.dirty' : 'branches.worktree'
  return [
    branch.name,
    branch.isDefault ? t('branches.default') : null,
    state.hasWorktree ? t(worktreeStateLabelKey) : null,
    leadingTerminalBellCount > 0 ? t('terminal.bell-unread-count', { count: leadingTerminalBellCount }) : null,
    leadingTerminalOutputActive ? t('terminal.output-active') : null,
    branch.trackingGone ? t('branches.gone') : null,
    branch.ahead > 0 ? t('branch-status.sync.ahead', { n: branch.ahead }) : null,
    branch.behind > 0 ? t('branch-status.sync.behind', { n: branch.behind }) : null,
    state.commitMeta,
  ]
    .filter(Boolean)
    .join(', ')
}

interface BranchSummaryIconProps {
  hasWorktree: boolean
  worktreeDirty: boolean | undefined
  selected: boolean
  // Announces worktree and dirty state when the glyph is meaningful.
  ariaLabel?: string
}

export const BranchSummaryIcon: FunctionalComponent<BranchSummaryIconProps> = (props) => {
  return (
    <span
      data-testid="branch-summary-icon"
      aria-label={props.ariaLabel}
      role={props.ariaLabel ? 'img' : undefined}
      class="flex w-4 shrink-0 items-center justify-center"
    >
      {props.hasWorktree ? (
        <FolderTree
          size={14}
          class={props.worktreeDirty === true ? 'text-attention' : 'text-brand-text'}
          aria-hidden="true"
        />
      ) : (
        <GitBranch
          size={14}
          class={props.selected ? 'text-selected-muted-foreground' : 'text-muted-foreground'}
          aria-hidden="true"
        />
      )}
    </span>
  )
}

export const BranchSummaryMeta = defineComponent<
  Pick<BranchSummaryInlineProps, 'repo' | 'branch' | 'worktree' | 'selected'>
>({
  name: 'BranchSummaryMeta',
  props: ['repo', 'branch', 'worktree', 'selected'],
  setup(props) {
    const t = useT()
    const lang = useStoreSelector(i18nStore, (state) => state.lang)

    return () => {
      const selected = props.selected ?? false
      const { commitMeta } = computeBranchSummaryState(props.branch, props.worktree, props.repo, lang.value)
      return (
        <span
          class={cn(
            'flex min-w-0 items-center gap-1.5 overflow-hidden text-xs',
            selected ? 'text-selected-muted-foreground' : 'text-muted-foreground',
          )}
        >
          {props.branch.isDefault ? (
            <Badge variant="outline" class="text-muted-foreground">
              {t('branches.default')}
            </Badge>
          ) : null}
          {props.branch.trackingGone ? <Badge variant="attention">{t('branches.gone')}</Badge> : null}
          {props.branch.ahead > 0 ? (
            <Delta
              direction="ahead"
              count={props.branch.ahead}
              label={t('branch-status.sync.ahead', { n: props.branch.ahead })}
            />
          ) : null}
          {props.branch.behind > 0 ? (
            <Delta
              direction="behind"
              count={props.branch.behind}
              label={t('branch-status.sync.behind', { n: props.branch.behind })}
            />
          ) : null}
          {commitMeta ? (
            <span
              class={cn(
                'min-w-0 truncate whitespace-nowrap text-[11px] leading-none',
                selected ? 'text-selected-muted-foreground/90' : 'text-muted-foreground/85',
              )}
              title={commitMeta}
            >
              {commitMeta}
            </span>
          ) : null}
        </span>
      )
    }
  },
})

export const BranchSummaryInline = defineComponent<BranchSummaryInlineProps>({
  name: 'BranchSummaryInline',
  props: [
    'repo',
    'branch',
    'worktree',
    'selected',
    'leadingTerminalBellCount',
    'leadingTerminalOutputActive',
    'worktreeIconDirty',
    'class',
  ],

  setup(props) {
    const t = useT()
    const lang = useStoreSelector(i18nStore, (state) => state.lang)

    return () => {
      const selected = props.selected ?? false
      const leadingTerminalBellCount = props.leadingTerminalBellCount ?? 0
      const state = computeBranchSummaryState(props.branch, props.worktree, props.repo, lang.value)
      const { hasWorktree, worktreeDirty } = state
      const iconDirty = props.worktreeIconDirty ?? worktreeDirty
      const showLeadingTerminalBell = leadingTerminalBellCount > 0
      const showLeadingTerminalOutputActive = !!props.leadingTerminalOutputActive && !showLeadingTerminalBell
      const title = buildBranchSummaryTitle(
        state,
        props.branch,
        t,
        leadingTerminalBellCount,
        showLeadingTerminalOutputActive,
      )
      const iconAriaLabel = hasWorktree ? (iconDirty ? t('branches.dirty') : t('branches.worktree')) : undefined

      return (
        <div title={title} class={cn('flex min-w-0 items-center gap-1.5', props.class)}>
          {showLeadingTerminalBell ? (
            <span class="flex w-4 shrink-0 items-center justify-center">
              <TerminalBellBadge count={leadingTerminalBellCount} />
            </span>
          ) : showLeadingTerminalOutputActive ? (
            <span class="flex w-4 shrink-0 items-center justify-center">
              <TerminalOutputActivityIndicator />
            </span>
          ) : (
            <BranchSummaryIcon
              hasWorktree={hasWorktree}
              worktreeDirty={iconDirty}
              selected={selected}
              ariaLabel={iconAriaLabel}
            />
          )}
          <span class="flex min-w-0 items-center gap-1.5 overflow-hidden">
            <span
              class={cn(
                'shrink-0 truncate text-[13px] font-normal leading-5',
                selected ? 'text-selected-foreground' : 'text-foreground',
              )}
            >
              {props.branch.name}
            </span>
            <BranchSummaryMeta repo={props.repo} branch={props.branch} selected={selected} />
          </span>
        </div>
      )
    }
  },
})
