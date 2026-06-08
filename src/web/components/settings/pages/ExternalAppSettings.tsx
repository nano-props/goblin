import { type ComponentType } from 'react'
import { RotateCw } from 'lucide-react'
import { Badge } from '#/web/components/ui/badge.tsx'
import { Button } from '#/web/components/ui/button.tsx'
import {
  AppleTerminalIcon,
  CursorIcon,
  GhosttyIcon,
  VSCodeIcon,
  WindsurfIcon,
} from '#/web/components/ExternalAppIcon/index.tsx'
import {
  SettingsCard,
  SettingsGroup,
  SettingsListItem,
  SettingsSelect,
  SettingsList,
  SettingsRow,
} from '#/web/components/settings/SettingsPrimitives.tsx'
import {
  useExternalAppsQuery,
  useRefreshExternalAppsMutation,
  useSetEditorAppMutation,
  useSetTerminalAppMutation,
} from '#/web/settings-queries.ts'
import { useT } from '#/web/stores/i18n.ts'
import type { EditorPref, TerminalPref } from '#/shared/rpc.ts'
import { cn } from '#/web/lib/cn.ts'
interface ExternalToolItem {
  id: string
  Icon: ComponentType<{ className?: string }>
  titleKey: string
  commandKey: string
  detail?: string | null
}

const TERMINAL_APPS: ExternalToolItem[] = [
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
]

const EDITOR_APPS: ExternalToolItem[] = [
  {
    id: 'vscode',
    Icon: VSCodeIcon,
    titleKey: 'settings.apps.tool.vscode.title',
    commandKey: 'settings.apps.tool.vscode.command',
  },
  {
    id: 'cursor',
    Icon: CursorIcon,
    titleKey: 'settings.apps.tool.cursor.title',
    commandKey: 'settings.apps.tool.cursor.command',
  },
  {
    id: 'windsurf',
    Icon: WindsurfIcon,
    titleKey: 'settings.apps.tool.windsurf.title',
    commandKey: 'settings.apps.tool.windsurf.command',
  },
]

function DetectionStatusBadge({ available }: { available: boolean }) {
  const t = useT()
  return (
    <Badge variant={available ? 'success' : 'outline'}>
      {available ? t('settings.apps.status.detected') : t('settings.apps.status.not-detected')}
    </Badge>
  )
}

function DetectionRow({ item }: { item: ExternalToolItem & { available: boolean } }) {
  const t = useT()
  const Icon = item.Icon
  return (
    <SettingsListItem as="li" size="xl">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="truncate text-sm font-medium text-foreground">{t(item.titleKey)}</span>
          <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{t(item.commandKey)}</span>
        </div>
        {item.detail ? <p className="mt-0.5 truncate text-xs text-muted-foreground">{item.detail}</p> : null}
      </div>
      <DetectionStatusBadge available={item.available} />
    </SettingsListItem>
  )
}

function DetectionList({ items }: { items: Array<ExternalToolItem & { available: boolean }> }) {
  return (
    <SettingsCard as="ul">
      {items.map((item) => (
        <DetectionRow key={item.titleKey} item={item} />
      ))}
    </SettingsCard>
  )
}

export function ExternalAppSettings() {
  const t = useT()
  const { data } = useExternalAppsQuery()
  if (!data) return null
  const terminalApp = data.terminal.pref
  const terminalAppAvailability = data.terminal.appAvailability
  const editorApp = data.editor.pref
  const editorAppAvailability = data.editor.appAvailability
  const refreshExternalApps = useRefreshExternalAppsMutation()
  const setTerminalApp = useSetTerminalAppMutation()
  const setEditorApp = useSetEditorAppMutation()
  const refreshing = refreshExternalApps.isPending
  const terminalOptions: { value: TerminalPref; labelKey: string }[] = [
    { value: 'auto', labelKey: 'settings.terminal.auto' },
    { value: 'ghostty', labelKey: 'settings.terminal.ghostty' },
    { value: 'terminal', labelKey: 'settings.terminal.terminal' },
  ]
  const editorOptions: { value: EditorPref; labelKey: string }[] = [
    { value: 'auto', labelKey: 'settings.editor.auto' },
    { value: 'vscode', labelKey: 'settings.editor.vscode' },
    { value: 'cursor', labelKey: 'settings.editor.cursor' },
    { value: 'windsurf', labelKey: 'settings.editor.windsurf' },
  ]
  const save = (fn: () => Promise<unknown>, label: string) => {
    void fn().catch((err) => console.warn(`[settings] ${label} update failed`, err))
  }

  return (
    <>
      <SettingsGroup label={t('settings.group.apps')}>
        <SettingsList>
          <SettingsRow
            controlId="settings-terminal"
            label={t('settings.terminal')}
            control={
              <SettingsSelect
                id="settings-terminal"
                value={terminalApp}
                options={terminalOptions.map((o) => ({ value: o.value, label: t(o.labelKey) }))}
                onChange={(v) => save(() => setTerminalApp.mutateAsync(v), 'terminal')}
              />
            }
          />
          <SettingsRow
            controlId="settings-editor"
            label={t('settings.editor')}
            control={
              <SettingsSelect
                id="settings-editor"
                value={editorApp}
                options={editorOptions.map((o) => ({ value: o.value, label: t(o.labelKey) }))}
                onChange={(v) => save(() => setEditorApp.mutateAsync(v), 'editor')}
              />
            }
          />
        </SettingsList>
      </SettingsGroup>
      <SettingsGroup
        label={t('settings.apps.group.terminals')}
        action={
          <Button
            type="button"
            data-interactive
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-foreground"
            onClick={() => {
              if (refreshing) return
              void refreshExternalApps.mutateAsync().catch((err) => {
                console.warn('[settings] external app refresh failed', err)
              })
            }}
            disabled={refreshing}
          >
            <RotateCw className={cn('size-3', refreshing && 'animate-spin')} />
            {t('settings.apps.redetect')}
          </Button>
        }
      >
        <DetectionList
          items={TERMINAL_APPS.map((item) => ({
            ...item,
            available: item.id === 'ghostty' ? terminalAppAvailability.ghostty : terminalAppAvailability.terminal,
          }))}
        />
      </SettingsGroup>
      <SettingsGroup label={t('settings.apps.group.editors')}>
        <DetectionList
          items={EDITOR_APPS.map((item) => ({
            ...item,
            available:
              item.id === 'vscode'
                ? editorAppAvailability.vscode
                : item.id === 'cursor'
                  ? editorAppAvailability.cursor
                  : editorAppAvailability.windsurf,
          }))}
        />
      </SettingsGroup>
    </>
  )
}
