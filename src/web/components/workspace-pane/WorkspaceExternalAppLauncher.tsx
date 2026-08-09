import { ChevronDown, Loader2 } from '@lucide/vue'
import { PopoverTrigger } from 'reka-ui'
import { computed, defineComponent, ref, toValue } from 'vue'
import type { ComputedRef, MaybeRefOrGetter, PropType, VNodeChild } from 'vue'
import { toast } from 'vue-sonner'
import { useT } from '#/web/stores/i18n-vue.ts'
import { focusRing } from '#/web/components/ui/focus.ts'
import { Popover, PopoverContent } from '#/web/components/ui/popover.tsx'
import { useAsyncPending } from '#/web/hooks/useAsyncPending.ts'
import { useExternalAppSettings } from '#/web/runtime-settings-external-apps.ts'
import { isRemoteWorkspaceId } from '#/shared/remote-workspace.ts'
import { selectHostPlatform, hostInfoStore } from '#/web/stores/host-info.ts'
import { WORKSPACE_EXTERNAL_APPS, workspaceExternalAppAvailable } from '#/web/external-workspace-apps.tsx'
import type { WorkspaceExternalAppItem } from '#/web/external-workspace-apps.tsx'
import { getRecentWorkspaceExternalAppId } from '#/shared/workspace-settings.ts'
import type { WorkspaceExternalAppTarget } from '#/shared/workspace-settings.ts'
import { useSettingsSnapshotQuery } from '#/web/settings-queries.ts'
import { setRecentWorkspaceExternalAppPreference } from '#/web/settings-actions.ts'
import { cn } from '#/web/lib/cn.ts'
import type { WorkspacePaneFilesystemTarget } from '#/web/workspace-pane/workspace-pane-filesystem-target.ts'
import {
  workspaceFilesystemExternalCapabilities,
  workspaceFilesystemExternalActions,
} from '#/web/hooks/useWorkspaceFilesystemExternalActions.ts'
import type { WorkspaceFilesystemExternalActions } from '#/web/hooks/useWorkspaceFilesystemExternalActions.ts'
import { useStoreSelector } from '#/web/stores/store-selector.ts'

type ExternalAppSettings = ReturnType<typeof useExternalAppSettings>['value']

export function useWorkspaceExternalAppItems(
  target: MaybeRefOrGetter<WorkspacePaneFilesystemTarget>,
): ComputedRef<readonly WorkspaceExternalAppItem[]> {
  const externalApps = useExternalAppSettings()
  const hostPlatform = useStoreSelector(hostInfoStore, selectHostPlatform)
  return computed(() => {
    const currentTarget = toValue(target)
    const capabilities = workspaceFilesystemExternalCapabilities(currentTarget)
    const isRemoteWorkspace = isRemoteWorkspaceId(currentTarget.workspaceId)
    const finderAvailable = capabilities.canOpenFinder && hostPlatform.value === 'darwin'
    return WORKSPACE_EXTERNAL_APPS.filter((item) =>
      workspaceExternalAppItemVisible({
        item,
        capabilities,
        externalApps: externalApps.value,
        finderAvailable,
        isRemoteWorkspace,
      }),
    )
  })
}

export const WorkspaceExternalAppLauncher = defineComponent<{
  target: WorkspacePaneFilesystemTarget
  items: readonly WorkspaceExternalAppItem[]
}>({
  name: 'WorkspaceExternalAppLauncher',
  props: {
    target: { type: Object as PropType<WorkspacePaneFilesystemTarget>, required: true },
    items: { type: Array as PropType<readonly WorkspaceExternalAppItem[]>, required: true },
  },

  setup(props) {
    const t = useT()
    const open = ref(false)
    const { pending, run } = useAsyncPending<string>()
    const { data: settingsSnapshot } = useSettingsSnapshotQuery()
    const externalAppTarget = computed<WorkspaceExternalAppTarget>(() => externalAppPreferenceTarget(props.target))
    const serverRecentItemId = computed(() =>
      getRecentWorkspaceExternalAppId(
        settingsSnapshot.value?.workspaceSettings ?? [],
        props.target.workspaceId,
        externalAppTarget.value,
      ),
    )
    const primaryItem = computed(() => selectPrimaryWorkspaceExternalApp(props.items, serverRecentItemId.value))

    function runLocalItem(item: WorkspaceExternalAppItem): void {
      if (pending.value !== null) return
      open.value = false
      // An accepted user action owns the target visible at admission. The
      // toolbar component is reused across worktrees, so reading props after
      // the preference write would redirect the action if navigation wins the
      // race.
      const target = props.target
      const preferenceTarget = externalAppPreferenceTarget(target)
      const actions = workspaceFilesystemExternalActions(target)
      const shouldWriteRecent = item.id !== serverRecentItemId.value
      void run(item.id, async () => {
        if (shouldWriteRecent) {
          try {
            await setRecentWorkspaceExternalAppPreference({
              workspaceId: target.workspaceId,
              target: preferenceTarget,
              itemId: item.id,
            })
          } catch (err) {
            toast.error(t('action.result-error'), {
              description: err instanceof Error ? err.message : String(err),
            })
          }
        }
        const result =
          item.kind === 'terminal'
            ? await actions.openTerminal(item.app)
            : item.kind === 'editor'
              ? await actions.openEditor(item.app)
              : await actions.openFinder()
        if (result && !result.ok) toast.error(t('action.result-error'), { description: result.message })
        return result
      })
    }

    return () => {
      const currentPrimaryItem = primaryItem.value
      if (props.items.length === 0 || !currentPrimaryItem) return null
      const busy = pending.value !== null
      const PrimaryIcon = currentPrimaryItem.Icon
      const primaryAction: PrimaryAction = {
        title: t(currentPrimaryItem.labelKey),
        ariaLabel: t(currentPrimaryItem.labelKey),
        busy: pending.value === currentPrimaryItem.id,
        disabled: busy,
        icon: <PrimaryIcon />,
        onSelect: () => runLocalItem(currentPrimaryItem),
      }
      const launcherLabel = t('workspace.open-externally.open')
      return (
        <Popover
          open={open.value}
          onOpenChange={(next) => {
            open.value = next
          }}
        >
          <div
            class="inline-flex h-7 shrink-0 overflow-hidden rounded-md border border-separator bg-control shadow-xs"
            onClick={(event) => event.stopPropagation()}
            onDblclick={(event) => event.stopPropagation()}
          >
            <PrimaryButton action={primaryAction} />
            <PopoverTrigger asChild>
              <button
                type="button"
                data-testid="workspace-external-app-launcher-trigger"
                class={cn(
                  'flex h-full w-6 cursor-pointer items-center justify-center text-muted-foreground outline-none transition-colors duration-100 hover:bg-control-hover hover:text-foreground disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-3.5 [&_svg]:shrink-0',
                  focusRing,
                )}
                title={launcherLabel}
                aria-label={launcherLabel}
                aria-busy={busy || undefined}
                disabled={busy}
              >
                <ChevronDown />
              </button>
            </PopoverTrigger>
          </div>
          <PopoverContent
            align="end"
            class="w-max min-w-48 max-w-72 overflow-hidden p-0"
            tabindex={-1}
            onOpenAutoFocus={(event: Event) => {
              event.preventDefault()
              if (event.target instanceof HTMLElement) event.target.focus({ preventScroll: true })
            }}
            onClick={(event: MouseEvent) => event.stopPropagation()}
          >
            <div role="list">
              <div class="space-y-0.5 p-1">
                {props.items.map((item) => (
                  <div key={item.id} role="listitem">
                    <WorkspaceExternalAppLauncherItem
                      item={item}
                      pending={pending.value}
                      disabled={busy}
                      selected={item.id === currentPrimaryItem.id}
                      onSelect={() => runLocalItem(item)}
                    />
                  </div>
                ))}
              </div>
            </div>
          </PopoverContent>
        </Popover>
      )
    }
  },
})

function externalAppPreferenceTarget(target: WorkspacePaneFilesystemTarget): WorkspaceExternalAppTarget {
  return target.kind === 'workspace-root' ? { kind: 'workspace-root' } : { kind: 'git-worktree', root: target.rootId }
}

interface PrimaryAction {
  title: string
  ariaLabel: string
  busy: boolean
  disabled: boolean
  icon: VNodeChild
  onSelect: () => void
}

const PrimaryButton = defineComponent<{ action: PrimaryAction }>({
  name: 'PrimaryButton',
  props: { action: { type: Object as PropType<PrimaryAction>, required: true } },

  setup(props) {
    return () => (
      <button
        type="button"
        data-testid="workspace-external-app-launcher-primary"
        class={cn(
          'flex h-full w-8 cursor-pointer items-center justify-center outline-none transition-colors duration-100 hover:bg-control-hover disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
          focusRing,
        )}
        title={props.action.title}
        aria-label={props.action.ariaLabel}
        aria-busy={props.action.busy || undefined}
        disabled={props.action.disabled}
        onClick={props.action.onSelect}
      >
        {props.action.busy ? <Loader2 class="animate-spin" /> : props.action.icon}
      </button>
    )
  },
})

const WorkspaceExternalAppLauncherItem = defineComponent<{
  item: WorkspaceExternalAppItem
  pending: string | null
  disabled: boolean
  selected: boolean
  onSelect: () => void
}>({
  name: 'WorkspaceExternalAppLauncherItem',
  props: {
    item: { type: Object as PropType<WorkspaceExternalAppItem>, required: true },
    pending: String,
    disabled: Boolean,
    selected: Boolean,
    onSelect: { type: Function as PropType<() => void>, required: true },
  },

  setup(props) {
    const t = useT()
    return () => {
      const itemBusy = props.pending === props.item.id
      const Icon = props.item.Icon
      return (
        <button
          type="button"
          title={t(props.item.labelKey)}
          aria-pressed={props.selected}
          aria-busy={itemBusy || undefined}
          disabled={props.disabled}
          onClick={props.onSelect}
          class={cn(
            'flex h-8 w-full items-center gap-2 rounded-sm py-1 pl-2 pr-2 text-left text-sm outline-none transition-colors duration-100 disabled:pointer-events-none disabled:opacity-50',
            props.disabled ? 'cursor-default' : 'cursor-pointer hover:bg-accent hover:text-accent-foreground',
            focusRing,
          )}
        >
          <span class="flex size-4 shrink-0 items-center justify-center text-muted-foreground [&_svg]:size-4 [&_svg]:shrink-0">
            {itemBusy ? <Loader2 size={16} class="animate-spin" /> : <Icon class="size-4" />}
          </span>
          <span class="min-w-0 flex-1 truncate">{t(props.item.labelKey)}</span>
        </button>
      )
    }
  },
})

function workspaceExternalAppItemVisible(input: {
  item: WorkspaceExternalAppItem
  capabilities: WorkspaceFilesystemExternalActions['capabilities']
  externalApps: ExternalAppSettings
  finderAvailable: boolean
  isRemoteWorkspace: boolean
}): boolean {
  const { item, capabilities, externalApps, finderAvailable, isRemoteWorkspace } = input
  if (isRemoteWorkspace && !item.supportsRemote) return false
  if (item.kind === 'terminal' && !capabilities.canOpenTerminal) return false
  if (item.kind === 'editor' && !capabilities.canOpenEditor) return false
  if (item.kind === 'finder' && !capabilities.canOpenFinder) return false
  return workspaceExternalAppAvailable(item, {
    terminals: externalApps.terminalAppAvailability,
    editors: externalApps.editorAppAvailability,
    finder: finderAvailable,
  })
}

function selectPrimaryWorkspaceExternalApp(
  visibleItems: readonly WorkspaceExternalAppItem[],
  recentItemId: string | null,
): WorkspaceExternalAppItem | null {
  return visibleItems.find((item) => item.id === recentItemId) ?? visibleItems[0] ?? null
}
