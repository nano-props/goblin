import { ShortcutSettings } from '#/web/components/settings/ShortcutSettings.tsx'
import { SettingsCard, SettingsGroup, SettingsListItem } from '#/web/components/settings/SettingsPrimitives.tsx'
import { useShortcutSettings } from '#/web/runtime-settings-shortcuts.ts'
import { useT } from '#/web/stores/i18n.ts'
import { helpShortcutSections, type HelpShortcutRow, type HelpShortcutSection } from '#/web/keyboard/help-shortcuts.ts'
function KeyCombo({ keys }: { keys: string[] }) {
  return (
    <span className="inline-flex items-center gap-0.5">
      {keys.map((k, i) => (
        <span key={i} className="inline-flex items-center gap-0.5">
          {i > 0 && <span className="text-[10px] text-muted-foreground/60">+</span>}
          <span className="kbd">{k}</span>
        </span>
      ))}
    </span>
  )
}

function KeyCombos({ combos }: { combos: string[][] }) {
  return (
    <span className="flex shrink-0 flex-wrap justify-end gap-x-1 gap-y-0.5">
      {combos.map((combo, i) => (
        <span key={`${combo.join('+')}:${i}`} className="inline-flex items-center gap-1">
          {i > 0 && <span className="text-[11px] text-muted-foreground/60">/</span>}
          <KeyCombo keys={combo} />
        </span>
      ))}
    </span>
  )
}

function ShortcutRow({ row }: { row: HelpShortcutRow }) {
  const t = useT()
  return (
    <SettingsListItem as="li" size="sm" className="border-t border-separator" separated={false}>
      <span className="min-w-0 pr-2 text-[13px] leading-snug text-foreground">{t(row.labelKey, row.labelParams)}</span>
      <KeyCombos combos={row.combos} />
    </SettingsListItem>
  )
}

function ShortcutList({ sections }: { sections: HelpShortcutSection[] }) {
  const t = useT()
  return (
    <SettingsCard>
      {sections.map((section) => (
        <section key={section.titleKey} className="[&+&]:border-t [&+&]:border-separator">
          <div className="flex h-8 items-center bg-muted/30 px-3 text-[11px] font-medium text-muted-foreground">
            {t(section.titleKey)}
          </div>
          <ul>
            {section.rows.map((row) => (
              <ShortcutRow
                key={`${row.labelKey}:${JSON.stringify(row.labelParams ?? {})}:${row.combos.map((combo) => combo.join('+')).join('/')}`}
                row={row}
              />
            ))}
          </ul>
        </section>
      ))}
    </SettingsCard>
  )
}

export function KeyboardShortcutSettings() {
  const t = useT()
  const { globalShortcut } = useShortcutSettings()
  return (
    <>
      <SettingsGroup label={t('settings.shortcuts')}>
        <ShortcutSettings />
      </SettingsGroup>
      <SettingsGroup label={t('help.title')} hint={t('help.hint')}>
        <ShortcutList sections={helpShortcutSections(globalShortcut)} />
      </SettingsGroup>
    </>
  )
}
