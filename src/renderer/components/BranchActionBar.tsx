import { Loader2 } from 'lucide-react'
import type { RepoState } from '#/renderer/stores/repos.ts'
import { Button } from '#/renderer/components/ui/button.tsx'
import { useBranchActionItems, type BranchActionItem } from '#/renderer/hooks/useBranchActionItems.ts'
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

  return (
    <>
      <div className="flex min-w-0 flex-1 items-center justify-end gap-1 overflow-x-auto py-1 scroll-thin">
        {visibleItems.map((item) => (
          <BranchActionButton key={item.id} item={item} busy={busy} />
        ))}
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
