import { useEffect, useRef, useState } from 'react'
import { DialogFooter } from '#/web/components/ui/dialog.tsx'
import { Button } from '#/web/components/ui/button.tsx'
import { DialogStatusRow } from '#/web/components/ui/dialog-status-row.tsx'
import { FormDialog } from '#/web/components/ui/form-dialog.tsx'
import { Field, FieldLabel } from '#/web/components/ui/field.tsx'
import { Input } from '#/web/components/ui/input.tsx'
import { tildify, untildify } from '#/web/lib/paths.ts'
import { chooseLocalRepositoryPath, hasNativeDirectoryPicker } from '#/web/app-shell-client.ts'
import { useIsCompactUi } from '#/web/hooks/useResponsiveUiMode.tsx'
import { useT } from '#/web/stores/i18n.ts'
import { cn } from '#/web/lib/cn.ts'
import type { OpenRepoResult } from '#/web/stores/repos/types.ts'
interface Props {
  open: boolean
  onClose: () => void
  onOpen: (path: string) => Promise<OpenRepoResult>
}

export function OpenRepositoryDialog({ open, onClose, onOpen }: Props) {
  const t = useT()
  const compact = useIsCompactUi()
  const [path, setPath] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submitTokenRef = useRef(0)

  const trimmedPath = path.trim()
  const resolvedPath = untildify(trimmedPath)
  const canSubmit = resolvedPath.length > 0 && !pending
  const canChoosePath = hasNativeDirectoryPicker()
  const statusText = error ?? ''

  useEffect(() => {
    if (!open) return
    setPath('')
    setPending(false)
    setError(null)
    submitTokenRef.current = 0
  }, [open])

  async function choosePath() {
    if (pending || !canChoosePath) return
    try {
      const selected = await chooseLocalRepositoryPath()
      if (selected) {
        setPath(tildify(selected))
        setError(null)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error.unknown'))
    }
  }

  async function handleSubmit() {
    if (!canSubmit) return
    const token = submitTokenRef.current + 1
    submitTokenRef.current = token
    setPending(true)
    setError(null)
    let result: OpenRepoResult
    try {
      result = await onOpen(resolvedPath)
    } catch (err) {
      if (submitTokenRef.current !== token) return
      submitTokenRef.current = 0
      setPending(false)
      setError(err instanceof Error ? err.message : t('error.unknown'))
      return
    }
    if (submitTokenRef.current !== token) return
    submitTokenRef.current = 0
    if (result.ok) {
      setPending(false)
      onClose()
      return
    }
    setPending(false)
    setError(t(result.message))
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !pending) onClose()
      }}
      showCloseButton={!pending}
      title={t('repo-tabs.open-title')}
      description={t('repo-tabs.open-description')}
    >
      <form
        className="space-y-0"
        onSubmit={(event) => {
          event.preventDefault()
          void handleSubmit()
        }}
      >
        <Field>
          <FieldLabel htmlFor="open-repo-path">{t('repo-tabs.open-path-label')}</FieldLabel>
          <div className={cn('gap-2', compact ? 'flex flex-col' : 'flex')}>
            <Input
              id="open-repo-path"
              autoFocus
              disabled={pending}
              value={path}
              onChange={(event) => {
                setPath(event.target.value)
                setError(null)
              }}
              placeholder={t('repo-tabs.open-path-placeholder')}
              className="min-w-0 flex-1 font-mono text-xs"
            />
            {canChoosePath ? (
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                className={cn('h-auto self-stretch px-3', compact && 'w-full')}
                onClick={() => void choosePath()}
              >
                {t('repo-tabs.open-path-choose')}
              </Button>
            ) : null}
          </div>
          <DialogStatusRow message={statusText} tone={error ? 'danger' : 'default'} />
        </Field>

        <DialogFooter className="pt-4">
          <Button type="button" variant="outline" className={cn(compact && 'w-full')} disabled={pending} onClick={onClose}>
            {t('dialog.cancel')}
          </Button>
          <Button type="submit" className={cn(compact && 'w-full')} disabled={!canSubmit}>
            {pending ? t('repo-tabs.open-opening') : t('repo-tabs.open-local-confirm')}
          </Button>
        </DialogFooter>
      </form>
    </FormDialog>
  )
}
