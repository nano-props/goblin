import { ShieldCheck } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from '#/web/components/ui/alert-dialog.tsx'
import { Button } from '#/web/components/ui/button.tsx'
import { ConfirmCheckbox } from '#/web/components/ConfirmCheckbox.tsx'
import { useT } from '#/web/stores/i18n.ts'
import type { WorktreeBootstrapPreview } from '#/shared/worktree-bootstrap-summary.ts'

interface Props {
  open: boolean
  preview: WorktreeBootstrapPreview | null
  rememberRun: boolean
  onRememberRunChange: (checked: boolean) => void
  onCancel: () => void
  onRun: () => void
  onSkip: () => void
}

export function WorktreeBootstrapConfirmDialog({
  open,
  preview,
  rememberRun,
  onRememberRunChange,
  onCancel,
  onRun,
  onSkip,
}: Props) {
  const t = useT()
  const rows = preview ? bootstrapRows(preview, t) : []

  return (
    <AlertDialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia>
            <ShieldCheck aria-hidden="true" className="text-muted-foreground" />
          </AlertDialogMedia>
          <AlertDialogTitle>{t('action.create-worktree-bootstrap-title')}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3 text-sm leading-relaxed text-muted-foreground">
              <p>{t('action.create-worktree-bootstrap-body')}</p>
              {rows.length > 0 && (
                <dl className="grid gap-2 border-y py-2 text-xs">
                  {rows.map((row) => (
                    <div key={row.label} className="grid grid-cols-[1fr_auto] items-center gap-3">
                      <dt>{row.label}</dt>
                      <dd className="font-mono text-foreground tabular-nums">{row.value}</dd>
                    </div>
                  ))}
                </dl>
              )}
              {preview?.setup && (
                <div className="space-y-1">
                  <span className="block text-xs">{t('action.create-worktree-bootstrap-setup-label')}</span>
                  <code className="block max-h-24 overflow-auto rounded-md bg-muted px-2 py-1.5 font-mono text-xs break-all text-foreground">
                    {preview.setup.command}
                  </code>
                </div>
              )}
              <ConfirmCheckbox checked={rememberRun} onCheckedChange={onRememberRunChange}>
                {t('action.create-worktree-bootstrap-remember')}
              </ConfirmCheckbox>
              <p className="text-xs">{t('action.create-worktree-bootstrap-note')}</p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button size="sm" variant="outline" onClick={onSkip}>
            {t('action.create-worktree-bootstrap-skip')}
          </Button>
          <Button size="sm" onClick={onRun}>
            {t('action.create-worktree-bootstrap-run')}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function bootstrapRows(preview: WorktreeBootstrapPreview, t: (key: string) => string) {
  const rows: Array<{ label: string; value: number }> = []
  if (preview.copyCount > 0)
    rows.push({ label: t('action.create-worktree-bootstrap-copy-label'), value: preview.copyCount })
  if (preview.symlinkCount > 0)
    rows.push({ label: t('action.create-worktree-bootstrap-symlink-label'), value: preview.symlinkCount })
  if (preview.hardlinkCount > 0)
    rows.push({ label: t('action.create-worktree-bootstrap-hardlink-label'), value: preview.hardlinkCount })
  if (preview.excludeCount > 0)
    rows.push({ label: t('action.create-worktree-bootstrap-exclude-label'), value: preview.excludeCount })
  return rows
}
