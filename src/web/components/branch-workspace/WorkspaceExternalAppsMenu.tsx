import { ChevronDown, Loader2 } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import type { RepoBranchState } from '#/web/stores/repos/types.ts'
import { useT } from '#/web/stores/i18n.ts'
import { focusRing } from '#/web/components/ui/focus.ts'
import { Popover, PopoverContent, PopoverTrigger } from '#/web/components/ui/popover.tsx'
import type { BranchActionRepo } from '#/web/hooks/branch-action-state.ts'
import { useBranchActions } from '#/web/hooks/useBranchActions.tsx'
import { useAsyncPending } from '#/web/hooks/useAsyncPending.ts'
import { useRuntimeExternalAppSettings } from '#/web/runtime-settings-external-apps.ts'
import { remoteRepoTarget } from '#/web/stores/repos/helpers.ts'
import { useHostInfoStore } from '#/web/stores/host-info.ts'
import {
  WORKSPACE_EXTERNAL_APPS,
  workspaceExternalAppAvailable,
  type WorkspaceExternalAppItem,
} from '#/web/external-workspace-apps.tsx'
import {
  readRecentWorkspaceExternalAppId,
  writeRecentWorkspaceExternalAppId,
} from '#/web/workspace-external-apps-recent.ts'
import { cn } from '#/web/lib/cn.ts'

interface Props {
  repo: BranchActionRepo
  branch: RepoBranchState
}

export function WorkspaceExternalAppsMenu({ repo, branch }: Props) {
  const t = useT()
  const worktreePath = branch.worktree?.path
  const [open, setOpen] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)
  const { pending, run } = useAsyncPending<string>()
  const { blocked, capabilities, actions } = useBranchActions(repo, branch)
  const externalApps = useRuntimeExternalAppSettings()
  const hostPlatform = useHostInfoStore((state) => state.snapshot?.platform ?? 'web')
  const isRemoteRepo = remoteRepoTarget(repo.id, repo.remote.lifecycle) !== null
  const finderAvailable = capabilities.canOpenFinder && hostPlatform === 'darwin'
  const [recentItemId, setRecentItemId] = useState<string | null>(() => readRecentWorkspaceExternalAppId())

  const visibleItems = useMemo(
    () =>
      WORKSPACE_EXTERNAL_APPS.filter((item) =>
        workspaceExternalAppItemVisible({
          item,
          capabilities,
          externalApps,
          finderAvailable,
          isRemoteRepo,
        }),
      ),
    [capabilities, externalApps, finderAvailable, isRemoteRepo],
  )
  const primaryItem = useMemo(
    () => selectPrimaryWorkspaceExternalApp(visibleItems, recentItemId),
    [recentItemId, visibleItems],
  )

  if (!worktreePath || !primaryItem || visibleItems.length === 0) return null

  const busy = pending !== null || blocked
  const menuLabel = t('workspace.external-apps.open')

  function runItem(item: WorkspaceExternalAppItem) {
    if (busy) return
    setOpen(false)
    setRecentItemId(item.id)
    writeRecentWorkspaceExternalAppId(item.id)
    void run(item.id, () => {
      if (item.kind === 'terminal') return actions.openTerminal(item.app)
      if (item.kind === 'editor') return actions.openEditor(item.app)
      return actions.openFinder()
    })
  }

  const PrimaryIcon = primaryItem.Icon
  const primaryLabel = t(primaryItem.labelKey)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div
        className="inline-flex h-7 shrink-0 overflow-hidden rounded-md border border-separator bg-control shadow-xs"
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className={cn(
            'flex h-full w-8 cursor-pointer items-center justify-center outline-none transition-colors duration-100 hover:bg-control-hover disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
            focusRing,
          )}
          title={primaryLabel}
          aria-label={primaryLabel}
          aria-busy={busy ? true : undefined}
          disabled={busy}
          onClick={() => runItem(primaryItem)}
        >
          {pending === primaryItem.id ? <Loader2 className="animate-spin" /> : <PrimaryIcon />}
        </button>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              'flex h-full w-6 cursor-pointer items-center justify-center text-muted-foreground outline-none transition-colors duration-100 hover:bg-control-hover hover:text-foreground disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-3.5 [&_svg]:shrink-0',
              focusRing,
            )}
            title={menuLabel}
            aria-label={menuLabel}
            aria-busy={busy ? true : undefined}
            disabled={busy}
          >
            <ChevronDown />
          </button>
        </PopoverTrigger>
      </div>
      <PopoverContent
        align="end"
        className="w-max min-w-48 max-w-72 overflow-hidden p-0"
        ref={contentRef}
        tabIndex={-1}
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          contentRef.current?.focus({ preventScroll: true })
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="space-y-0.5 p-1" role="list">
          {visibleItems.map((item) => (
            <div key={item.id} role="listitem">
              <WorkspaceExternalAppsItem
                item={item}
                pending={pending}
                selected={item.id === primaryItem.id}
                onSelect={() => runItem(item)}
              />
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function WorkspaceExternalAppsItem({
  item,
  pending,
  selected,
  onSelect,
}: {
  item: WorkspaceExternalAppItem
  pending: string | null
  selected: boolean
  onSelect: () => void
}) {
  const t = useT()
  const Icon = item.Icon
  return (
    <button
      type="button"
      title={t(item.labelKey)}
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        'flex h-8 w-full cursor-pointer items-center gap-2 rounded-sm py-1 pl-2 pr-2 text-left text-sm outline-none transition-colors duration-100 hover:bg-accent hover:text-accent-foreground',
        focusRing,
      )}
    >
      <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground [&_svg]:size-4 [&_svg]:shrink-0">
        {pending === item.id ? <Loader2 size={16} className="animate-spin" /> : <Icon className="size-4" />}
      </span>
      <span className="min-w-0 flex-1 truncate">{t(item.labelKey)}</span>
    </button>
  )
}

function workspaceExternalAppItemVisible({
  item,
  capabilities,
  externalApps,
  finderAvailable,
  isRemoteRepo,
}: {
  item: WorkspaceExternalAppItem
  capabilities: ReturnType<typeof useBranchActions>['capabilities']
  externalApps: ReturnType<typeof useRuntimeExternalAppSettings>
  finderAvailable: boolean
  isRemoteRepo: boolean
}): boolean {
  if (isRemoteRepo && !item.supportsRemote) return false
  if (item.kind === 'terminal' && !capabilities.canOpenTerminal) return false
  if (item.kind === 'editor' && !capabilities.canOpenEditor) return false
  if (item.kind === 'finder' && !capabilities.canOpenFinder) return false
  return workspaceExternalAppAvailable(item, {
    terminals: externalApps.terminalAppAvailability,
    editors: externalApps.editorAppAvailability,
    finder: finderAvailable,
  })
}

function selectPrimaryWorkspaceExternalApp(
  visibleItems: readonly WorkspaceExternalAppItem[],
  recentItemId: string | null,
): WorkspaceExternalAppItem | null {
  const recentItem = visibleItems.find((item) => item.id === recentItemId)
  if (recentItem) return recentItem

  return visibleItems[0] ?? null
}
