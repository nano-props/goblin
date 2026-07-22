import * as v from 'valibot'
import { parseAllowedGlobalShortcut } from '#/shared/accelerator.ts'
import { COLOR_THEMES } from '#/shared/color-theme.ts'
import { WorkspaceSessionEntrySchema } from '#/shared/remote-workspace-schema.ts'
import { LANG_PREF_VALUES, THEME_PREF_VALUES } from '#/shared/settings.ts'
import { WorkspaceIdSchema } from '#/shared/workspace-locator-schema.ts'
import { WorkspacePaneStaticTabEntrySchema } from '#/shared/workspace-pane-tabs-validators.ts'
import { WorkspacePaneTabsSnapshotSchema, WorkspaceRuntimeIdSchema } from '#/shared/workspace-pane-tabs-validators.ts'
import { RepoProjectionResponseSchema } from '#/shared/repo-response-schema.ts'
import {
  RemoteWorkspaceTargetResponseSchema,
  WorkspaceGitReadyProbeResponseSchema,
  WorkspaceProbeWithoutGitProjectionResponseSchema,
} from '#/shared/workspace-http-response-schema.ts'
import { REMOTE_WORKSPACE_FAILURE_REASONS } from '#/shared/remote-workspace.ts'
import {
  parseWorkspaceExternalAppRecentKey,
  WORKSPACE_EXTERNAL_APP_IDS,
  WORKTREE_BOOTSTRAP_CONFIG_HASH_RE,
} from '#/shared/workspace-settings.ts'

export const FetchIntervalSecSchema = v.pipe(
  v.number(),
  v.finite(),
  v.integer(),
  v.minValue(0),
  v.maxValue(3600),
)

export const GlobalShortcutSchema = v.pipe(
  v.string(),
  v.check(
    (value) => parseAllowedGlobalShortcut(value) === value,
    'Global shortcut must be an allowed canonical accelerator',
  ),
)

export const UserSettingsSchema = v.strictObject({
  theme: v.picklist(THEME_PREF_VALUES),
  colorTheme: v.picklist(COLOR_THEMES),
  lang: v.picklist(LANG_PREF_VALUES),
  fetchIntervalSec: FetchIntervalSecSchema,
  terminalNotificationsEnabled: v.boolean(),
  shortcutsDisabled: v.boolean(),
  globalShortcutDisabled: v.boolean(),
  globalShortcut: GlobalShortcutSchema,
  lanEnabled: v.boolean(),
})

const WorktreeBootstrapTrustSchema = v.strictObject({
  configHash: v.pipe(v.string(), v.regex(WORKTREE_BOOTSTRAP_CONFIG_HASH_RE)),
  trustedAt: v.pipe(
    v.string(),
    v.check((value) => !Number.isNaN(Date.parse(value)), 'Invalid worktree bootstrap trust timestamp'),
  ),
})

const WorkspaceExternalAppRecentSchema = v.strictObject({
  byTarget: v.record(v.string(), v.picklist(WORKSPACE_EXTERNAL_APP_IDS)),
})

export const WorkspaceSettingsEntrySchema = v.pipe(
  v.strictObject({
    workspaceId: WorkspaceIdSchema,
    worktreeBootstrapTrust: v.optional(WorktreeBootstrapTrustSchema),
    workspaceExternalAppRecent: v.optional(WorkspaceExternalAppRecentSchema),
  }),
  v.check(
    (entry) =>
      entry.workspaceExternalAppRecent === undefined ||
      Object.keys(entry.workspaceExternalAppRecent.byTarget).every(
        (targetKey) => parseWorkspaceExternalAppRecentKey(entry.workspaceId, targetKey) !== null,
      ),
    'Invalid workspace external-app target',
  ),
)

export const SettingsSnapshotSchema = v.strictObject({
  ...UserSettingsSchema.entries,
  globalShortcutRegistered: v.boolean(),
  recentWorkspaces: v.array(WorkspaceSessionEntrySchema),
  workspaceSettings: v.array(WorkspaceSettingsEntrySchema),
})

export const I18nSnapshotSchema = v.strictObject({
  lang: v.picklist(['en', 'zh', 'ko', 'ja']),
  pref: v.picklist(LANG_PREF_VALUES),
  dict: v.record(v.string(), v.string()),
})

export const UserSettingsUpdateResponseSchema = v.strictObject({
  ok: v.literal(true),
  prefs: UserSettingsSchema,
  i18n: v.optional(I18nSnapshotSchema),
})

export const GlobalShortcutStateResponseSchema = v.strictObject({
  ok: v.literal(true),
  registered: v.boolean(),
})

export const WorkspaceSettingsStateSchema = v.strictObject({
  workspaceSettings: v.array(WorkspaceSettingsEntrySchema),
})

export const ServerWorkspaceStateSchema = v.strictObject({
  openWorkspaceEntries: v.array(WorkspaceSessionEntrySchema),
  workspacePaneTabsByTargetByWorkspace: v.record(
    v.string(),
    v.record(v.string(), v.array(WorkspacePaneStaticTabEntrySchema)),
  ),
})

const RestoredWorkspaceRuntimeBaseEntries = {
  workspaceId: WorkspaceIdSchema,
  workspaceRuntimeId: WorkspaceRuntimeIdSchema,
  name: v.string(),
  entry: WorkspaceSessionEntrySchema,
} as const

const FileTransportSchema = v.strictObject({ kind: v.literal('file') })
const SshTransportSchema = v.strictObject({
  kind: v.literal('ssh'),
  lifecycle: v.variant('kind', [
    v.strictObject({
      kind: v.literal('ready'),
      attemptId: v.pipe(v.number(), v.integer(), v.minValue(0)),
      target: RemoteWorkspaceTargetResponseSchema,
    }),
    v.strictObject({
      kind: v.literal('failed'),
      attemptId: v.pipe(v.number(), v.integer(), v.minValue(0)),
      reason: v.picklist(REMOTE_WORKSPACE_FAILURE_REASONS),
      target: v.optional(RemoteWorkspaceTargetResponseSchema),
    }),
  ]),
})

const RestoredWorkspaceRuntimeSchema = v.union([
    v.strictObject({
      ...RestoredWorkspaceRuntimeBaseEntries,
      transport: FileTransportSchema,
      workspaceProbe: WorkspaceGitReadyProbeResponseSchema,
      gitProjection: RepoProjectionResponseSchema,
    }),
    v.strictObject({
      ...RestoredWorkspaceRuntimeBaseEntries,
      transport: FileTransportSchema,
      workspaceProbe: WorkspaceProbeWithoutGitProjectionResponseSchema,
      gitProjection: v.null(),
    }),
    v.strictObject({
      ...RestoredWorkspaceRuntimeBaseEntries,
      transport: SshTransportSchema,
      workspaceProbe: WorkspaceGitReadyProbeResponseSchema,
      gitProjection: RepoProjectionResponseSchema,
    }),
    v.strictObject({
      ...RestoredWorkspaceRuntimeBaseEntries,
      transport: SshTransportSchema,
      workspaceProbe: WorkspaceProbeWithoutGitProjectionResponseSchema,
      gitProjection: v.null(),
    }),
])

export const WorkspaceRestoreResponseSchema = v.strictObject({
  status: v.picklist(['restored', 'repaired']),
  openWorkspaceEntries: v.array(WorkspaceSessionEntrySchema),
  runtime: v.strictObject({
    workspaces: v.array(RestoredWorkspaceRuntimeSchema),
    workspacePaneTabs: v.array(
      v.strictObject({
        workspaceId: WorkspaceIdSchema,
        workspaceRuntimeId: WorkspaceRuntimeIdSchema,
        snapshot: WorkspacePaneTabsSnapshotSchema,
      }),
    ),
    restoredWorkspaceId: v.nullable(WorkspaceIdSchema),
  }),
})

export const WorkspaceTabsRestoreResponseSchema = v.strictObject({
  workspace: RestoredWorkspaceRuntimeSchema,
  snapshot: v.nullable(WorkspacePaneTabsSnapshotSchema),
})

export const LanInfoSchema = v.strictObject({
  host: v.string(),
  port: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(65_535)),
  lanUrls: v.array(v.string()),
})

const TerminalAppAvailabilitySchema = v.strictObject({
  ghostty: v.boolean(),
  terminal: v.boolean(),
  windowsTerminal: v.boolean(),
})

export const ExternalAppsSnapshotSchema = v.strictObject({
  terminal: v.strictObject({
    available: v.boolean(),
    appAvailability: TerminalAppAvailabilitySchema,
    detectedAt: v.number(),
  }),
  editor: v.strictObject({
    available: v.boolean(),
    appAvailability: v.strictObject({ vscode: v.boolean() }),
    detectedAt: v.number(),
  }),
})

export const OkResponseSchema = v.strictObject({ ok: v.literal(true) })
const GitHubCliHostStateSchema = v.strictObject({
  host: v.string(),
  authenticated: v.boolean(),
  activeLogin: v.nullable(v.string()),
  logins: v.array(v.string()),
  tokenSource: v.nullable(v.string()),
})

export const GitHubCliStateSchema = v.strictObject({
  available: v.boolean(),
  version: v.nullable(v.string()),
  detectedAt: v.number(),
  hosts: v.record(v.string(), GitHubCliHostStateSchema),
})
