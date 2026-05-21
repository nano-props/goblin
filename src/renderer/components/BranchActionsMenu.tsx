import { ChevronDown, Loader2 } from 'lucide-react'
import type { RepoState } from '#/renderer/stores/repos/types.ts'
import { useT } from '#/renderer/stores/i18n.ts'
import { Button } from '#/renderer/components/ui/button.tsx'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/renderer/components/ui/dropdown-menu.tsx'
import { useBranchActionItems, type BranchActionItem } from '#/renderer/hooks/useBranchActionItems.ts'
import type { BranchInfo } from '#/renderer/types.ts'

interface Props {
  repo: RepoState
  branch: BranchInfo
  ghosttyInstalled: boolean
  vscodeInstalled: boolean
}

export function BranchActionsMenu({ repo, branch, ghosttyInstalled, vscodeInstalled }: Props) {
  const t = useT()
  const { busy, patchItems, mainItems, destructiveItems, dialogs } = useBranchActionItems(
    repo,
    branch,
    ghosttyInstalled,
    vscodeInstalled,
  )
  const visiblePatchItems = patchItems.filter((item) => item.visible)
  const visibleMainItems = mainItems.filter((item) => item.visible)
  const visibleDestructiveItems = destructiveItems.filter((item) => item.visible)

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="data-[state=open]:bg-accent data-[state=open]:text-accent-foreground"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            {busy ? <Loader2 className="animate-spin" /> : <ChevronDown />}
            {t('action.menu')}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
          {visiblePatchItems.length > 0 && (
            <>
              {visiblePatchItems.map((item) => (
                <BranchActionMenuItem key={item.id} item={item} busy={busy} />
              ))}
              <DropdownMenuSeparator />
            </>
          )}
          {visibleMainItems.map((item) => (
            <BranchActionMenuItem key={item.id} item={item} busy={busy} />
          ))}
          {visibleDestructiveItems.length > 0 && (
            <>
              <DropdownMenuSeparator />
              {visibleDestructiveItems.map((item) => (
                <BranchActionMenuItem key={item.id} item={item} busy={busy} />
              ))}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {dialogs}
    </>
  )
}

function BranchActionMenuItem({ item, busy }: { item: BranchActionItem; busy: BranchActionItem['id'] | null }) {
  const Icon = item.Icon

  return (
    <DropdownMenuItem
      disabled={item.disabled}
      onClick={item.onSelect}
      variant={item.destructive ? 'destructive' : 'default'}
    >
      {busy === item.id ? <Loader2 className="animate-spin" /> : <Icon />}
      {item.label}
    </DropdownMenuItem>
  )
}
