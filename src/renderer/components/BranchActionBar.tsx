import { ArrowDown, ArrowUp, ClipboardCopy, ExternalLink, GitBranch, Loader2, Terminal, Trash2 } from 'lucide-react'
import type { RepoState } from '#/renderer/stores/repos.ts'
import { useT } from '#/renderer/stores/i18n.ts'
import { Button } from '#/renderer/components/ui/button.tsx'
import { useBranchActions } from '#/renderer/hooks/useBranchActions.tsx'
import type { BranchInfo } from '#/renderer/types.ts'

interface Props {
  repo: RepoState
  branch: BranchInfo
  ghosttyInstalled: boolean
}

export function BranchActionBar({ repo, branch, ghosttyInstalled }: Props) {
  const t = useT()
  const { busy, capabilities, actions, dialogs } = useBranchActions(repo, branch)

  return (
    <>
      <div className="flex min-w-0 flex-1 items-center justify-end gap-1 overflow-x-auto py-1 scroll-thin">
        {capabilities.canCopyPatch && (
          <Button
            variant="ghost"
            size="sm"
            disabled={!!busy}
            onClick={actions.copyPatch}
            title={t('status.copyPatchTitle')}
            aria-label={t('status.copyPatchTitle')}
          >
            {busy === 'copyPatch' ? <Loader2 className="animate-spin" /> : <ClipboardCopy />}
            {t('status.copyPatch')}
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          disabled={capabilities.isCurrent || capabilities.checkedOutInAnotherWorktree || !!busy}
          onClick={actions.checkout}
        >
          {busy === 'checkout' ? <Loader2 className="animate-spin" /> : <GitBranch />}
          {t('action.checkout')}
        </Button>
        <Button variant="ghost" size="sm" disabled={!capabilities.canPull || !!busy} onClick={actions.pull}>
          {busy === 'pull' ? <Loader2 className="animate-spin" /> : <ArrowDown />}
          {t('action.pull')}
        </Button>
        <Button variant="ghost" size="sm" disabled={!!busy} onClick={actions.push}>
          {busy === 'push' ? <Loader2 className="animate-spin" /> : <ArrowUp />}
          {t('action.push')}
        </Button>
        {capabilities.canOpenGhostty && ghosttyInstalled && (
          <Button variant="ghost" size="sm" disabled={!!busy} onClick={actions.openGhostty}>
            {busy === 'ghostty' ? <Loader2 className="animate-spin" /> : <Terminal />}
            {t('worktrees.openInGhosttyLabel')}
          </Button>
        )}
        <Button variant="ghost" size="sm" disabled={!!busy} onClick={actions.openGitHub}>
          {busy === 'github' ? <Loader2 className="animate-spin" /> : <ExternalLink />}
          {t('action.github')}
        </Button>
        {capabilities.canRemoveWorktree && (
          <Button
            variant="ghost"
            size="sm"
            disabled={!!busy}
            onClick={actions.requestRemoveWorktree}
            className="text-destructive hover:bg-danger-surface hover:text-destructive"
          >
            {busy === 'removeWorktree' ? <Loader2 className="animate-spin" /> : <Trash2 />}
            {t('action.removeWorktree')}
          </Button>
        )}
        {capabilities.isRegularBranch && (
          <Button
            variant="ghost"
            size="sm"
            disabled={!!busy}
            onClick={actions.requestDeleteBranch}
            className="text-destructive hover:bg-danger-surface hover:text-destructive"
          >
            {busy === 'deleteBranch' ? <Loader2 className="animate-spin" /> : <Trash2 />}
            {t('action.deleteBranch')}
          </Button>
        )}
      </div>

      {dialogs}
    </>
  )
}
