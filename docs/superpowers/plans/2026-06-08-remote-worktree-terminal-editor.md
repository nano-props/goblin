# Remote Worktree Terminal And Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This repository's `AGENTS.md` says not to plan or execute git commits unless the user explicitly asks, so this plan intentionally omits commit steps.

**Goal:** Enable remote repository worktrees to open a Goblin-managed SSH terminal and the configured VS Code-family editor through Remote SSH.

**Architecture:** Keep terminal behavior on the existing server-backed terminal catalog. Add one focused remote editor opener in the server/system path, then expose it through the existing remote API and branch action UI. Preserve local terminal/editor behavior unchanged.

**Tech Stack:** TypeScript, React 19, Hono server routes, Vitest, Bun, execa, existing Goblin server/client bridge.

---

## File Structure

- Modify `src/system/open-app.ts`  
  Add a remote CLI opener beside the existing local directory opener. Keep local filesystem validation private to local opening.

- Modify `src/system/vscode.ts`, `src/system/cursor.ts`, `src/system/windsurf.ts`  
  Export remote editor functions that call the shared remote CLI opener.

- Modify `src/system/editors.ts`  
  Extend the editor backend registry with optional remote opening and add `openRemoteInPreferredEditor()`.

- Add `src/system/open-app.test.ts`  
  Verify Remote SSH CLI arguments, invalid remote inputs, missing CLI, and CLI failure behavior.

- Add `src/system/editors.test.ts`  
  Verify editor preference resolution and unsupported remote backend behavior.

- Modify `src/server/modules/remote.ts`  
  Add `openServerRemoteEditor()` that validates repo id/path, re-resolves SSH config, reads settings, and calls the remote editor opener.

- Add `src/server/modules/remote.test.ts`  
  Verify remote editor module success and validation failures.

- Modify `src/server/routes/remote.ts`  
  Add `POST /open-editor`.

- Add `src/server/routes/remote.test.ts`  
  Verify request body mapping for `POST /open-editor`.

- Modify `src/web/app-data-client.ts`  
  Add `openRemoteRepositoryEditor(repoId, worktreePath)`.

- Modify `src/web/remote-client.test.ts`  
  Verify the remote editor client posts to `/api/remote/open-editor`.

- Modify `src/web/hooks/useBranchActions.tsx`  
  Allow remote terminal and editor actions. Remote terminal opens the Terminal detail tab; remote editor calls the new client route.

- Modify `src/web/hooks/useBranchActionItems.ts`  
  Let remote Terminal appear without local terminal app availability.

- Add `src/web/hooks/useBranchActionItems.test.tsx`  
  Verify remote Terminal visibility when local terminal availability is false.

- Modify `src/web/stores/repos/branch-actions.test.ts` and `src/web/hooks/useBranchActions.test.tsx`  
  Update remote worktree capability expectations and action behavior tests.

- Modify `src/shared/i18n/en.ts`, `src/shared/i18n/zh.ts`, `src/shared/i18n/ko.ts`, `src/shared/i18n/ja.ts`  
  Add `error.remote-editor-not-supported`.

---

### Task 1: System Remote Editor Opener

**Files:**
- Modify: `src/system/open-app.ts`
- Modify: `src/system/vscode.ts`
- Modify: `src/system/cursor.ts`
- Modify: `src/system/windsurf.ts`
- Modify: `src/system/editors.ts`
- Add: `src/system/open-app.test.ts`
- Add: `src/system/editors.test.ts`

- [ ] **Step 1: Write failing tests for the shared remote CLI opener**

Create `src/system/open-app.test.ts`:

```ts
import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  execa: vi.fn(),
  existsSync: vi.fn(),
  homedir: vi.fn(() => '/Users/test'),
}))

vi.mock('execa', () => ({ execa: mocks.execa }))
vi.mock('node:fs', () => ({
  existsSync: mocks.existsSync,
  statSync: vi.fn(() => ({ isDirectory: () => true })),
}))
vi.mock('node:os', () => ({ default: { homedir: mocks.homedir } }))

describe('openRemoteByAppCli', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.existsSync.mockImplementation((path: string) =>
      path === '/Applications/Visual Studio Code.app' ||
      path === '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code',
    )
    mocks.execa.mockResolvedValue({ failed: false })
  })

  test('opens a VS Code-family editor with Remote SSH arguments', async () => {
    const { openRemoteByAppCli } = await import('#/system/open-app.ts')

    await expect(openRemoteByAppCli('Visual Studio Code', 'code', 'prod', '/srv/repo-feature')).resolves.toEqual({
      ok: true,
      message: '/srv/repo-feature',
    })

    expect(mocks.execa).toHaveBeenCalledWith(
      '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code',
      ['--remote', 'ssh-remote+prod', '/srv/repo-feature'],
      expect.objectContaining({ timeout: 10_000, reject: false }),
    )
  })

  test('rejects invalid remote aliases and paths before invoking the editor', async () => {
    const { openRemoteByAppCli } = await import('#/system/open-app.ts')

    await expect(openRemoteByAppCli('Visual Studio Code', 'code', 'bad alias', '/srv/repo')).resolves.toEqual({
      ok: false,
      message: 'error.invalid-arguments',
    })
    await expect(openRemoteByAppCli('Visual Studio Code', 'code', 'prod', 'relative/repo')).resolves.toEqual({
      ok: false,
      message: 'error.invalid-arguments',
    })

    expect(mocks.execa).not.toHaveBeenCalled()
  })

  test('returns editor-not-installed when the CLI cannot be found', async () => {
    mocks.existsSync.mockReturnValue(false)
    const { openRemoteByAppCli } = await import('#/system/open-app.ts')

    await expect(openRemoteByAppCli('Visual Studio Code', 'code', 'prod', '/srv/repo')).resolves.toEqual({
      ok: false,
      message: 'error.editor-not-installed',
    })
  })

  test('returns CLI error output when the editor command fails', async () => {
    mocks.execa.mockResolvedValue({
      failed: true,
      stderr: 'Remote SSH extension is unavailable',
      shortMessage: 'failed',
      message: 'failed',
    })
    const { openRemoteByAppCli } = await import('#/system/open-app.ts')

    await expect(openRemoteByAppCli('Visual Studio Code', 'code', 'prod', '/srv/repo')).resolves.toEqual({
      ok: false,
      message: 'Remote SSH extension is unavailable',
    })
  })
})
```

- [ ] **Step 2: Run the opener tests and verify they fail**

Run:

```bash
bun run test src/system/open-app.test.ts
```

Expected: FAIL because `openRemoteByAppCli` is not exported.

- [ ] **Step 3: Implement the shared remote opener**

In `src/system/open-app.ts`, add the helpers below after `openByAppCli()`:

```ts
function isSafeRemoteAlias(alias: string): boolean {
  return alias.length > 0 && alias.length <= 255 && !/[\s\0/?#\\]/.test(alias)
}

function isSafeRemoteAbsolutePath(remotePath: string): boolean {
  return (
    remotePath.length > 0 &&
    remotePath.length <= 4096 &&
    remotePath.startsWith('/') &&
    !/[\0-\x1f\x7f]/.test(remotePath)
  )
}

export function openRemoteByAppCli(
  appName: string,
  cliName: string,
  alias: string,
  remotePath: string,
): Promise<{ ok: boolean; message: string }> {
  if (!isSafeRemoteAlias(alias) || !isSafeRemoteAbsolutePath(remotePath)) {
    return Promise.resolve({ ok: false, message: 'error.invalid-arguments' })
  }

  const cli = resolveAppCli(appName, cliName)
  if (!cli) return Promise.resolve({ ok: false, message: 'error.editor-not-installed' })

  return execa(cli, ['--remote', `ssh-remote+${alias}`, remotePath], {
    timeout: OPEN_TIMEOUT_MS,
    forceKillAfterDelay: 500,
    reject: false,
  }).then((result) => {
    if (result.failed) {
      const message = result.stderr?.trim() || result.shortMessage || result.message || 'error.remote-editor-not-supported'
      return { ok: false, message }
    }
    return { ok: true, message: remotePath }
  })
}
```

- [ ] **Step 4: Run the opener tests and verify they pass**

Run:

```bash
bun run test src/system/open-app.test.ts
```

Expected: PASS.

- [ ] **Step 5: Write failing tests for preferred remote editor resolution**

Create `src/system/editors.test.ts`:

```ts
import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  vscodeInstalled: vi.fn(() => false),
  cursorInstalled: vi.fn(() => false),
  windsurfInstalled: vi.fn(() => false),
  openRemoteVSCode: vi.fn(),
  openRemoteCursor: vi.fn(),
  openRemoteWindsurf: vi.fn(),
}))

vi.mock('#/system/vscode.ts', () => ({
  isVSCodeInstalled: mocks.vscodeInstalled,
  openInVSCode: vi.fn(),
  openRemoteInVSCode: mocks.openRemoteVSCode,
}))
vi.mock('#/system/cursor.ts', () => ({
  isCursorInstalled: mocks.cursorInstalled,
  openInCursor: vi.fn(),
  openRemoteInCursor: mocks.openRemoteCursor,
}))
vi.mock('#/system/windsurf.ts', () => ({
  isWindsurfInstalled: mocks.windsurfInstalled,
  openInWindsurf: vi.fn(),
  openRemoteInWindsurf: mocks.openRemoteWindsurf,
}))

describe('openRemoteInPreferredEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.openRemoteVSCode.mockResolvedValue({ ok: true, message: '/srv/repo' })
    mocks.openRemoteCursor.mockResolvedValue({ ok: true, message: '/srv/repo' })
    mocks.openRemoteWindsurf.mockResolvedValue({ ok: true, message: '/srv/repo' })
  })

  test('opens the explicitly selected remote editor when it is installed', async () => {
    mocks.cursorInstalled.mockReturnValue(true)
    const { openRemoteInPreferredEditor } = await import('#/system/editors.ts')

    await expect(openRemoteInPreferredEditor('prod', '/srv/repo', 'cursor')).resolves.toEqual({
      ok: true,
      message: '/srv/repo',
    })

    expect(mocks.openRemoteCursor).toHaveBeenCalledWith('prod', '/srv/repo')
    expect(mocks.openRemoteVSCode).not.toHaveBeenCalled()
  })

  test('uses auto priority for remote editors', async () => {
    mocks.vscodeInstalled.mockReturnValue(false)
    mocks.cursorInstalled.mockReturnValue(true)
    mocks.windsurfInstalled.mockReturnValue(true)
    const { openRemoteInPreferredEditor } = await import('#/system/editors.ts')

    await openRemoteInPreferredEditor('prod', '/srv/repo', 'auto')

    expect(mocks.openRemoteCursor).toHaveBeenCalledWith('prod', '/srv/repo')
    expect(mocks.openRemoteWindsurf).not.toHaveBeenCalled()
  })

  test('returns editor-not-installed when no configured editor is available', async () => {
    const { openRemoteInPreferredEditor } = await import('#/system/editors.ts')

    await expect(openRemoteInPreferredEditor('prod', '/srv/repo', 'auto')).resolves.toEqual({
      ok: false,
      message: 'error.editor-not-installed',
    })
  })
})
```

- [ ] **Step 6: Run the editor tests and verify they fail**

Run:

```bash
bun run test src/system/editors.test.ts
```

Expected: FAIL because `openRemoteInPreferredEditor` and per-editor remote functions do not exist.

- [ ] **Step 7: Add per-editor remote functions**

In `src/system/vscode.ts`, change the import and add the function:

```ts
import { hasAppCli, openByAppCli, openRemoteByAppCli } from '#/system/open-app.ts'

const APP_NAME = 'Visual Studio Code'
const CLI_NAME = 'code'

export function isVSCodeInstalled(): boolean {
  return hasAppCli(APP_NAME, CLI_NAME)
}

export function openInVSCode(p: string): Promise<{ ok: boolean; message: string }> {
  return openByAppCli(APP_NAME, CLI_NAME, p)
}

export function openRemoteInVSCode(alias: string, remotePath: string): Promise<{ ok: boolean; message: string }> {
  return openRemoteByAppCli(APP_NAME, CLI_NAME, alias, remotePath)
}
```

In `src/system/cursor.ts`, use:

```ts
import { hasAppCli, openByAppCli, openRemoteByAppCli } from '#/system/open-app.ts'

const APP_NAME = 'Cursor'
const CLI_NAME = 'cursor'

export function isCursorInstalled(): boolean {
  return hasAppCli(APP_NAME, CLI_NAME)
}

export function openInCursor(p: string): Promise<{ ok: boolean; message: string }> {
  return openByAppCli(APP_NAME, CLI_NAME, p)
}

export function openRemoteInCursor(alias: string, remotePath: string): Promise<{ ok: boolean; message: string }> {
  return openRemoteByAppCli(APP_NAME, CLI_NAME, alias, remotePath)
}
```

In `src/system/windsurf.ts`, use:

```ts
import { hasAppCli, openByAppCli, openRemoteByAppCli } from '#/system/open-app.ts'

const APP_NAME = 'Windsurf'
const CLI_NAME = 'windsurf'

export function isWindsurfInstalled(): boolean {
  return hasAppCli(APP_NAME, CLI_NAME)
}

export function openInWindsurf(p: string): Promise<{ ok: boolean; message: string }> {
  return openByAppCli(APP_NAME, CLI_NAME, p)
}

export function openRemoteInWindsurf(alias: string, remotePath: string): Promise<{ ok: boolean; message: string }> {
  return openRemoteByAppCli(APP_NAME, CLI_NAME, alias, remotePath)
}
```

- [ ] **Step 8: Extend the editor registry**

In `src/system/editors.ts`, update imports and backend shape:

```ts
import { isVSCodeInstalled, openInVSCode, openRemoteInVSCode } from '#/system/vscode.ts'
import { isCursorInstalled, openInCursor, openRemoteInCursor } from '#/system/cursor.ts'
import { isWindsurfInstalled, openInWindsurf, openRemoteInWindsurf } from '#/system/windsurf.ts'
```

Replace `EditorBackend` with:

```ts
export interface EditorBackend {
  isInstalled: () => boolean
  open: (path: string) => Promise<{ ok: boolean; message: string }>
  openRemote?: (alias: string, remotePath: string) => Promise<{ ok: boolean; message: string }>
}
```

Replace the `backends` map with:

```ts
const backends: Record<ResolvedEditorApp, EditorBackend> = {
  vscode: { isInstalled: isVSCodeInstalled, open: openInVSCode, openRemote: openRemoteInVSCode },
  cursor: { isInstalled: isCursorInstalled, open: openInCursor, openRemote: openRemoteInCursor },
  windsurf: { isInstalled: isWindsurfInstalled, open: openInWindsurf, openRemote: openRemoteInWindsurf },
}
```

Add this function after `openInPreferredEditor()`:

```ts
export function openRemoteInPreferredEditor(
  alias: string,
  remotePath: string,
  pref: EditorPref,
): Promise<{ ok: boolean; message: string }> {
  const resolved = resolveEditorApp(pref, getEditorAppAvailability())
  if (!resolved) return Promise.resolve({ ok: false, message: 'error.editor-not-installed' })
  const openRemote = backends[resolved].openRemote
  return openRemote
    ? openRemote(alias, remotePath)
    : Promise.resolve({ ok: false, message: 'error.remote-editor-not-supported' })
}
```

- [ ] **Step 9: Run the system editor tests**

Run:

```bash
bun run test src/system/open-app.test.ts src/system/editors.test.ts src/system/terminals.test.ts
```

Expected: PASS.

---

### Task 2: Server Remote Editor API

**Files:**
- Modify: `src/server/modules/remote.ts`
- Add: `src/server/modules/remote.test.ts`
- Modify: `src/server/routes/remote.ts`
- Add: `src/server/routes/remote.test.ts`
- Modify: `src/web/app-data-client.ts`
- Modify: `src/web/remote-client.test.ts`

- [ ] **Step 1: Write failing module tests**

Create `src/server/modules/remote.test.ts`:

```ts
import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolveRemoteTarget: vi.fn(),
  getServerSettingsPrefs: vi.fn(),
  openRemoteInPreferredEditor: vi.fn(),
}))

vi.mock('#/system/ssh/config.ts', () => ({
  listSshConfigHosts: vi.fn(),
  resolveRemoteTarget: mocks.resolveRemoteTarget,
  resolveTrackedRemoteTarget: vi.fn(),
}))
vi.mock('#/system/ssh/commands.ts', () => ({ runRemoteCommand: vi.fn() }))
vi.mock('#/system/ssh/diagnostics.ts', () => ({ testRemoteRepository: vi.fn() }))
vi.mock('#/server/modules/settings-source.ts', () => ({
  getServerSettingsPrefs: mocks.getServerSettingsPrefs,
}))
vi.mock('#/system/editors.ts', () => ({
  openRemoteInPreferredEditor: mocks.openRemoteInPreferredEditor,
}))

describe('openServerRemoteEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getServerSettingsPrefs.mockResolvedValue({
      theme: 'auto',
      colorTheme: 'macos',
      lang: 'auto',
      fetchIntervalSec: 120,
      terminalNotificationsEnabled: false,
      shortcutsDisabled: false,
      globalShortcutDisabled: false,
      swapCloseShortcuts: false,
      toggleDetailOnActionBarBlankClick: false,
      globalShortcut: 'CommandOrControl+Shift+G',
      terminalApp: 'auto',
      editorApp: 'vscode',
    })
    mocks.resolveRemoteTarget.mockResolvedValue({
      target: {
        id: 'ssh-config://prod/srv/repo',
        alias: 'prod',
        host: 'example.com',
        user: 'alice',
        port: 22,
        remotePath: '/srv/repo',
        displayName: 'prod:repo',
      },
    })
    mocks.openRemoteInPreferredEditor.mockResolvedValue({ ok: true, message: '/srv/repo-feature' })
  })

  test('resolves ssh config and opens the configured remote editor', async () => {
    const { openServerRemoteEditor } = await import('#/server/modules/remote.ts')

    await expect(
      openServerRemoteEditor({ repoId: 'ssh-config://prod/srv/repo', worktreePath: '/srv/repo-feature' }),
    ).resolves.toEqual({ ok: true, message: '/srv/repo-feature' })

    expect(mocks.resolveRemoteTarget).toHaveBeenCalledWith({ alias: 'prod', remotePath: '/srv/repo' }, undefined)
    expect(mocks.openRemoteInPreferredEditor).toHaveBeenCalledWith('prod', '/srv/repo-feature', 'vscode')
  })

  test('rejects invalid repo ids and remote worktree paths', async () => {
    const { openServerRemoteEditor } = await import('#/server/modules/remote.ts')

    await expect(openServerRemoteEditor({ repoId: '/tmp/local', worktreePath: '/srv/repo' })).resolves.toEqual({
      ok: false,
      message: 'error.invalid-arguments',
    })
    await expect(
      openServerRemoteEditor({ repoId: 'ssh-config://prod/srv/repo', worktreePath: 'relative/repo' }),
    ).resolves.toEqual({ ok: false, message: 'error.invalid-arguments' })

    expect(mocks.openRemoteInPreferredEditor).not.toHaveBeenCalled()
  })

  test('returns ssh-config-changed when the saved remote no longer resolves', async () => {
    mocks.resolveRemoteTarget.mockRejectedValue(new Error('error.ssh-config-changed'))
    const { openServerRemoteEditor } = await import('#/server/modules/remote.ts')

    await expect(
      openServerRemoteEditor({ repoId: 'ssh-config://prod/srv/repo', worktreePath: '/srv/repo-feature' }),
    ).resolves.toEqual({ ok: false, message: 'error.ssh-config-changed' })
  })
})
```

- [ ] **Step 2: Run module tests and verify they fail**

Run:

```bash
bun run test src/server/modules/remote.test.ts
```

Expected: FAIL because `openServerRemoteEditor` is not exported.

- [ ] **Step 3: Implement `openServerRemoteEditor()`**

In `src/server/modules/remote.ts`, add these imports:

```ts
import { getServerSettingsPrefs } from '#/server/modules/settings-source.ts'
import { openRemoteInPreferredEditor } from '#/system/editors.ts'
import type { ExecResult } from '#/shared/git-types.ts'
```

Replace the existing `#/shared/remote-repo.ts` import with:

```ts
import {
  isAbsoluteRemotePath,
  isHomeRelativeRemotePath,
  isRemoteRepoId,
  isResolvableRemotePathInput,
  normalizeRemoteTarget,
  parseRemoteRepoId,
  type RemoteConnectionInput,
  type RemoteDiagnosticsResult,
  type RemotePathSuggestionsInput,
  type RemoteRepoTarget,
  type ResolvedRemoteTarget,
  type SshConfigHostsResult,
} from '#/shared/remote-repo.ts'
```

Add the function at the end of the file:

```ts
export async function openServerRemoteEditor(
  input: { repoId: string; worktreePath: string },
  signal?: AbortSignal,
): Promise<ExecResult> {
  if (!isRemoteRepoId(input.repoId) || !isAbsoluteRemotePath(input.worktreePath)) {
    return { ok: false, message: 'error.invalid-arguments' }
  }
  const ref = parseRemoteRepoId(input.repoId)
  if (!ref) return { ok: false, message: 'error.invalid-arguments' }

  let resolved: ResolvedRemoteTarget
  try {
    resolved = await resolveSshRemoteTarget(ref, signal)
  } catch {
    return { ok: false, message: 'error.ssh-config-changed' }
  }

  const prefs = await getServerSettingsPrefs()
  return await openRemoteInPreferredEditor(resolved.target.alias, input.worktreePath, prefs.editorApp)
}
```

- [ ] **Step 4: Run module tests and verify they pass**

Run:

```bash
bun run test src/server/modules/remote.test.ts
```

Expected: PASS.

- [ ] **Step 5: Write failing route test**

Create `src/server/routes/remote.test.ts`:

```ts
import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  openServerRemoteEditor: vi.fn(),
}))

vi.mock('#/server/modules/remote.ts', () => ({
  getServerSshHosts: vi.fn(async () => ({ hosts: [], hasInclude: false })),
  resolveServerRemoteTarget: vi.fn(),
  getServerRemotePathSuggestions: vi.fn(),
  testServerRemoteRepository: vi.fn(),
  openServerRemoteEditor: mocks.openServerRemoteEditor,
}))

describe('remote routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.openServerRemoteEditor.mockResolvedValue({ ok: true, message: '/srv/repo-feature' })
  })

  test('opens a remote editor from repo id and worktree path', async () => {
    const { createRemoteRoutes } = await import('#/server/routes/remote.ts')
    const app = createRemoteRoutes()

    const response = await app.request('http://localhost/open-editor', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ repoId: 'ssh-config://prod/srv/repo', worktreePath: '/srv/repo-feature' }),
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true, message: '/srv/repo-feature' })
    expect(mocks.openServerRemoteEditor).toHaveBeenCalledWith(
      { repoId: 'ssh-config://prod/srv/repo', worktreePath: '/srv/repo-feature' },
      expect.any(AbortSignal),
    )
  })
})
```

- [ ] **Step 6: Implement the remote route**

In `src/server/routes/remote.ts`, add `openServerRemoteEditor` to the import list and add this route before `return app`:

```ts
  app.post('/open-editor', async (c) => {
    const body = await c.req.json().catch(() => null)
    const repoId = typeof body?.repoId === 'string' ? body.repoId : ''
    const worktreePath = typeof body?.worktreePath === 'string' ? body.worktreePath : ''
    return c.json(await openServerRemoteEditor({ repoId, worktreePath }, c.req.raw.signal))
  })
```

- [ ] **Step 7: Run route test**

Run:

```bash
bun run test src/server/routes/remote.test.ts
```

Expected: PASS.

- [ ] **Step 8: Add remote editor client test**

In `src/web/remote-client.test.ts`, add:

```ts
  test('opens remote editors through embedded server in web host mode', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, message: '/srv/repo-feature' }),
    }))
    vi.stubGlobal('fetch', fetchMock)
    const { openRemoteRepositoryEditor } = await import('#/web/app-data-client.ts')

    await expect(openRemoteRepositoryEditor('ssh-config://prod/srv/repo', '/srv/repo-feature')).resolves.toEqual({
      ok: true,
      message: '/srv/repo-feature',
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:32100/api/remote/open-editor',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'x-goblin-internal-secret': 'secret' }),
        body: JSON.stringify({ repoId: 'ssh-config://prod/srv/repo', worktreePath: '/srv/repo-feature' }),
      }),
    )
  })
```

- [ ] **Step 9: Implement the remote editor client**

In `src/web/app-data-client.ts`, add after `testRemoteRepositoryConnection()`:

```ts
export async function openRemoteRepositoryEditor(repoId: string, worktreePath: string): Promise<ExecResult> {
  return await postServerJson('/api/remote/open-editor', { repoId, worktreePath })
}
```

- [ ] **Step 10: Run server/client tests**

Run:

```bash
bun run test src/server/modules/remote.test.ts src/server/routes/remote.test.ts src/web/remote-client.test.ts
```

Expected: PASS.

---

### Task 3: Branch Action Capabilities And Behavior

**Files:**
- Modify: `src/web/hooks/useBranchActions.tsx`
- Modify: `src/web/stores/repos/branch-actions.test.ts`
- Modify: `src/web/hooks/useBranchActions.test.tsx`

- [ ] **Step 1: Update capability tests for remote worktrees**

In `src/web/stores/repos/branch-actions.test.ts`, replace the test named `disables external editor and terminal actions for remote worktrees` with:

```ts
  test('allows terminal and editor actions for remote worktrees', () => {
    const branch = createRepoBranch('feature/remote', { worktree: { path: '/srv/repo-feature' } })
    const target = normalizeRemoteTarget({
      alias: 'example',
      host: 'example.com',
      user: 'alice',
      port: 22,
      remotePath: '/srv/repo',
    })
    expect(target).not.toBeNull()
    seedRepoState({
      id: target!.id,
      branches: [branch],
      remote: {
        target: target!,
        remotes: ['origin'],
        hasRemotes: true,
        hasBrowserRemote: true,
        browserRemoteProvider: 'github',
        remoteProviders: { origin: 'github' },
        hasGitHubRemote: true,
      },
    })

    expect(getBranchActionCapabilities(useReposStore.getState().repos[target!.id]!, branch)).toMatchObject({
      canOpenTerminal: true,
      canOpenEditor: true,
    })
  })
```

- [ ] **Step 2: Run the capability test and verify it fails**

Run:

```bash
bun run test src/web/stores/repos/branch-actions.test.ts -- -t "allows terminal and editor actions for remote worktrees"
```

Expected: FAIL because remote worktrees still disable both capabilities.

- [ ] **Step 3: Enable capabilities for any branch with a worktree path**

In `src/web/hooks/useBranchActions.tsx`, replace:

```ts
    canOpenTerminal: !!branch.worktree?.path && !repo.remote.target,
    canOpenEditor: !!branch.worktree?.path && !repo.remote.target,
```

with:

```ts
    canOpenTerminal: !!branch.worktree?.path,
    canOpenEditor: !!branch.worktree?.path,
```

- [ ] **Step 4: Update hook mocks for remote terminal/editor behavior tests**

In `src/web/hooks/useBranchActions.test.tsx`, extend the hoisted mocks:

```ts
const mocks = vi.hoisted(() => ({
  openExternalUrl: vi.fn(),
  openRepositoryEditor: vi.fn(),
  openRepositoryRemote: vi.fn(),
  openRepositoryTerminal: vi.fn(),
  openRemoteRepositoryEditor: vi.fn(),
  showRepoDetailTab: vi.fn(),
}))
```

Update the app-data-client mock:

```ts
vi.mock('#/web/app-data-client.ts', () => ({
  getRepositoryPatch: vi.fn(),
  openRepositoryEditor: mocks.openRepositoryEditor,
  openRepositoryRemote: mocks.openRepositoryRemote,
  openRepositoryTerminal: mocks.openRepositoryTerminal,
  openRemoteRepositoryEditor: mocks.openRemoteRepositoryEditor,
}))
```

Update the navigation mock:

```ts
vi.mock('#/web/main-window-navigation.tsx', () => ({
  useMainWindowNavigation: () => ({
    showRepoDetailTab: mocks.showRepoDetailTab,
  }),
}))
```

Add these resets to `beforeEach()`:

```ts
    mocks.openRepositoryEditor.mockReset()
    mocks.openRepositoryTerminal.mockReset()
    mocks.openRemoteRepositoryEditor.mockReset()
    mocks.showRepoDetailTab.mockReset()
```

- [ ] **Step 5: Add failing remote action behavior tests**

Add imports to `src/web/hooks/useBranchActions.test.tsx`:

```ts
import { normalizeRemoteTarget } from '#/shared/remote-repo.ts'
```

Add these tests inside `describe('useBranchActions', () => { ... })`:

```ts
  test('opens remote terminals in the Goblin terminal detail tab', async () => {
    const branch = createRepoBranch('feature/remote-terminal', { worktree: { path: '/srv/repo-feature' } })
    const target = normalizeRemoteTarget({
      alias: 'prod',
      host: 'example.com',
      user: 'alice',
      port: 22,
      remotePath: '/srv/repo',
    })
    expect(target).not.toBeNull()
    const repo = seedRepoState({
      id: target!.id,
      branches: [branch],
      remote: { target: target!, hasRemotes: true, hasBrowserRemote: true, hasGitHubRemote: true },
    })

    let actions: ReturnType<typeof useBranchActions>['actions'] | null = null
    root = createRoot(container)
    await act(async () => {
      root!.render(<BranchActionsHarness repo={repo} onReady={(value) => (actions = value)} />)
    })

    await act(async () => {
      await actions?.openTerminal?.()
    })

    expect(mocks.showRepoDetailTab).toHaveBeenCalledWith(target!.id, 'terminal')
    expect(mocks.openRepositoryTerminal).not.toHaveBeenCalled()
  })

  test('opens remote editors through the remote editor client', async () => {
    mocks.openRemoteRepositoryEditor.mockResolvedValue({ ok: true, message: '' })
    const branch = createRepoBranch('feature/remote-editor', { worktree: { path: '/srv/repo-feature' } })
    const target = normalizeRemoteTarget({
      alias: 'prod',
      host: 'example.com',
      user: 'alice',
      port: 22,
      remotePath: '/srv/repo',
    })
    expect(target).not.toBeNull()
    const repo = seedRepoState({
      id: target!.id,
      branches: [branch],
      remote: { target: target!, hasRemotes: true, hasBrowserRemote: true, hasGitHubRemote: true },
    })

    let actions: ReturnType<typeof useBranchActions>['actions'] | null = null
    root = createRoot(container)
    await act(async () => {
      root!.render(<BranchActionsHarness repo={repo} onReady={(value) => (actions = value)} />)
    })

    await act(async () => {
      await actions?.openEditor?.()
    })

    expect(mocks.openRemoteRepositoryEditor).toHaveBeenCalledWith(target!.id, '/srv/repo-feature')
    expect(mocks.openRepositoryEditor).not.toHaveBeenCalled()
  })
```

- [ ] **Step 6: Run hook behavior tests and verify editor test fails**

Run:

```bash
bun run test src/web/hooks/useBranchActions.test.tsx -- -t "remote"
```

Expected: the terminal test can already pass after capability changes; the remote editor test FAILS because `openEditor()` still calls the local editor client.

- [ ] **Step 7: Implement remote editor action dispatch**

In `src/web/hooks/useBranchActions.tsx`, add `openRemoteRepositoryEditor` to the app-data-client import:

```ts
  openRemoteRepositoryEditor,
```

Replace `openEditor()` with:

```ts
  function openEditor() {
    if (!branch.worktree?.path) return
    const worktreePath = branch.worktree?.path
    if (repo.remote.target) {
      return runUiAction('editor', () => openRemoteRepositoryEditor(repo.id, worktreePath))
    }
    return runUiAction('editor', () => openRepositoryEditor(worktreePath))
  }
```

- [ ] **Step 8: Run branch action tests**

Run:

```bash
bun run test src/web/stores/repos/branch-actions.test.ts src/web/hooks/useBranchActions.test.tsx
```

Expected: PASS.

---

### Task 4: Branch Action Item Visibility

**Files:**
- Modify: `src/web/hooks/useBranchActionItems.ts`
- Add: `src/web/hooks/useBranchActionItems.test.tsx`

- [ ] **Step 1: Write failing visibility test**

Create `src/web/hooks/useBranchActionItems.test.tsx`:

```tsx
// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { normalizeRemoteTarget } from '#/shared/remote-repo.ts'
import { createRepoBranch, seedRepoState, resetReposStore } from '#/web/stores/repos/test-utils.ts'
import type { useBranchActionItems } from '#/web/hooks/useBranchActionItems.ts'

const mocks = vi.hoisted(() => ({
  useRuntimeExternalAppSettings: vi.fn(),
  useBranchActions: vi.fn(),
}))

vi.mock('#/web/runtime-settings-hooks.ts', () => ({
  useRuntimeExternalAppSettings: mocks.useRuntimeExternalAppSettings,
}))
vi.mock('#/web/stores/i18n.ts', () => ({
  useT: () => (key: string) => key,
}))
vi.mock('#/web/hooks/useBranchActions.tsx', () => ({
  useBranchActions: mocks.useBranchActions,
}))

describe('useBranchActionItems', () => {
  let container: HTMLDivElement
  let root: Root | null = null
  const reactActEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }

  beforeEach(() => {
    resetReposStore()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    mocks.useRuntimeExternalAppSettings.mockReturnValue({
      terminalApp: 'auto',
      resolvedTerminalApp: null,
      terminalAvailable: false,
      editorApp: 'vscode',
      resolvedEditorApp: 'vscode',
      editorAvailable: true,
    })
    mocks.useBranchActions.mockReturnValue({
      blocked: false,
      busyAction: null,
      capabilities: {
        isCurrent: false,
        checkedOutInAnotherWorktree: true,
        canRemoveWorktree: false,
        isRegularBranch: false,
        canCopyPatch: false,
        canPull: false,
        canPush: false,
        canOpenRemote: false,
        canOpenTerminal: true,
        canOpenEditor: true,
      },
      actions: {
        copyPatch: vi.fn(),
        checkout: vi.fn(),
        pull: vi.fn(),
        push: vi.fn(),
        openTerminal: vi.fn(),
        openEditor: vi.fn(),
        openRemote: vi.fn(),
        requestDeleteBranch: vi.fn(),
        requestRemoveWorktree: vi.fn(),
      },
      dialogs: null,
    })
  })

  afterEach(async () => {
    await act(async () => {
      root?.unmount()
    })
    container.remove()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
    root = null
  })

  test('shows remote terminal even when local terminal apps are unavailable', async () => {
    const branch = createRepoBranch('feature/remote', { worktree: { path: '/srv/repo-feature' } })
    const target = normalizeRemoteTarget({
      alias: 'prod',
      host: 'example.com',
      user: 'alice',
      port: 22,
      remotePath: '/srv/repo',
    })
    expect(target).not.toBeNull()
    const repo = seedRepoState({
      id: target!.id,
      branches: [branch],
      remote: { target: target!, hasRemotes: true, hasBrowserRemote: true, hasGitHubRemote: true },
    })

    let itemIds: string[] = []
    root = createRoot(container)
    const { useBranchActionItems: useItems } = await import('#/web/hooks/useBranchActionItems.ts')
    await act(async () => {
      root!.render(<ItemsHarness useItems={useItems} repo={repo} branch={branch} onReady={(ids) => (itemIds = ids)} />)
    })

    expect(itemIds).toContain('terminal')
    expect(itemIds).toContain('editor')
  })
})

function ItemsHarness({
  useItems,
  repo,
  branch,
  onReady,
}: {
  useItems: typeof useBranchActionItems
  repo: ReturnType<typeof seedRepoState>
  branch: ReturnType<typeof createRepoBranch>
  onReady: (itemIds: string[]) => void
}) {
  const items = useItems(repo, branch)
  React.useEffect(() => {
    onReady([...items.patchItems, ...items.mainItems, ...items.destructiveItems].map((item) => item.id))
  }, [items, onReady])
  return null
}
```

- [ ] **Step 2: Run the visibility test and verify it fails**

Run:

```bash
bun run test src/web/hooks/useBranchActionItems.test.tsx
```

Expected: FAIL because terminal action still requires `terminalAvailable`.

- [ ] **Step 3: Allow remote terminal item without local terminal availability**

In `src/web/hooks/useBranchActionItems.ts`, add constants after `const phase = ...`:

```ts
  const isRemoteRepo = !!repo.remote.target
  const showTerminalAction = capabilities.canOpenTerminal && (isRemoteRepo || terminalAvailable)
  const terminalIconPref = isRemoteRepo ? 'auto' : (resolvedTerminalApp ?? terminalApp)
```

Replace:

```ts
    ...(capabilities.canOpenTerminal && terminalAvailable
```

with:

```ts
    ...(showTerminalAction
```

Replace:

```ts
            icon: createElement(TerminalAppIcon, { pref: resolvedTerminalApp ?? terminalApp }),
```

with:

```ts
            icon: createElement(TerminalAppIcon, { pref: terminalIconPref }),
```

- [ ] **Step 4: Run visibility and branch action tests**

Run:

```bash
bun run test src/web/hooks/useBranchActionItems.test.tsx src/web/stores/repos/branch-actions.test.ts src/web/hooks/useBranchActions.test.tsx
```

Expected: PASS.

---

### Task 5: I18n And Final Verification

**Files:**
- Modify: `src/shared/i18n/en.ts`
- Modify: `src/shared/i18n/zh.ts`
- Modify: `src/shared/i18n/ko.ts`
- Modify: `src/shared/i18n/ja.ts`

- [ ] **Step 1: Add the new error key to all dictionaries**

Add the key next to `error.editor-not-installed` in each dictionary.

`src/shared/i18n/en.ts`:

```ts
  'error.remote-editor-not-supported': 'The selected editor cannot open remote SSH workspaces',
```

`src/shared/i18n/zh.ts`:

```ts
  'error.remote-editor-not-supported': '所选编辑器无法打开远程 SSH 工作区',
```

`src/shared/i18n/ko.ts`:

```ts
  'error.remote-editor-not-supported': '선택한 에디터는 원격 SSH 작업 영역을 열 수 없습니다',
```

`src/shared/i18n/ja.ts`:

```ts
  'error.remote-editor-not-supported': '選択したエディタはリモート SSH ワークスペースを開けません',
```

- [ ] **Step 2: Run i18n tests**

Run:

```bash
bun run test src/shared/i18n/dictionaries.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run focused feature tests**

Run:

```bash
bun run test src/system/open-app.test.ts src/system/editors.test.ts src/server/modules/remote.test.ts src/server/routes/remote.test.ts src/web/remote-client.test.ts src/web/hooks/useBranchActionItems.test.tsx src/web/stores/repos/branch-actions.test.ts src/web/hooks/useBranchActions.test.tsx src/shared/i18n/dictionaries.test.ts
```

Expected: PASS.

- [ ] **Step 4: Run full verification**

Run:

```bash
bun run typecheck
bun run test
bun run check:architecture
```

Expected: all three commands exit 0.

- [ ] **Step 5: Manual verification**

Use a saved remote repository that has a linked worktree.

1. Open the remote repository tab.
2. Select a branch with a remote worktree path such as `/srv/repo-feature`.
3. Click Terminal.
4. Confirm Goblin opens the Terminal detail tab and the prompt is inside the selected remote worktree.
5. Click Edit.
6. Confirm the configured editor opens the same remote worktree through Remote SSH.
7. Temporarily select an unavailable editor in settings and click Edit again.
8. Confirm Goblin reports `error.editor-not-installed` or the editor CLI failure text.
