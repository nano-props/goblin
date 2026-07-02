import { useEffect, useRef, useState } from 'react'
import { DialogFooter } from '#/web/components/ui/dialog.tsx'
import { Button } from '#/web/components/ui/button.tsx'
import { DialogStatusRow } from '#/web/components/ui/dialog-status-row.tsx'
import { FormDialog } from '#/web/components/ui/form-dialog.tsx'
import { Field, FieldDescription, FieldError, FieldLabel } from '#/web/components/ui/field.tsx'
import { Input } from '#/web/components/ui/input.tsx'
import { abortCloneOperation } from '#/web/repo-client.ts'
import { chooseCloneParentPath, hasNativeDirectoryPicker, homeDirectory } from '#/web/app-shell-client.ts'
import { useIsCompactUi } from '#/web/hooks/useResponsiveUiMode.tsx'
import { useT } from '#/web/stores/i18n.ts'
import { joinPath, tildify, untildify } from '#/web/lib/paths.ts'
import { cn } from '#/web/lib/cn.ts'
import type { CloneRepoResult } from '#/shared/api-types.ts'
import { createOpaqueId } from '#/shared/opaque-id.ts'
export interface CloneRepositoryRequest {
  operationId: string
  url: string
  parentPath: string
  directoryName: string
}

interface Props {
  open: boolean
  onClose: () => void
  onClone: (request: CloneRepositoryRequest) => Promise<CloneRepoResult>
}

export function CloneRepositoryDialog({ open, onClose, onClone }: Props) {
  const t = useT()
  const compact = useIsCompactUi()
  const [url, setUrl] = useState('')
  const [parentPath, setParentPath] = useState(tildify(defaultCloneParentPath()))
  const [directoryName, setDirectoryName] = useState('')
  const [directoryTouched, setDirectoryTouched] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const operationIdRef = useRef<string | null>(null)

  const urlTrimmed = url.trim()
  const parentPathTrimmed = untildify(parentPath.trim())
  const directoryNameTrimmed = directoryName.trim()
  const derivedDirectoryName = directoryNameFromGitUrl(urlTrimmed)
  const directoryError =
    directoryNameTrimmed && !isValidDirectoryName(directoryNameTrimmed) ? t('repo-picker.clone-directory-invalid') : ''
  const effectivePath =
    parentPathTrimmed && directoryNameTrimmed && !directoryError
      ? tildify(joinPath(parentPathTrimmed, directoryNameTrimmed))
      : ''
  const canSubmit = !!urlTrimmed && !!parentPathTrimmed && !!directoryNameTrimmed && !directoryError && !pending
  const canChooseParentPath = hasNativeDirectoryPicker()

  useEffect(() => {
    if (!open) return
    setUrl('')
    setParentPath(tildify(defaultCloneParentPath()))
    setDirectoryName('')
    setDirectoryTouched(false)
    setPending(false)
    setError(null)
    operationIdRef.current = null
  }, [open])

  useEffect(() => {
    if (directoryTouched) return
    setDirectoryName(derivedDirectoryName)
  }, [derivedDirectoryName, directoryTouched])

  async function chooseParentPath() {
    if (pending || !canChooseParentPath) return
    try {
      const selected = await chooseCloneParentPath()
      if (selected) setParentPath(tildify(selected))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error.unknown'))
    }
  }

  async function handleSubmit() {
    if (!canSubmit) return
    const operationId = createOperationId()
    operationIdRef.current = operationId
    setPending(true)
    setError(null)
    let result: CloneRepoResult
    try {
      result = await onClone({
        operationId,
        url: urlTrimmed,
        parentPath: parentPathTrimmed,
        directoryName: directoryNameTrimmed,
      })
    } catch (err) {
      if (operationIdRef.current !== operationId) return
      setPending(false)
      setError(err instanceof Error ? err.message : t('error.unknown'))
      return
    }
    if (operationIdRef.current !== operationId) return
    operationIdRef.current = null
    if (result.ok) {
      setPending(false)
      onClose()
      return
    }
    setPending(false)
    const errorMessageKey = result.message || 'error.unknown'
    setError(t(errorMessageKey))
  }

  async function handleCancel() {
    const operationId = operationIdRef.current
    operationIdRef.current = null
    if (pending && operationId) {
      void abortCloneOperation(operationId).catch(() => {})
      setPending(false)
    }
    onClose()
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !pending) void handleCancel()
      }}
      showCloseButton={!pending}
      className="sm:max-w-xl"
      title={t('repo-picker.clone-title')}
      description={t('repo-picker.clone-description')}
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault()
          void handleSubmit()
        }}
      >
        <Field className="gap-2">
          <FieldLabel htmlFor="clone-url">{t('repo-picker.clone-url-label')}</FieldLabel>
          <Input
            id="clone-url"
            autoFocus
            disabled={pending}
            value={url}
            onChange={(event) => {
              setUrl(event.target.value)
              setError(null)
            }}
            placeholder={t('repo-picker.clone-url-placeholder')}
            className="h-10 font-mono text-sm"
          />
          <FieldDescription reserveHeight aria-hidden />
        </Field>

        <Field className="gap-2">
          <FieldLabel htmlFor="clone-parent-path">{t('repo-picker.clone-parent-label')}</FieldLabel>
          <div className={cn('gap-2', compact ? 'flex flex-col' : 'flex')}>
            <Input
              id="clone-parent-path"
              value={parentPath}
              onChange={(event) => {
                setParentPath(event.target.value)
                setError(null)
              }}
              className="h-10 min-w-0 flex-1 font-mono text-sm"
              disabled={pending}
            />
            {canChooseParentPath ? (
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                className={cn('h-10 self-stretch px-3', compact && 'w-full')}
                onClick={() => void chooseParentPath()}
              >
                {t('repo-picker.clone-parent-choose')}
              </Button>
            ) : null}
          </div>
          <FieldDescription reserveHeight aria-hidden />
        </Field>

        <Field className="gap-2" data-invalid={directoryError ? true : undefined}>
          <FieldLabel htmlFor="clone-directory-name">{t('repo-picker.clone-directory-label')}</FieldLabel>
          <Input
            id="clone-directory-name"
            disabled={pending}
            value={directoryName}
            onChange={(event) => {
              setDirectoryName(event.target.value)
              setDirectoryTouched(true)
              setError(null)
            }}
            placeholder={t('repo-picker.clone-directory-placeholder')}
            aria-invalid={!!directoryError}
            aria-describedby={directoryError ? 'clone-directory-error' : 'clone-path-preview'}
            className="h-10 font-mono text-sm"
          />
          {directoryError ? (
            <FieldError id="clone-directory-error" reserveHeight>
              {directoryError}
            </FieldError>
          ) : (
            <FieldDescription id="clone-path-preview" reserveHeight className="truncate">
              {effectivePath ? t('repo-picker.clone-path-preview', { path: effectivePath }) : ''}
            </FieldDescription>
          )}
        </Field>

        <DialogStatusRow message={error ?? ''} tone="danger" />

        <DialogFooter className="gap-2 pt-2">
          <Button
            type="button"
            variant="outline"
            className={cn(compact && 'w-full')}
            onClick={() => void handleCancel()}
          >
            {t('dialog.cancel')}
          </Button>
          <Button type="submit" className={cn('min-w-28', compact && 'w-full min-w-0')} disabled={!canSubmit}>
            {pending ? t('repo-picker.clone-cloning') : t('repo-picker.clone-confirm')}
          </Button>
        </DialogFooter>
      </form>
    </FormDialog>
  )
}

function directoryNameFromGitUrl(url: string): string {
  if (!url) return ''
  const withoutQuery = url.split(/[?#]/)[0]?.replace(/[/\\]+$/, '') ?? ''
  const start =
    Math.max(withoutQuery.lastIndexOf('/'), withoutQuery.lastIndexOf('\\'), withoutQuery.lastIndexOf(':')) + 1
  const name = withoutQuery.slice(start).replace(/\.git$/i, '')
  return name.replace(/[\\/:\0]+/g, '-').trim()
}

function isValidDirectoryName(name: string): boolean {
  // Match native-host validation: reject path-shaping characters, but
  // keep valid single folder names such as `...` or `-repo`.
  return name.length > 0 && name.length <= 255 && name !== '.' && name !== '..' && !/[\\/:\0]/.test(name)
}

function defaultCloneParentPath(): string {
  return joinPath(homeDirectory(), 'Developer')
}

function createOperationId(): string {
  return createOpaqueId('clone-operation')
}
