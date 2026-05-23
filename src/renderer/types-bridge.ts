// Re-exports for store/component imports. Centralizes bridge types so
// stores don't need to redeclare them.

export type {
  ThemePref,
  ResolvedTheme,
  ThemeState,
  LangPref,
  Lang,
  I18nPayload,
  SessionState,
  SettingsSnapshot,
  GlobalShortcutState,
  CommitMeta,
  CommitFileStat,
  CommitDetail,
  MenuAction,
} from '#/shared/rpc.ts'
