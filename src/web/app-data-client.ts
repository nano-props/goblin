import { getInitialBootstrap } from '#/web/bootstrap.ts'
import { canUseGlobalShortcutSettings, canUseNativeRpcBridge, openExternalUrl } from '#/web/app-shell-client.ts'
import { invokeNativeRpcPath } from '#/web/native-host-client.ts'
import type {
  CloneRepoResult,
  EditorPref,
  EditorAppState,
  ExternalAppsSnapshot,
  GitHubCliState,
  GlobalShortcutState,
  I18nPayload,
  LangPref,
  LanInfo,
  PullRequestEntry,
  RepoSnapshot,
  ProbeResult,
  SettingsPrefs,
  SettingsSnapshot,
  TerminalPref,
  TerminalAppState,
  ThemePref,
  ThemeState,
} from '#/shared/rpc.ts'
import type { ExecResult, PullRequestFetchMode, WorktreeStatus } from '#/shared/git-types.ts'
import type { RemoteRepoTarget } from '#/shared/remote-repo.ts'
import type {
  RemoteDiagnosticsResult,
  RemotePathSuggestionsInput,
  RepoSessionEntry,
  SshConfigHostsResult,
} from '#/shared/remote-repo.ts'
import type { ColorTheme } from '#/shared/color-theme.ts'
import { resolveApiBaseUrl } from '#/web/lib/websocket-url.ts'
import { nativeSettingsProjectionStateFromSettings, pickNativeSettingsProjectionPatch } from '#/shared/native-shell-projection.ts'

interface EmbeddedServerConfig {
  url: string
  secret: string
}

function getEmbeddedServer(): EmbeddedServerConfig | null {
  const server = getInitialBootstrap().initialServer
  if (!server?.url || !server?.secret) return null
  return server
}

function requireEmbeddedServer(): EmbeddedServerConfig {
  const server = getEmbeddedServer()
  if (!server) throw new Error('Embedded server unavailable')
  return server
}

async function fetchServerJson<T>(path: string, init?: RequestInit): Promise<T> {
  const server = requireEmbeddedServer()
  const response = await fetch(new URL(path, resolveApiBaseUrl(server.url)).toString(), {
    ...init,
    headers: {
      'x-goblin-internal-secret': server.secret,
      ...(init?.headers ?? {}),
    },
  })
  if (!response.ok) throw new Error(`Server request failed: HTTP ${response.status}`)
  return (await response.json()) as T
}

async function postServerJson<TInput extends object, TOutput>(
  path: string,
  input: TInput,
  options?: { signal?: AbortSignal },
): Promise<TOutput> {
  return await fetchServerJson<TOutput>(path, {
    method: 'POST',
    signal: options?.signal,
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(input),
  })
}

export async function getSettingsSnapshot(): Promise<SettingsSnapshot> {
  return await fetchServerJson<SettingsSnapshot>('/api/settings')
}

export function resolveThemeStateFromSettings(settings: SettingsSnapshot): ThemeState {
  const resolved =
    settings.theme === 'auto'
      ? window.matchMedia?.('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : settings.theme
  return { pref: settings.theme, resolved, colorTheme: settings.colorTheme }
}

export async function getThemeState(): Promise<ThemeState> {
  return resolveThemeStateFromSettings(await getSettingsSnapshot())
}

async function updateSettingsPrefsPatch(settings: Record<string, unknown>): Promise<void> {
  const result = await fetchServerJson<{ ok: boolean; settings: SettingsPrefs }>('/api/settings/prefs', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({ settings }),
  })
  const patch = pickNativeSettingsProjectionPatch(settings as Partial<SettingsPrefs>)
  if (!patch || !canUseNativeRpcBridge()) return
  await invokeNativeRpcPath<void>('settings.applyShellProjection', {
    prefs: {
      patch,
      settings: nativeSettingsProjectionStateFromSettings(result.settings),
    },
  })
}

export async function setThemePref(pref: ThemePref): Promise<ThemeState> {
  await updateSettingsPrefsPatch({ theme: pref })
  return await getThemeState()
}

export async function setThemeColorTheme(colorTheme: ColorTheme): Promise<ThemeState> {
  await updateSettingsPrefsPatch({ colorTheme })
  return await getThemeState()
}

export async function getI18nPayload(): Promise<I18nPayload> {
  return await fetchServerJson<I18nPayload>('/api/settings/i18n')
}

export async function setI18nPref(pref: LangPref): Promise<I18nPayload> {
  await updateSettingsPrefsPatch({ lang: pref })
  return await getI18nPayload()
}

export async function getGitHubCliState(hosts?: string[]): Promise<GitHubCliState> {
  const params = new URLSearchParams()
  for (const host of hosts ?? []) {
    if (host.trim()) params.append('host', host.trim())
  }
  const suffix = params.size > 0 ? `?${params.toString()}` : ''
  return await fetchServerJson<GitHubCliState>(`/api/settings/github-cli${suffix}`)
}

export async function refreshGitHubCliState(hosts?: string[]): Promise<GitHubCliState> {
  return await postServerJson('/api/settings/github-cli/refresh', hosts && hosts.length > 0 ? { hosts } : {})
}

export async function getLanInfo(): Promise<LanInfo> {
  return await fetchServerJson('/api/settings/lan')
}

export async function setLanEnabled(enabled: boolean): Promise<void> {
  await updateSettingsPrefsPatch({ lanEnabled: enabled })
}

export async function getExternalAppsSnapshot(): Promise<ExternalAppsSnapshot> {
  return await fetchServerJson<ExternalAppsSnapshot>('/api/settings/external-apps')
}

export async function refreshExternalAppsSnapshot(): Promise<ExternalAppsSnapshot> {
  return await postServerJson('/api/settings/external-apps/refresh', {})
}

export async function probeRepository(cwd: string): Promise<ProbeResult> {
  return await postServerJson('/api/repo/probe', { cwd })
}

export async function resolveRemoteRepositoryTarget(ref: {
  alias: string
  remotePath: string
}): Promise<RemoteRepoTarget> {
  const result = await postServerJson<typeof ref, RemoteRepoTarget | { target: RemoteRepoTarget }>(
    '/api/remote/resolve-target',
    ref,
  )
  return 'target' in result ? result.target : result
}

export async function getRemoteSshHosts(): Promise<SshConfigHostsResult> {
  return await fetchServerJson<SshConfigHostsResult>('/api/remote/ssh-hosts')
}

export async function getRemotePathSuggestions(
  input: RemotePathSuggestionsInput,
  signal?: AbortSignal,
): Promise<string[]> {
  return await postServerJson('/api/remote/path-suggestions', input, { signal })
}

export async function testRemoteRepositoryConnection(
  target: RemoteRepoTarget,
  signal?: AbortSignal,
): Promise<RemoteDiagnosticsResult> {
  return await postServerJson('/api/remote/test-repository', { target }, { signal })
}

export async function addRecentRepo(repo: RepoSessionEntry): Promise<void> {
  const result = await postServerJson<
    { repo: RepoSessionEntry },
    { ok: boolean; recentRepos: RepoSessionEntry[]; addedRepo?: RepoSessionEntry | null }
  >('/api/settings/recent-repos/add', { repo })
  if (!canUseNativeRpcBridge()) return
  await invokeNativeRpcPath<void>('settings.applyShellProjection', {
    recentRepos: {
      recentRepos: result.recentRepos,
      ...(result.addedRepo ? { addedRepo: result.addedRepo } : {}),
    },
  })
}

export async function saveSession(session: SettingsSnapshot['session']): Promise<void> {
  await postServerJson('/api/settings/session', { session })
}

export async function setSettingsFetchInterval(sec: number): Promise<number> {
  const result = await postServerJson<{ sec: number }, { ok: boolean; fetchIntervalSec: number }>(
    '/api/settings/fetch-interval',
    { sec },
  )
  return result.fetchIntervalSec
}

export async function setTerminalNotificationsEnabled(enabled: boolean): Promise<void> {
  await updateSettingsPrefsPatch({ terminalNotificationsEnabled: enabled })
}

export async function setShortcutsDisabled(disabled: boolean): Promise<void> {
  await updateSettingsPrefsPatch({ shortcutsDisabled: disabled })
}

export async function setGlobalShortcutDisabled(disabled: boolean): Promise<void> {
  await updateSettingsPrefsPatch({ globalShortcutDisabled: disabled })
}

export async function setSwapCloseShortcuts(swapped: boolean): Promise<void> {
  await updateSettingsPrefsPatch({ swapCloseShortcuts: swapped })
}

export async function setToggleDetailOnActionBarBlankClick(enabled: boolean): Promise<void> {
  await updateSettingsPrefsPatch({ toggleDetailOnActionBarBlankClick: enabled })
}

export async function setGlobalShortcut(accelerator: string): Promise<GlobalShortcutState> {
  if (!canUseGlobalShortcutSettings()) throw new Error('Global shortcut unavailable')
  return await invokeNativeRpcPath<GlobalShortcutState>('settings.setGlobalShortcut', { accelerator })
}

export async function setPreferredTerminalApp(pref: TerminalPref): Promise<TerminalAppState> {
  await updateSettingsPrefsPatch({ terminalApp: pref })
  return (await getExternalAppsSnapshot()).terminal
}

export async function setPreferredEditorApp(pref: EditorPref): Promise<EditorAppState> {
  await updateSettingsPrefsPatch({ editorApp: pref })
  return (await getExternalAppsSnapshot()).editor
}

export async function cloneRepository(input: {
  operationId: string
  url: string
  parentPath: string
  directoryName: string
}): Promise<CloneRepoResult> {
  return await postServerJson('/api/repo/clone', input)
}

export async function abortCloneOperation(operationId: string): Promise<boolean> {
  return await postServerJson('/api/repo/abort-clone', { operationId })
}

export async function getRepositorySnapshot(cwd: string, signal?: AbortSignal): Promise<RepoSnapshot | null> {
  return await postServerJson('/api/repo/snapshot', { cwd }, { signal })
}

export async function getRepositoryStatus(cwd: string, signal?: AbortSignal): Promise<WorktreeStatus[]> {
  return await postServerJson('/api/repo/status', { cwd }, { signal })
}

export async function getRepositoryPullRequests(
  cwd: string,
  branches?: string[],
  options?: { mode?: PullRequestFetchMode },
  signal?: AbortSignal,
): Promise<PullRequestEntry[] | null> {
  return await postServerJson('/api/repo/pull-requests', { cwd, branches, options }, { signal })
}

export async function abortRepositoryOperation(cwd: string): Promise<boolean> {
  return await postServerJson('/api/repo/abort', { cwd })
}

export async function fetchRepository(
  cwd: string,
  kind?: 'user' | 'background',
  signal?: AbortSignal,
  sourceToken?: string,
): Promise<{ ok: boolean; message: string }> {
  return await postServerJson('/api/repo/fetch', kind ? { cwd, kind, sourceToken } : { cwd, sourceToken }, { signal })
}

export async function checkoutRepositoryBranch(
  cwd: string,
  branch: string,
  signal?: AbortSignal,
  sourceToken?: string,
): Promise<ExecResult> {
  return await postServerJson('/api/repo/checkout', { cwd, branch, sourceToken }, { signal })
}

export async function pullRepositoryBranch(
  cwd: string,
  branch: string,
  worktreePath?: string,
  signal?: AbortSignal,
  sourceToken?: string,
): Promise<ExecResult> {
  return await postServerJson('/api/repo/pull', { cwd, branch, worktreePath, sourceToken }, { signal })
}

export async function pushRepositoryBranch(
  cwd: string,
  branch: string,
  signal?: AbortSignal,
  sourceToken?: string,
): Promise<ExecResult> {
  return await postServerJson('/api/repo/push', { cwd, branch, sourceToken }, { signal })
}

export async function createRepositoryWorktree(
  cwd: string,
  worktreePath: string,
  newBranch: string,
  baseBranch: string,
  signal?: AbortSignal,
  sourceToken?: string,
): Promise<ExecResult> {
  return await postServerJson('/api/repo/create-worktree', { cwd, worktreePath, newBranch, baseBranch, sourceToken }, { signal })
}

export async function deleteRepositoryBranch(
  cwd: string,
  branch: string,
  options?: { force?: boolean; alsoDeleteUpstream?: boolean },
  signal?: AbortSignal,
  sourceToken?: string,
): Promise<ExecResult> {
  return await postServerJson(
    '/api/repo/delete-branch',
    { cwd, branch, force: options?.force, alsoDeleteUpstream: options?.alsoDeleteUpstream, sourceToken },
    { signal },
  )
}

export async function removeRepositoryWorktree(
  cwd: string,
  options: {
    branch: string
    worktreePath: string
    alsoDeleteBranch: boolean
    forceDeleteBranch?: boolean
    alsoDeleteUpstream?: boolean
  },
  signal?: AbortSignal,
  sourceToken?: string,
): Promise<ExecResult> {
  return await postServerJson('/api/repo/remove-worktree', { cwd, ...options, sourceToken }, { signal })
}

export async function getRepositoryPatch(cwd: string, worktreePath: string, signal?: AbortSignal): Promise<ExecResult> {
  return await postServerJson('/api/repo/patch', { cwd, worktreePath }, { signal })
}

export async function openRepositoryRemote(cwd: string, branch?: string): Promise<ExecResult> {
  const result = await postServerJson<{ cwd: string; branch?: string }, ExecResult>(
    '/api/repo/open-remote',
    branch ? { cwd, branch } : { cwd },
  )
  if (!result.ok || !result.message) return result
  const opened = await openExternalUrl(result.message)
  return opened.ok ? { ok: true, message: '' } : opened
}

export async function openRepositoryTerminal(path: string): Promise<ExecResult> {
  return await postServerJson('/api/repo/open-terminal', { path })
}

export async function openRepositoryEditor(path: string): Promise<ExecResult> {
  return await postServerJson('/api/repo/open-editor', { path })
}

export async function setBackgroundSyncRepos(repoIds: string[]): Promise<void> {
  await fetchServerJson<{ ok: boolean }>('/api/repo/background-sync-repos', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({ repoIds }),
  })
}
