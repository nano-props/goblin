import { useEffect, useRef, useState } from 'react'
import { DialogFooter } from '#/renderer/components/ui/dialog.tsx'
import { Button } from '#/renderer/components/ui/button.tsx'
import { DialogError } from '#/renderer/components/ui/dialog-error.tsx'
import { FormDialog } from '#/renderer/components/ui/form-dialog.tsx'
import { Field, FieldDescription, FieldLabel } from '#/renderer/components/ui/field.tsx'
import { Input } from '#/renderer/components/ui/input.tsx'
import { tildify, untildify } from '#/renderer/lib/paths.ts'
import { rpc } from '#/renderer/rpc.ts'
import { useT } from '#/renderer/stores/i18n.ts'
import type { OpenRepoResult } from '#/renderer/stores/repos/types.ts'

interface Props {
  open: boolean
  onClose: () => void
  onOpen: (path: string) => Promise<OpenRepoResult>
}

export function OpenRepositoryDialog({ open, onClose, onOpen }: Props) {
  const t = useT()
  const [path, setPath] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submitTokenRef = useRef(0)

  const trimmedPath = path.trim()
  const resolvedPath = untildify(trimmedPath)
  const canSubmit = resolvedPath.length > 0 && !pending

  useEffect(() => {
    if (!open) return
    setPath('')
    setPending(false)
    setError(null)
    submitTokenRef.current = 0
  }, [open])

  async function choosePath() {
    if (pending) return
    try {
      const selected = await rpc.repo.openDialog.mutate()
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
          <div className="flex gap-2">
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
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              className="h-auto self-stretch px-3"
              onClick={() => void choosePath()}
            >
              {t('repo-tabs.open-path-choose')}
            </Button>
          </div>
          <FieldDescription reserveHeight>{trimmedPath ? tildify(resolvedPath) : ''}</FieldDescription>
        </Field>

        {error ? <DialogError>{error}</DialogError> : null}

        <DialogFooter className="pt-4">
          <Button type="button" variant="ghost" disabled={pending} onClick={onClose}>
            {t('dialog.cancel')}
          </Button>
          <Button type="submit" disabled={!canSubmit}>
            {pending ? t('repo-tabs.open-opening') : t('repo-tabs.open-local-confirm')}
          </Button>
        </DialogFooter>
      </form>
    </FormDialog>
  )
}
