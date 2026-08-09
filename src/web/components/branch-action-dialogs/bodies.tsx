import type { FunctionalComponent } from 'vue'
import { ConfirmCheckbox } from '#/web/components/ConfirmCheckbox.tsx'

const ConfirmValue: FunctionalComponent<{ value: string }> = (props) => (
  <span class="block break-all font-mono text-foreground" title={props.value}>
    {props.value}
  </span>
)

ConfirmValue.props = ['value']

const IndentedValue: FunctionalComponent<{ value: string }> = (props) => (
  <span class="block break-all pl-6 font-mono text-foreground" title={props.value}>
    {props.value}
  </span>
)

IndentedValue.props = ['value']

const ConfirmStack: FunctionalComponent = (_props, { slots }) => <div class="space-y-3">{slots.default?.()}</div>

const ConfirmSection: FunctionalComponent = (_props, { slots }) => <div class="space-y-1">{slots.default?.()}</div>

const ConfirmNote: FunctionalComponent = (_props, { slots }) => (
  <span class="block text-muted-foreground">{slots.default?.()}</span>
)

interface DeleteBranchConfirmBodyProps {
  body: string
  branchName: string
  note: string
  hasUpstream: boolean
  deleteAlsoUpstream: boolean
  tracking?: string
  onDeleteAlsoUpstreamChange: (checked: boolean) => void
  upstreamLabel: string
}

export const DeleteBranchConfirmBody: FunctionalComponent<DeleteBranchConfirmBodyProps> = (props) => (
  <ConfirmStack>
    <ConfirmSection>
      <span>{props.body}</span>
      <ConfirmValue value={props.branchName} />
      <ConfirmNote>{props.note}</ConfirmNote>
    </ConfirmSection>
    {props.hasUpstream && props.tracking ? (
      <ConfirmSection>
        <ConfirmCheckbox
          checked={props.deleteAlsoUpstream}
          onCheckedChange={props.onDeleteAlsoUpstreamChange}
          destructive
        >
          {props.upstreamLabel}
        </ConfirmCheckbox>
        <IndentedValue value={props.tracking} />
      </ConfirmSection>
    ) : null}
  </ConfirmStack>
)

DeleteBranchConfirmBody.props = [
  'body',
  'branchName',
  'note',
  'hasUpstream',
  'deleteAlsoUpstream',
  'tracking',
  'onDeleteAlsoUpstreamChange',
  'upstreamLabel',
]

interface RemoveWorktreeConfirmBodyProps {
  body: string
  path: string
  branchName: string
  protectedHint: string
  removeAlsoDeletes: boolean
  removeConfirmProtected: boolean
  hasUpstream: boolean
  tracking?: string
  removeAlsoUpstream: boolean
  onRemoveAlsoDeletesChange: (checked: boolean) => void
  onRemoveAlsoUpstreamChange: (checked: boolean) => void
  deleteBranchLabel: string
  deleteUpstreamLabel: string
}

export const RemoveWorktreeConfirmBody: FunctionalComponent<RemoveWorktreeConfirmBodyProps> = (props) => (
  <ConfirmStack>
    <ConfirmSection>
      <span>{props.body}</span>
      <ConfirmValue value={props.path} />
    </ConfirmSection>
    <div class="space-y-2">
      <ConfirmSection>
        <ConfirmCheckbox
          checked={props.removeAlsoDeletes}
          disabled={props.removeConfirmProtected}
          describedBy={props.removeConfirmProtected ? 'remove-worktree-protected-hint' : undefined}
          onCheckedChange={props.onRemoveAlsoDeletesChange}
          destructive
          title={props.removeConfirmProtected ? props.protectedHint : undefined}
        >
          {props.deleteBranchLabel}
        </ConfirmCheckbox>
        <IndentedValue value={props.branchName} />
      </ConfirmSection>
      {props.removeConfirmProtected ? (
        <div id="remove-worktree-protected-hint" class="pl-6 text-xs text-muted-foreground">
          {props.protectedHint}
        </div>
      ) : null}
      {props.removeAlsoDeletes && props.hasUpstream && !props.removeConfirmProtected && props.tracking ? (
        <ConfirmSection>
          <ConfirmCheckbox
            checked={props.removeAlsoUpstream}
            onCheckedChange={props.onRemoveAlsoUpstreamChange}
            destructive
          >
            {props.deleteUpstreamLabel}
          </ConfirmCheckbox>
          <IndentedValue value={props.tracking} />
        </ConfirmSection>
      ) : null}
    </div>
  </ConfirmStack>
)

RemoveWorktreeConfirmBody.props = [
  'body',
  'path',
  'branchName',
  'protectedHint',
  'removeAlsoDeletes',
  'removeConfirmProtected',
  'hasUpstream',
  'tracking',
  'removeAlsoUpstream',
  'onRemoveAlsoDeletesChange',
  'onRemoveAlsoUpstreamChange',
  'deleteBranchLabel',
  'deleteUpstreamLabel',
]

interface ForceRemoveWorktreeConfirmBodyProps {
  removeBody: string
  path: string
  forceDeleteBody: string
  branchName: string
  note: string
  hasUpstream: boolean
  tracking?: string
  removeAlsoUpstream: boolean
  onRemoveAlsoUpstreamChange: (checked: boolean) => void
  deleteUpstreamLabel: string
}

export const ForceRemoveWorktreeConfirmBody: FunctionalComponent<ForceRemoveWorktreeConfirmBodyProps> = (props) => (
  <ConfirmStack>
    <ConfirmSection>
      <span>{props.removeBody}</span>
      <ConfirmValue value={props.path} />
    </ConfirmSection>
    <ConfirmSection>
      <span>{props.forceDeleteBody}</span>
      <ConfirmValue value={props.branchName} />
      <ConfirmNote>{props.note}</ConfirmNote>
    </ConfirmSection>
    {props.hasUpstream && props.tracking ? (
      <ConfirmSection>
        <ConfirmCheckbox
          checked={props.removeAlsoUpstream}
          onCheckedChange={props.onRemoveAlsoUpstreamChange}
          destructive
        >
          {props.deleteUpstreamLabel}
        </ConfirmCheckbox>
        <IndentedValue value={props.tracking} />
      </ConfirmSection>
    ) : null}
  </ConfirmStack>
)

ForceRemoveWorktreeConfirmBody.props = [
  'removeBody',
  'path',
  'forceDeleteBody',
  'branchName',
  'note',
  'hasUpstream',
  'tracking',
  'removeAlsoUpstream',
  'onRemoveAlsoUpstreamChange',
  'deleteUpstreamLabel',
]
