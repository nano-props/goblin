import { useEffect, useRef, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#/renderer/components/ui/dialog.tsx'
import { Button } from '#/renderer/components/ui/button.tsx'
import { Field, FieldDescription, FieldError, FieldLabel } from '#/renderer/components/ui/field.tsx'
import { Input } from '#/renderer/components/ui/input.tsx'
import { useT } from '#/renderer/stores/i18n.ts'
import { goblin, rpc } from '#/renderer/rpc.ts'
import { joinPath, tildify, untildify } from '#/renderer/lib/paths.ts'
import type { CloneRepoResult } from '#/shared/rpc.ts'

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
    directoryNameTrimmed && !isValidDirectoryName(directoryNameTrimmed) ? t('repo-tabs.clone-directory-invalid') : ''
  const effectivePath =
    parentPathTrimmed && directoryNameTrimmed && !directoryError
      ? tildify(joinPath(parentPathTrimmed, directoryNameTrimmed))
      : ''
  const canSubmit = !!urlTrimmed && !!parentPathTrimmed && !!directoryNameTrimmed && !directoryError && !pending

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
    if (pending) return
    try {
      const selected = await rpc.repo.cloneParentDialog.mutate()
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
    setError(t(result.message || 'error.unknown'))
  }

  async function handleCancel() {
    const operationId = operationIdRef.current
    operationIdRef.current = null
    if (pending && operationId) {
      // Best-effort cancel: the in-flight clone promise may still settle,
      // but operationIdRef prevents a closed/stale dialog from updating.
      void rpc.repo.abortClone.mutate({ operationId }).catch(() => {})
      setPending(false)
    }
    onClose()
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) void handleCancel()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('repo-tabs.clone-title')}</DialogTitle>
          <DialogDescription>{t('repo-tabs.clone-description')}</DialogDescription>
        </DialogHeader>

        <form
          className="space-y-0"
          onSubmit={(event) => {
            event.preventDefault()
            void handleSubmit()
          }}
        >
          <Field>
            <FieldLabel htmlFor="clone-url">{t('repo-tabs.clone-url-label')}</FieldLabel>
            <Input
              id="clone-url"
              autoFocus
              disabled={pending}
              value={url}
              onChange={(event) => {
                setUrl(event.target.value)
                setError(null)
              }}
              placeholder={t('repo-tabs.clone-url-placeholder')}
              className="font-mono text-xs"
            />
            <FieldDescription reserveHeight aria-hidden />
          </Field>

          <Field>
            <FieldLabel htmlFor="clone-parent-path">{t('repo-tabs.clone-parent-label')}</FieldLabel>
            <div className="flex gap-2">
              <Input
                id="clone-parent-path"
                value={parentPath}
                onChange={(event) => {
                  setParentPath(event.target.value)
                  setError(null)
                }}
                className="min-w-0 flex-1 font-mono text-xs"
                disabled={pending}
              />
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                className="h-auto self-stretch px-3"
                onClick={() => void chooseParentPath()}
              >
                {t('repo-tabs.clone-parent-choose')}
              </Button>
            </div>
            <FieldDescription reserveHeight aria-hidden />
          </Field>

          <Field data-invalid={directoryError ? true : undefined}>
            <FieldLabel htmlFor="clone-directory-name">{t('repo-tabs.clone-directory-label')}</FieldLabel>
            <Input
              id="clone-directory-name"
              disabled={pending}
              value={directoryName}
              onChange={(event) => {
                setDirectoryName(event.target.value)
                setDirectoryTouched(true)
                setError(null)
              }}
              placeholder={t('repo-tabs.clone-directory-placeholder')}
              aria-invalid={!!directoryError}
              aria-describedby={directoryError ? 'clone-directory-error' : 'clone-path-preview'}
              className="font-mono text-xs"
            />
            {directoryError ? (
              <FieldError id="clone-directory-error" reserveHeight>
                {directoryError}
              </FieldError>
            ) : (
              <FieldDescription id="clone-path-preview" reserveHeight className="truncate">
                {effectivePath ? t('repo-tabs.clone-path-preview', { path: effectivePath }) : ''}
              </FieldDescription>
            )}
          </Field>

          {error && (
            <div className="mt-3 rounded-md border border-danger-border bg-danger-surface px-3 py-2 text-xs text-danger">
              {error}
            </div>
          )}

          <DialogFooter className="pt-4">
            <Button type="button" variant="ghost" onClick={() => void handleCancel()}>
              {t('dialog.cancel')}
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {pending ? t('repo-tabs.clone-cloning') : t('repo-tabs.clone-confirm')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
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
  // Match main-process validation: reject path-shaping characters, but
  // keep valid single folder names such as `...` or `-repo`.
  return name.length > 0 && name.length <= 255 && name !== '.' && name !== '..' && !/[\\/:\0]/.test(name)
}

function defaultCloneParentPath(): string {
  return joinPath(goblin.homeDir, 'Developer')
}

function createOperationId(): string {
  const uuid = globalThis.crypto?.randomUUID?.()
  if (uuid) return uuid
  const bytes = new Uint32Array(2)
  globalThis.crypto?.getRandomValues?.(bytes)
  const a = bytes[0] || Math.floor(Math.random() * 0xffffffff)
  const b = bytes[1] || Math.floor(Math.random() * 0xffffffff)
  return `${Date.now().toString(36)}-${a.toString(36)}-${b.toString(36)}`
}
