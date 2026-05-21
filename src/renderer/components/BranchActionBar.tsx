import { useEffect, useRef } from 'react'
import { Loader2 } from 'lucide-react'
import type { RepoState } from '#/renderer/stores/repos.ts'
import { Button } from '#/renderer/components/ui/button.tsx'
import { useBranchActionItems, type BranchActionItem } from '#/renderer/hooks/useBranchActionItems.ts'
import type { BranchActionOp } from '#/renderer/hooks/useBranchActions.tsx'
import type { BranchInfo } from '#/renderer/types.ts'

interface Props {
  repo: RepoState
  branch: BranchInfo
  ghosttyInstalled: boolean
  vscodeInstalled: boolean
}

export function BranchActionBar({ repo, branch, ghosttyInstalled, vscodeInstalled }: Props) {
  const { busy, patchItems, mainItems, destructiveItems, dialogs } = useBranchActionItems(
    repo,
    branch,
    ghosttyInstalled,
    vscodeInstalled,
  )
  const visibleItems = [...patchItems, ...mainItems, ...destructiveItems].filter((item) => item.visible)
  const visibleItemsRef = useRef(visibleItems)
  visibleItemsRef.current = visibleItems

  useEffect(() => {
    const onShortcut = (event: Event) => {
      const action = (event as CustomEvent<BranchActionOp>).detail
      const item = visibleItemsRef.current.find((item) => item.id === action)
      if (!item || item.disabled) return
      item.onSelect()
    }
    window.addEventListener('gbl:branch-action-shortcut', onShortcut)
    return () => window.removeEventListener('gbl:branch-action-shortcut', onShortcut)
  }, [])

  return (
    <>
      <div className="flex min-w-0 flex-1 items-center justify-end overflow-x-auto py-1 scroll-thin">
        <div className="flex shrink-0 items-center gap-1" data-toolbar-toggle-ignore>
          {visibleItems.map((item) => (
            <BranchActionButton key={item.id} item={item} busy={busy} />
          ))}
        </div>
      </div>

      {dialogs}
    </>
  )
}

function BranchActionButton({ item, busy }: { item: BranchActionItem; busy: BranchActionItem['id'] | null }) {
  const Icon = item.Icon

  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={item.disabled}
      onClick={item.onSelect}
      title={item.title}
      aria-label={item.ariaLabel}
      className={item.destructive ? 'text-destructive hover:bg-danger-surface hover:text-destructive' : undefined}
    >
      {busy === item.id ? <Loader2 className="animate-spin" /> : <Icon />}
      {item.label}
    </Button>
  )
}
