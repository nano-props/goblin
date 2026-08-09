import { RotateCw, SquareTerminal } from '@lucide/vue'
import { defineComponent } from 'vue'
import type { FunctionalComponent, PropType, SVGAttributes } from 'vue'
import type { EditorApp } from '#/shared/settings.ts'
import { Badge } from '#/web/components/ui/badge.tsx'
import { Button } from '#/web/components/ui/button.tsx'
import { AppleTerminalIcon } from '#/web/components/ExternalAppIcon/AppleTerminalIcon.tsx'
import { GhosttyIcon } from '#/web/components/ExternalAppIcon/GhosttyIcon.tsx'
import { VSCodeIcon } from '#/web/components/ExternalAppIcon/VSCodeIcon.tsx'
import { SettingsCard, SettingsGroup, SettingsListItem } from '#/web/components/settings/SettingsPrimitives.tsx'
import { selectHostPlatform, hostInfoStore, type ClientPlatform } from '#/web/stores/host-info.ts'
import { useExternalAppsQuery } from '#/web/settings-queries.ts'
import { useExternalAppSettingsController } from '#/web/runtime-settings-external-apps.ts'
import { useT } from '#/web/stores/i18n-vue.ts'
import { cn } from '#/web/lib/cn.ts'
import { useStoreSelector } from '#/web/stores/store-selector.ts'

interface ExternalToolItem {
  id: string
  Icon: FunctionalComponent<SVGAttributes>
  titleKey: string
  commandKey: string
  detail?: string | null
}

const ALL_TERMINAL_APPS: ExternalToolItem[] = [
  {
    id: 'ghostty',
    Icon: GhosttyIcon,
    titleKey: 'settings.apps.tool.ghostty.title',
    commandKey: 'settings.apps.tool.ghostty.command',
  },
  {
    id: 'terminal',
    Icon: AppleTerminalIcon,
    titleKey: 'settings.apps.tool.terminal.title',
    commandKey: 'settings.apps.tool.terminal.command',
  },
  {
    id: 'windowsTerminal',
    Icon: SquareTerminal,
    titleKey: 'settings.apps.tool.windows-terminal.title',
    commandKey: 'settings.apps.tool.windows-terminal.command',
  },
]

/**
 * Per-platform visibility for terminal entries.
 *
 * - `terminal` is the macOS Terminal.app backend (`openInAppleTerminal`).
 *   On Windows/Linux/other the backend is unreachable, so we hide it from
 *   the picker rather than offer a row that can only fail.
 * - `windowsTerminal` is win32-only — `windows-terminal.ts` hard-checks
 *   `process.platform === 'win32'`, so cygwin (which reports `'cygwin'`)
 *   and other Windows-like environments don't get it either.
 * - `ghostty` is cross-platform. Detection is currently best-effort on
 *   macOS only; on Linux/Windows the row simply shows "not detected" if
 *   Ghostty isn't installed.
 *
 * The data lives in the shared array above so the i18n bundle stays
 * single-source; this map just filters which entries are visible per
 * host platform. Mirrors the union in `shared/bootstrap.ts`; add new
 * platforms here when they get a Windows-Terminal-shaped backend.
 */
type BootstrapPlatform = ClientPlatform
const PLATFORM_TERMINAL_IDS: Record<BootstrapPlatform, ReadonlySet<string>> = {
  win32: new Set(['windowsTerminal']),
  darwin: new Set(['ghostty', 'terminal']),
  // Non-darwin, non-win32 Unix-y platforms: only Ghostty, which is the
  // only cross-platform terminal backend we ship. cygwin reports
  // `'cygwin'` not `'win32'`, so Windows Terminal's platform guard would
  // reject it anyway.
  linux: new Set(['ghostty']),
  aix: new Set(['ghostty']),
  android: new Set(['ghostty']),
  cygwin: new Set(['ghostty']),
  freebsd: new Set(['ghostty']),
  haiku: new Set(['ghostty']),
  netbsd: new Set(['ghostty']),
  openbsd: new Set(['ghostty']),
  sunos: new Set(['ghostty']),
  // Web-hosted clients (the dev preview) have no real terminal; hide
  // every OS-specific entry.
  web: new Set<string>(),
}

const EDITOR_APPS = [
  {
    id: 'vscode',
    Icon: VSCodeIcon,
    titleKey: 'settings.apps.tool.vscode.title',
    commandKey: 'settings.apps.tool.vscode.command',
  },
] as const satisfies readonly (ExternalToolItem & { id: EditorApp })[]

const DetectionStatusBadge = defineComponent<{ available: boolean }>({
  name: 'DetectionStatusBadge',
  props: { available: Boolean },
  setup(props) {
    const t = useT()
    return () => (
      <Badge variant={props.available ? 'success' : 'outline'}>
        {props.available ? t('settings.apps.status.detected') : t('settings.apps.status.not-detected')}
      </Badge>
    )
  },
})

const DetectionRow = defineComponent<{ item: ExternalToolItem & { available: boolean } }>({
  name: 'DetectionRow',
  props: {
    item: { type: Object as PropType<ExternalToolItem & { available: boolean }>, required: true },
  },

  setup(props) {
    const t = useT()
    return () => {
      const Icon = props.item.Icon
      return (
        <SettingsListItem as="li" size="xl">
          <span class="flex size-8 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
            <Icon class="size-4" />
          </span>
          <div class="min-w-0 flex-1">
            <div class="flex min-w-0 items-baseline gap-2">
              <span class="truncate text-sm font-medium text-foreground">{t(props.item.titleKey)}</span>
              <span class="shrink-0 font-mono text-[11px] text-muted-foreground">{t(props.item.commandKey)}</span>
            </div>
            {props.item.detail ? (
              <p class="mt-0.5 truncate text-xs text-muted-foreground">{props.item.detail}</p>
            ) : null}
          </div>
          <DetectionStatusBadge available={props.item.available} />
        </SettingsListItem>
      )
    }
  },
})

const DetectionList = defineComponent<{ items: Array<ExternalToolItem & { available: boolean }> }>({
  name: 'DetectionList',
  props: {
    items: { type: Array as PropType<Array<ExternalToolItem & { available: boolean }>>, required: true },
  },

  setup(props) {
    return () => (
      <SettingsCard as="ul">
        {props.items.map((item) => (
          <DetectionRow key={item.titleKey} item={item} />
        ))}
      </SettingsCard>
    )
  },
})

export const ExternalAppSettings = defineComponent({
  name: 'ExternalAppSettings',
  setup() {
    const t = useT()
    const { data } = useExternalAppsQuery()
    const { refreshExternalApps, refreshing } = useExternalAppSettingsController()
    // Read the platform from the host-info store, not `process.platform`:
    // the client is sandboxed and does not have `process` at runtime, so
    // the only reliable source is the public `/api/host` endpoint fetched
    // during public bootstrap. The store falls back to `'web'`
    // (which hides every OS-specific terminal entry) until the hydrate
    // resolves — the settings page is gated behind login anyway.
    const platform = useStoreSelector(hostInfoStore, selectHostPlatform)
    return () => {
      const snapshot = data.value
      if (!snapshot) return null
      const terminalAppAvailability = snapshot.terminal.appAvailability
      const editorAppAvailability = snapshot.editor.appAvailability
      const visibleTerminalIds = PLATFORM_TERMINAL_IDS[platform.value]
      const terminalApps = ALL_TERMINAL_APPS.filter((item) => visibleTerminalIds.has(item.id))
      return (
        <>
          <SettingsGroup
            label={t('settings.apps.group.terminals')}
            action={
              <Button
                type="button"
                data-interactive
                variant="ghost"
                size="sm"
                class="text-muted-foreground hover:text-foreground"
                onClick={() => {
                  if (refreshing.value) return
                  void refreshExternalApps()
                }}
                disabled={refreshing.value}
              >
                <RotateCw class={cn('size-3', refreshing.value && 'animate-spin')} />
                {t('settings.apps.redetect')}
              </Button>
            }
          >
            <DetectionList
              items={terminalApps.map((item) => ({
                ...item,
                available: terminalAppAvailability[item.id as keyof typeof terminalAppAvailability] ?? false,
              }))}
            />
          </SettingsGroup>
          <SettingsGroup label={t('settings.apps.group.editors')}>
            <DetectionList
              items={EDITOR_APPS.map((item) => ({
                ...item,
                available: editorAppAvailability[item.id as keyof typeof editorAppAvailability] ?? false,
              }))}
            />
          </SettingsGroup>
        </>
      )
    }
  },
})
