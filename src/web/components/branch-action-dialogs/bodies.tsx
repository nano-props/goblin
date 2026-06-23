// Body content for the five branch-action confirmation dialogs
// (push / delete branch / force-delete / remove worktree / force-
// remove worktree). The orchestration lives in
// `BranchActionDialogHost`; this file owns the visual presentation
// of the dialog body below the title.
//
// Each body takes already-resolved display data as plain props — the
// host narrows the store view (slot entry + `(repo, branch)` + checkbox
// state) and passes the narrowed values in, so the bodies never read
// from any global state and never need non-null assertions.

import { type ReactNode } from 'react'
import { ConfirmCheckbox } from '#/web/components/ConfirmCheckbox.tsx'

function ConfirmValue({ value }: { value: string }) {
  return (
    <span className="block break-all font-mono text-foreground" title={value}>
      {value}
    </span>
  )
}

function IndentedValue({ value }: { value: string }) {
  return (
    <span className="block break-all pl-6 font-mono text-foreground" title={value}>
      {value}
    </span>
  )
}

function ConfirmStack({ children }: { children: ReactNode }) {
  return <div className="space-y-3">{children}</div>
}

function ConfirmSection({ children }: { children: ReactNode }) {
  return <div className="space-y-1">{children}</div>
}

function ConfirmNote({ children }: { children: ReactNode }) {
  return <span className="block text-muted-foreground">{children}</span>
}

export interface DeleteBranchConfirmBodyProps {
  body: string
  branchName: string
  note: string
  hasUpstream: boolean
  deleteAlsoUpstream: boolean
  tracking?: string
  onDeleteAlsoUpstreamChange: (checked: boolean) => void
  upstreamLabel: string
}

export function DeleteBranchConfirmBody({
  body,
  branchName,
  note,
  hasUpstream,
  deleteAlsoUpstream,
  tracking,
  onDeleteAlsoUpstreamChange,
  upstreamLabel,
}: DeleteBranchConfirmBodyProps) {
  return (
    <ConfirmStack>
      <ConfirmSection>
        <span>{body}</span>
        <ConfirmValue value={branchName} />
        <ConfirmNote>{note}</ConfirmNote>
      </ConfirmSection>
      {hasUpstream && tracking && (
        <ConfirmSection>
          <ConfirmCheckbox checked={deleteAlsoUpstream} onCheckedChange={onDeleteAlsoUpstreamChange} destructive>
            {upstreamLabel}
          </ConfirmCheckbox>
          <IndentedValue value={tracking} />
        </ConfirmSection>
      )}
    </ConfirmStack>
  )
}

export interface RemoveWorktreeConfirmBodyProps {
  body: string
  path: string
  branch: string
  protectedHint: string
  removeAlsoDeletes: boolean
  removeConfirmProtected: boolean
  hasUpstream: boolean
  tracking?: string
  removeAlsoUpstream: boolean
  onRemoveAlsoDeletesChange: (checked: boolean) => void
  onRemoveAlsoUpstreamChange: (checked: boolean) => void
  alsoDeleteBranchLabel: string
  alsoDeleteUpstreamLabel: string
}

export function RemoveWorktreeConfirmBody({
  body,
  path,
  branch,
  protectedHint,
  removeAlsoDeletes,
  removeConfirmProtected,
  hasUpstream,
  tracking,
  removeAlsoUpstream,
  onRemoveAlsoDeletesChange,
  onRemoveAlsoUpstreamChange,
  alsoDeleteBranchLabel,
  alsoDeleteUpstreamLabel,
}: RemoveWorktreeConfirmBodyProps) {
  return (
    <ConfirmStack>
      <ConfirmSection>
        <span>{body}</span>
        <ConfirmValue value={path} />
      </ConfirmSection>
      <div className="space-y-2">
        <ConfirmSection>
          <ConfirmCheckbox
            checked={removeAlsoDeletes}
            disabled={removeConfirmProtected}
            describedBy={removeConfirmProtected ? 'remove-worktree-protected-hint' : undefined}
            onCheckedChange={onRemoveAlsoDeletesChange}
            destructive
            title={removeConfirmProtected ? protectedHint : undefined}
          >
            {alsoDeleteBranchLabel}
          </ConfirmCheckbox>
          <IndentedValue value={branch} />
        </ConfirmSection>
        {removeConfirmProtected && (
          <div id="remove-worktree-protected-hint" className="pl-6 text-xs text-muted-foreground">
            {protectedHint}
          </div>
        )}
        {removeAlsoDeletes && hasUpstream && !removeConfirmProtected && tracking && (
          <ConfirmSection>
            <ConfirmCheckbox checked={removeAlsoUpstream} onCheckedChange={onRemoveAlsoUpstreamChange} destructive>
              {alsoDeleteUpstreamLabel}
            </ConfirmCheckbox>
            <IndentedValue value={tracking} />
          </ConfirmSection>
        )}
      </div>
    </ConfirmStack>
  )
}

export interface ForceRemoveWorktreeConfirmBodyProps {
  removeBody: string
  path: string
  forceDeleteBody: string
  branch: string
  note: string
  hasUpstream: boolean
  tracking?: string
  removeAlsoUpstream: boolean
  onRemoveAlsoUpstreamChange: (checked: boolean) => void
  alsoDeleteUpstreamLabel: string
}

export function ForceRemoveWorktreeConfirmBody({
  removeBody,
  path,
  forceDeleteBody,
  branch,
  note,
  hasUpstream,
  tracking,
  removeAlsoUpstream,
  onRemoveAlsoUpstreamChange,
  alsoDeleteUpstreamLabel,
}: ForceRemoveWorktreeConfirmBodyProps) {
  return (
    <ConfirmStack>
      <ConfirmSection>
        <span>{removeBody}</span>
        <ConfirmValue value={path} />
      </ConfirmSection>
      <ConfirmSection>
        <span>{forceDeleteBody}</span>
        <ConfirmValue value={branch} />
        <ConfirmNote>{note}</ConfirmNote>
      </ConfirmSection>
      {hasUpstream && tracking && (
        <ConfirmSection>
          <ConfirmCheckbox checked={removeAlsoUpstream} onCheckedChange={onRemoveAlsoUpstreamChange} destructive>
            {alsoDeleteUpstreamLabel}
          </ConfirmCheckbox>
          <IndentedValue value={tracking} />
        </ConfirmSection>
      )}
    </ConfirmStack>
  )
}