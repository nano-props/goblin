import { useEffect } from 'react'
import QRCode from 'qrcode'
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  EditorAppState,
  EditorPref,
  ExternalAppsSnapshot,
  GitHubCliState,
  GlobalShortcutState,
  LanInfo,
  SettingsSnapshot,
  TerminalAppState,
  TerminalPref,
} from '#/shared/rpc.ts'
import {
  getExternalAppsSnapshot,
  getGitHubCliState,
  getLanInfo,
  getSettingsSnapshot,
  refreshExternalAppsSnapshot,
  refreshGitHubCliState,
  setGlobalShortcut,
  setGlobalShortcutDisabled,
  setLanEnabled,
  setPreferredEditorApp,
  setPreferredTerminalApp,
  setSettingsFetchInterval,
  setShortcutsDisabled,
  setSwapCloseShortcuts,
  setTerminalNotificationsEnabled,
  setToggleDetailOnActionBarBlankClick,
} from '#/web/app-data-client.ts'
import { getInitialBootstrap } from '#/web/bootstrap.ts'
import { subscribeSettingsInvalidation } from '#/web/settings-invalidation-ingress.ts'
import { DEFAULT_COLOR_THEME } from '#/shared/color-theme.ts'
import { DEFAULT_DETAIL_PANE_SIZES, DEFAULT_WORKSPACE_LAYOUT } from '#/shared/workspace-layout.ts'

function initialSettingsSnapshot(): SettingsSnapshot | undefined {
  const initialSettings = getInitialBootstrap().initialSettings
  const initialI18n = getInitialBootstrap().initialI18n
  if (!initialSettings) return undefined
  return {
    lang: initialI18n?.pref ?? 'auto',
    theme: 'auto',
    colorTheme: DEFAULT_COLOR_THEME,
    ...initialSettings,
    session: {
      openRepos: [],
      activeRepo: null,
      detailCollapsed: true,
      detailFocusMode: false,
      workspaceLayout: DEFAULT_WORKSPACE_LAYOUT,
      detailPaneSizes: DEFAULT_DETAIL_PANE_SIZES,
      selectedTerminalByWorktree: {},
    },
    recentRepos: [],
  }
}

function initialExternalAppsSnapshot(): ExternalAppsSnapshot | undefined {
  const initialSettings = getInitialBootstrap().initialSettings
  if (!initialSettings) return undefined
  return {
    terminal: {
      pref: initialSettings.terminalApp,
      resolved: null,
      available: false,
      appAvailability: { ghostty: false, terminal: false },
      detectedAt: 0,
    },
    editor: {
      pref: initialSettings.editorApp,
      resolved: null,
      available: false,
      appAvailability: { vscode: false, cursor: false, windsurf: false },
      detectedAt: 0,
    },
  }
}

function initialGitHubCliState(): GitHubCliState {
  return {
    available: false,
    version: null,
    detectedAt: 0,
    hosts: {},
  }
}

export function settingsSnapshotQueryKey() {
  return ['settings', 'snapshot'] as const
}

export function externalAppsQueryKey() {
  return ['settings', 'external-apps'] as const
}

export function githubCliQueryKey(hosts?: string[]) {
  return ['settings', 'github-cli', ...(hosts?.filter((host) => host.trim()).sort() ?? [])] as const
}

export function lanInfoQueryKey() {
  return ['settings', 'lan'] as const
}

export function settingsSnapshotQueryOptions() {
  return queryOptions<SettingsSnapshot>({
    queryKey: settingsSnapshotQueryKey(),
    queryFn: getSettingsSnapshot,
    initialData: initialSettingsSnapshot,
    staleTime: 0,
    gcTime: 5 * 60_000,
  })
}

export function externalAppsQueryOptions() {
  return queryOptions<ExternalAppsSnapshot>({
    queryKey: externalAppsQueryKey(),
    queryFn: getExternalAppsSnapshot,
    initialData: initialExternalAppsSnapshot,
    staleTime: 0,
    gcTime: 5 * 60_000,
  })
}

export function githubCliQueryOptions(hosts?: string[]) {
  return queryOptions<GitHubCliState>({
    queryKey: githubCliQueryKey(hosts),
    queryFn: () => getGitHubCliState(hosts),
    initialData: initialGitHubCliState,
    staleTime: 0,
    gcTime: 5 * 60_000,
  })
}

export interface LanInfoWithQrCodes extends LanInfo {
  qrCodes: Record<string, string>
}

export function lanInfoQueryOptions() {
  return queryOptions<LanInfoWithQrCodes>({
    queryKey: lanInfoQueryKey(),
    queryFn: async () => {
      const info = await getLanInfo()
      const qrCodes: Record<string, string> = {}
      for (const url of info.lanUrls) {
        try {
          qrCodes[url] = await QRCode.toDataURL(url, { width: 180, margin: 2 })
        } catch {
          // ignore
        }
      }
      return { ...info, qrCodes }
    },
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
  })
}

export function useSettingsSnapshotQuery() {
  return useQuery(settingsSnapshotQueryOptions())
}

export function useExternalAppsQuery() {
  return useQuery(externalAppsQueryOptions())
}

export function useGitHubCliQuery(hosts?: string[]) {
  return useQuery(githubCliQueryOptions(hosts))
}

export function useLanInfoQuery() {
  return useQuery(lanInfoQueryOptions())
}

function updateSettingsSnapshotCache(
  queryClient: ReturnType<typeof useQueryClient>,
  update: (current: SettingsSnapshot) => SettingsSnapshot,
) {
  queryClient.setQueryData(settingsSnapshotQueryKey(), (current: SettingsSnapshot | undefined) =>
    current ? update(current) : current,
  )
}

function updateExternalAppsCache(
  queryClient: ReturnType<typeof useQueryClient>,
  update: (current: ExternalAppsSnapshot) => ExternalAppsSnapshot,
) {
  queryClient.setQueryData(externalAppsQueryKey(), (current: ExternalAppsSnapshot | undefined) =>
    current ? update(current) : current,
  )
}

function updateGitHubCliCache(
  queryClient: ReturnType<typeof useQueryClient>,
  hosts: string[] | undefined,
  state: GitHubCliState,
) {
  queryClient.setQueryData(githubCliQueryKey(hosts), state)
  if (!hosts || hosts.length === 0) queryClient.setQueryData(githubCliQueryKey(), state)
}

export function useSettingsQueryInvalidationSync() {
  const queryClient = useQueryClient()
  useEffect(
    () =>
      subscribeSettingsInvalidation((event) => {
        if (event.scopes.includes('settings-snapshot')) {
          void queryClient.invalidateQueries({ queryKey: settingsSnapshotQueryKey(), exact: true })
        }
        if (event.scopes.includes('external-apps')) {
          void queryClient.invalidateQueries({ queryKey: externalAppsQueryKey(), exact: true })
        }
      }),
    [queryClient],
  )
}

export function useSetFetchIntervalMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: setSettingsFetchInterval,
    onSuccess(fetchIntervalSec) {
      updateSettingsSnapshotCache(queryClient, (current) => ({ ...current, fetchIntervalSec }))
    },
  })
}

export function useSetTerminalNotificationsEnabledMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: setTerminalNotificationsEnabled,
    onSuccess(_value, enabled) {
      updateSettingsSnapshotCache(queryClient, (current) => ({ ...current, terminalNotificationsEnabled: enabled }))
    },
  })
}

export function useSetShortcutsDisabledMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: setShortcutsDisabled,
    onSuccess(_value, disabled) {
      updateSettingsSnapshotCache(queryClient, (current) => ({ ...current, shortcutsDisabled: disabled }))
    },
  })
}

export function useSetGlobalShortcutDisabledMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: setGlobalShortcutDisabled,
    onSuccess(_value, disabled) {
      updateSettingsSnapshotCache(queryClient, (current) => ({ ...current, globalShortcutDisabled: disabled }))
    },
  })
}

export function useSetSwapCloseShortcutsMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: setSwapCloseShortcuts,
    onSuccess(_value, swapped) {
      updateSettingsSnapshotCache(queryClient, (current) => ({ ...current, swapCloseShortcuts: swapped }))
    },
  })
}

export function useSetToggleDetailOnActionBarBlankClickMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: setToggleDetailOnActionBarBlankClick,
    onSuccess(_value, enabled) {
      updateSettingsSnapshotCache(queryClient, (current) => ({ ...current, toggleDetailOnActionBarBlankClick: enabled }))
    },
  })
}

export function useSetGlobalShortcutMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: setGlobalShortcut,
    onSuccess(state: GlobalShortcutState) {
      updateSettingsSnapshotCache(queryClient, (current) => ({
        ...current,
        globalShortcut: state.accelerator,
        globalShortcutRegistered: state.registered,
      }))
    },
  })
}

export function useSetTerminalAppMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: setPreferredTerminalApp,
    onSuccess(state: TerminalAppState) {
      updateExternalAppsCache(queryClient, (current) => ({ ...current, terminal: state }))
      updateSettingsSnapshotCache(queryClient, (current) => ({ ...current, terminalApp: state.pref }))
    },
  })
}

export function useSetEditorAppMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: setPreferredEditorApp,
    onSuccess(state: EditorAppState) {
      updateExternalAppsCache(queryClient, (current) => ({ ...current, editor: state }))
      updateSettingsSnapshotCache(queryClient, (current) => ({ ...current, editorApp: state.pref }))
    },
  })
}

export function useRefreshExternalAppsMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: refreshExternalAppsSnapshot,
    onSuccess(state) {
      queryClient.setQueryData(externalAppsQueryKey(), state)
    },
  })
}

export function useRefreshGitHubCliMutation(hosts?: string[]) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => refreshGitHubCliState(hosts),
    onSuccess(state) {
      updateGitHubCliCache(queryClient, hosts, state)
    },
  })
}

export function useSetLanEnabledMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: setLanEnabled,
    onSuccess(_value, enabled) {
      updateSettingsSnapshotCache(queryClient, (current) => ({ ...current, lanEnabled: enabled }))
      void queryClient.invalidateQueries({ queryKey: lanInfoQueryKey() })
    },
  })
}
