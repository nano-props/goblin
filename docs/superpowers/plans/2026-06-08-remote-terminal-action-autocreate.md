# Remote External Terminal Action Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make remote branch `Terminal` actions open the selected remote worktree in the user's configured local terminal app through SSH.

**Architecture:** Add a remote-specific terminal command helper in `src/system/`, extend the existing terminal backend registry with optional `openRemote()`, and expose the behavior through `/api/remote/open-terminal`. The web branch action should call the remote terminal client for remote repositories and keep local terminal behavior unchanged.

**Tech Stack:** TypeScript, Hono server routes, existing server settings module, existing SSH config resolver, execa, Vitest, React hook tests.

---

## Repository Instruction Note

This plan intentionally omits git commit steps. `AGENTS.md` says not to plan or execute git commits or branch operations unless the user explicitly asks.

## File Structure

- Create `src/system/remote-terminal.ts`  
  Pure validation and SSH invocation construction for remote terminal launches.

- Create `src/system/remote-terminal.test.ts`  
  Unit tests for remote alias/path validation and SSH command construction.

- Modify `src/system/apple-terminal.ts`  
  Add `openRemoteInAppleTerminal(alias, remotePath)` using AppleScript to open Terminal.app with the prepared SSH command.

- Create `src/system/apple-terminal.test.ts`  
  Tests for Apple Terminal remote launch argument construction and validation.

- Modify `src/system/ghostty.ts`  
  Add `openRemoteInGhostty(alias, remotePath)`. If Ghostty is running, create a new window through AppleScript and send the SSH command; if not running, cold-start Ghostty with `-e`.

- Create `src/system/ghostty.test.ts`  
  Tests for Ghostty remote launch argument construction, validation, and missing app behavior.

- Modify `src/system/terminals.ts`  
  Add optional terminal backend `openRemote()`, `openRemoteInTerminalBackend()`, and `openRemoteInPreferredTerminal()`.

- Modify `src/system/terminals.test.ts`  
  Add coverage for remote terminal preference resolution, auto priority, missing terminal, and unsupported backend behavior.

- Modify `src/server/modules/remote.ts`  
  Add `openServerRemoteTerminal()` beside `openServerRemoteEditor()`.

- Modify `src/server/modules/remote.test.ts`  
  Add remote terminal module tests.

- Modify `src/server/routes/remote.ts`  
  Add `POST /api/remote/open-terminal`.

- Modify `src/server/routes/remote.test.ts`  
  Add route forwarding coverage.

- Modify `src/web/app-data-client.ts`  
  Add `openRemoteRepositoryTerminal(repoId, worktreePath)`.

- Modify `src/web/app-data-client.test.ts`  
  Add client route coverage.

- Modify `src/web/hooks/useBranchActions.tsx`  
  Route remote terminal actions to the remote terminal client; remove old in-app terminal-session path from this hook.

- Modify `src/web/hooks/useBranchActions.test.tsx`  
  Replace old Goblin terminal-session assertions with remote client assertions; preserve local terminal regression coverage.

- Modify `src/web/commands/workspace-commands.ts`  
  Remove the old `runOpenWorktreeTerminalCommand()` helper added for the superseded in-app terminal direction. Keep `runTerminalPrimaryActionCommand()` for the app-level terminal primary action.

- Modify `src/web/commands/workspace-commands.test.ts`  
  Remove tests that cover the deleted explicit branch worktree terminal helper. Keep primary action tests.

- Modify `src/shared/i18n/en.ts`, `src/shared/i18n/zh.ts`, `src/shared/i18n/ko.ts`, `src/shared/i18n/ja.ts`  
  Add `error.remote-terminal-not-supported`.

---

### Task 1: Add Remote Terminal Invocation Helper

**Files:**
- Create: `src/system/remote-terminal.test.ts`
- Create: `src/system/remote-terminal.ts`

- [ ] **Step 1: Write failing helper tests**

Create `src/system/remote-terminal.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { buildRemoteTerminalInvocation } from '#/system/remote-terminal.ts'

describe('buildRemoteTerminalInvocation', () => {
  test('builds a safe ssh invocation for an absolute remote worktree path', () => {
    const invocation = buildRemoteTerminalInvocation('prod', '/srv/repo-feature')

    expect(invocation).not.toBeNull()
    expect(invocation?.command).toBe('ssh')
    expect(invocation?.args).toEqual([
      '-tt',
      '--',
      'prod',
      `sh -lc 'cd '\\''/srv/repo-feature'\\'' && exec "\${SHELL:-/bin/sh}" -l'`,
    ])
    expect(invocation?.shellCommand).toContain('ssh')
    expect(invocation?.shellCommand).toContain('prod')
    expect(invocation?.shellCommand).toContain('/srv/repo-feature')
  })

  test('shell-quotes remote paths that contain single quotes', () => {
    const invocation = buildRemoteTerminalInvocation('prod', "/srv/repo's-feature")

    expect(invocation).not.toBeNull()
    expect(invocation?.args[3]).toBe(
      `sh -lc 'cd '\\''/srv/repo'\\''\\'\\'''\\''s-feature'\\'' && exec "\${SHELL:-/bin/sh}" -l'`,
    )
  })

  test('rejects unsafe aliases and remote paths', () => {
    expect(buildRemoteTerminalInvocation('bad alias', '/srv/repo')).toBeNull()
    expect(buildRemoteTerminalInvocation('prod', 'relative/repo')).toBeNull()
    expect(buildRemoteTerminalInvocation('prod', '/srv/\u0000repo')).toBeNull()
    expect(buildRemoteTerminalInvocation('prod', '')).toBeNull()
  })
})
```

- [ ] **Step 2: Run helper tests and verify failure**

Run:

```bash
bun run test src/system/remote-terminal.test.ts
```

Expected: FAIL because `src/system/remote-terminal.ts` does not exist.

- [ ] **Step 3: Implement the helper**

Create `src/system/remote-terminal.ts`:

```ts
export interface RemoteTerminalInvocation {
  command: 'ssh'
  args: string[]
  shellCommand: string
}

export function buildRemoteTerminalInvocation(alias: string, remotePath: string): RemoteTerminalInvocation | null {
  if (!isSafeRemoteAlias(alias) || !isSafeRemoteAbsolutePath(remotePath)) return null

  const script = `cd ${shellQuote(remotePath)} && exec "\${SHELL:-/bin/sh}" -l`
  const remoteCommand = `sh -lc ${shellQuote(script)}`
  const args = ['-tt', '--', alias, remoteCommand]
  return {
    command: 'ssh',
    args,
    shellCommand: ['ssh', ...args].map(shellQuote).join(' '),
  }
}

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

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}
```

- [ ] **Step 4: Run helper tests and verify pass**

Run:

```bash
bun run test src/system/remote-terminal.test.ts
```

Expected: PASS.

---

### Task 2: Add Remote Openers To Terminal Backends

**Files:**
- Create: `src/system/apple-terminal.test.ts`
- Modify: `src/system/apple-terminal.ts`
- Create: `src/system/ghostty.test.ts`
- Modify: `src/system/ghostty.ts`

- [ ] **Step 1: Write failing Apple Terminal remote tests**

Create `src/system/apple-terminal.test.ts`:

```ts
import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  execa: vi.fn(),
  statSync: vi.fn(),
}))

vi.mock('execa', () => ({ execa: mocks.execa }))
vi.mock('node:fs', () => ({
  statSync: mocks.statSync,
}))

describe('openRemoteInAppleTerminal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.statSync.mockReturnValue({ isDirectory: () => true })
    mocks.execa.mockResolvedValue({})
  })

  test('opens Terminal.app with a prepared ssh command', async () => {
    const { openRemoteInAppleTerminal } = await import('#/system/apple-terminal.ts')

    await expect(openRemoteInAppleTerminal('prod', '/srv/repo-feature')).resolves.toEqual({
      ok: true,
      message: '/srv/repo-feature',
    })

    expect(mocks.execa).toHaveBeenCalledWith(
      '/usr/bin/osascript',
      [
        '-e',
        expect.stringContaining('tell application "Terminal"'),
        expect.stringContaining('ssh'),
      ],
      expect.objectContaining({ timeout: 10_000, forceKillAfterDelay: 500 }),
    )
    expect(mocks.execa.mock.calls[0]![1][2]).toContain('prod')
    expect(mocks.execa.mock.calls[0]![1][2]).toContain('/srv/repo-feature')
  })

  test('rejects invalid remote inputs before invoking osascript', async () => {
    const { openRemoteInAppleTerminal } = await import('#/system/apple-terminal.ts')

    await expect(openRemoteInAppleTerminal('bad alias', '/srv/repo')).resolves.toEqual({
      ok: false,
      message: 'error.invalid-arguments',
    })
    await expect(openRemoteInAppleTerminal('prod', 'relative/repo')).resolves.toEqual({
      ok: false,
      message: 'error.invalid-arguments',
    })

    expect(mocks.execa).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run Apple Terminal tests and verify failure**

Run:

```bash
bun run test src/system/apple-terminal.test.ts
```

Expected: FAIL because `openRemoteInAppleTerminal` is not exported.

- [ ] **Step 3: Implement Apple Terminal remote opener**

In `src/system/apple-terminal.ts`, add this import:

```ts
import { buildRemoteTerminalInvocation } from '#/system/remote-terminal.ts'
```

Then add this function after `openInAppleTerminal()`:

```ts
export async function openRemoteInAppleTerminal(
  alias: string,
  remotePath: string,
): Promise<{ ok: boolean; message: string }> {
  const invocation = buildRemoteTerminalInvocation(alias, remotePath)
  if (!invocation) return { ok: false, message: 'error.invalid-arguments' }

  const script = `
    on run argv
      set commandText to item 1 of argv
      tell application "Terminal"
        activate
        do script commandText
      end tell
    end run
  `

  try {
    await execa('/usr/bin/osascript', ['-e', script, invocation.shellCommand], {
      timeout: OPEN_TIMEOUT_MS,
      forceKillAfterDelay: 500,
    })
    return { ok: true, message: remotePath }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) }
  }
}
```

- [ ] **Step 4: Run Apple Terminal tests and verify pass**

Run:

```bash
bun run test src/system/apple-terminal.test.ts
```

Expected: PASS.

- [ ] **Step 5: Write failing Ghostty remote tests**

Create `src/system/ghostty.test.ts`:

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

function childProcessPromise() {
  const child = Promise.resolve({}) as Promise<unknown> & { unref: ReturnType<typeof vi.fn> }
  child.unref = vi.fn()
  return child
}

describe('openRemoteInGhostty', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.existsSync.mockImplementation((path: string) => path === '/Applications/Ghostty.app')
    mocks.execa.mockReturnValue(childProcessPromise())
  })

  test('opens a remote command in a running Ghostty window', async () => {
    const { openRemoteInGhostty } = await import('#/system/ghostty.ts')
    mocks.execa.mockResolvedValueOnce({ stdout: 'opened' })

    await expect(openRemoteInGhostty('prod', '/srv/repo-feature')).resolves.toEqual({
      ok: true,
      message: '/srv/repo-feature',
    })

    expect(mocks.execa).toHaveBeenCalledWith(
      '/usr/bin/osascript',
      [
        '-e',
        expect.stringContaining('input text'),
        expect.stringContaining('sh -lc'),
      ],
      expect.objectContaining({ timeout: 5_000, forceKillAfterDelay: 500 }),
    )
    expect(mocks.execa.mock.calls[0]![1][2]).toContain('prod')
    expect(mocks.execa.mock.calls[0]![1][2]).toContain('/srv/repo-feature')
  })

  test('cold-starts Ghostty with ssh as the initial command when it is not running', async () => {
    const { openRemoteInGhostty } = await import('#/system/ghostty.ts')
    mocks.execa.mockResolvedValueOnce({ stdout: 'not-running' })
    mocks.execa.mockReturnValueOnce(childProcessPromise())

    await expect(openRemoteInGhostty('prod', '/srv/repo-feature')).resolves.toEqual({
      ok: true,
      message: '/srv/repo-feature',
    })

    expect(mocks.execa).toHaveBeenLastCalledWith(
      'open',
      [
        '-na',
        'Ghostty.app',
        '--args',
        '-e',
        'ssh',
        '-tt',
        '--',
        'prod',
        expect.stringContaining('sh -lc'),
      ],
      expect.objectContaining({ detached: true, stdio: 'ignore', cleanup: false }),
    )
    expect(mocks.execa.mock.calls[1]![1][8]).toContain('/srv/repo-feature')
  })

  test('rejects invalid remote inputs before launching Ghostty', async () => {
    const { openRemoteInGhostty } = await import('#/system/ghostty.ts')

    await expect(openRemoteInGhostty('bad alias', '/srv/repo')).resolves.toEqual({
      ok: false,
      message: 'error.invalid-arguments',
    })
    await expect(openRemoteInGhostty('prod', 'relative/repo')).resolves.toEqual({
      ok: false,
      message: 'error.invalid-arguments',
    })

    expect(mocks.execa).not.toHaveBeenCalled()
  })

  test('returns ghostty-not-installed when Ghostty is unavailable', async () => {
    mocks.existsSync.mockReturnValue(false)
    const { openRemoteInGhostty } = await import('#/system/ghostty.ts')

    await expect(openRemoteInGhostty('prod', '/srv/repo')).resolves.toEqual({
      ok: false,
      message: 'error.ghostty-not-installed',
    })
  })
})
```

- [ ] **Step 6: Run Ghostty tests and verify failure**

Run:

```bash
bun run test src/system/ghostty.test.ts
```

Expected: FAIL because `openRemoteInGhostty` is not exported.

- [ ] **Step 7: Implement Ghostty remote opener**

In `src/system/ghostty.ts`, add this import:

```ts
import { buildRemoteTerminalInvocation } from '#/system/remote-terminal.ts'
```

Then add these functions after `openInGhostty()`:

```ts
function openRemoteInRunningGhostty(commandText: string): Promise<boolean> {
  const script = `
    on run argv
      set commandText to item 1 of argv
      tell application "System Events"
        set ghosttyIsRunning to exists (first process whose bundle identifier is "${GHOSTTY_BUNDLE_ID}")
      end tell
      if not ghosttyIsRunning then return "not-running"
      tell application id "${GHOSTTY_BUNDLE_ID}"
        set win to new window with configuration {}
        set term to terminal 1 of selected tab of win
        input text commandText to term
        send key "enter" to term
      end tell
      return "opened"
    end run
  `
  return execa('/usr/bin/osascript', ['-e', script, commandText], {
    timeout: APPLE_SCRIPT_TIMEOUT_MS,
    forceKillAfterDelay: 500,
  }).then(({ stdout }) => stdout.trim() === 'opened')
}

export async function openRemoteInGhostty(alias: string, remotePath: string): Promise<{ ok: boolean; message: string }> {
  const invocation = buildRemoteTerminalInvocation(alias, remotePath)
  if (!invocation) return { ok: false, message: 'error.invalid-arguments' }
  if (!isGhosttyInstalled()) return { ok: false, message: 'error.ghostty-not-installed' }

  try {
    if (await openRemoteInRunningGhostty(invocation.shellCommand)) return { ok: true, message: remotePath }
  } catch (err) {
    console.warn('[ghostty] AppleScript remote open failed, falling back to launch', err)
  }

  try {
    const child = execa('open', ['-na', 'Ghostty.app', '--args', '-e', invocation.command, ...invocation.args], {
      detached: true,
      stdio: 'ignore',
      cleanup: false,
      timeout: OPEN_TIMEOUT_MS,
      forceKillAfterDelay: 500,
    })
    child.unref()
    await child
    return { ok: true, message: remotePath }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) }
  }
}
```

- [ ] **Step 8: Run backend tests and verify pass**

Run:

```bash
bun run test src/system/remote-terminal.test.ts src/system/apple-terminal.test.ts src/system/ghostty.test.ts
```

Expected: PASS.

---

### Task 3: Extend Terminal Preference Registry

**Files:**
- Modify: `src/system/terminals.test.ts`
- Modify: `src/system/terminals.ts`

- [ ] **Step 1: Write failing registry tests**

Update the imports at the top of `src/system/terminals.test.ts`:

```ts
import {
  openInPreferredTerminal,
  openRemoteInPreferredTerminal,
  openRemoteInTerminalBackend,
} from '#/system/terminals.ts'
import { openInAppleTerminal, openRemoteInAppleTerminal, isAppleTerminalInstalled } from '#/system/apple-terminal.ts'
import { isGhosttyInstalled, openInGhostty, openRemoteInGhostty } from '#/system/ghostty.ts'
```

Update the mocks:

```ts
vi.mock('#/system/ghostty.ts', () => ({
  isGhosttyInstalled: vi.fn(() => false),
  openInGhostty: vi.fn(async (path: string) => ({ ok: true, message: path })),
  openRemoteInGhostty: vi.fn(async (alias: string, path: string) => ({ ok: true, message: `${alias}:${path}` })),
}))

vi.mock('#/system/apple-terminal.ts', () => ({
  isAppleTerminalInstalled: vi.fn(async () => true),
  openInAppleTerminal: vi.fn(async (path: string) => ({ ok: true, message: path })),
  openRemoteInAppleTerminal: vi.fn(async (alias: string, path: string) => ({ ok: true, message: `${alias}:${path}` })),
}))
```

Add these tests inside `describe('openInPreferredTerminal', () => { ... })`:

```ts
  test('opens remote Terminal.app explicitly on darwin when detection reports available', async () => {
    vi.mocked(isGhosttyInstalled).mockReturnValue(false)
    vi.mocked(isAppleTerminalInstalled).mockResolvedValue(true)

    await expect(openRemoteInPreferredTerminal('prod', '/srv/repo-feature', 'terminal')).resolves.toEqual({
      ok: true,
      message: 'prod:/srv/repo-feature',
    })

    expect(openRemoteInAppleTerminal).toHaveBeenCalledWith('prod', '/srv/repo-feature')
    expect(openRemoteInGhostty).not.toHaveBeenCalled()
  })

  test('prefers remote Ghostty in auto mode when it is installed', async () => {
    vi.mocked(isGhosttyInstalled).mockReturnValue(true)
    vi.mocked(isAppleTerminalInstalled).mockResolvedValue(true)

    await expect(openRemoteInPreferredTerminal('prod', '/srv/repo-feature', 'auto')).resolves.toEqual({
      ok: true,
      message: 'prod:/srv/repo-feature',
    })

    expect(openRemoteInGhostty).toHaveBeenCalledWith('prod', '/srv/repo-feature')
    expect(openRemoteInAppleTerminal).not.toHaveBeenCalled()
  })

  test('returns terminal-not-installed for remote open when no terminal is available', async () => {
    vi.mocked(isGhosttyInstalled).mockReturnValue(false)
    vi.mocked(isAppleTerminalInstalled).mockResolvedValue(false)

    await expect(openRemoteInPreferredTerminal('prod', '/srv/repo-feature', 'auto')).resolves.toEqual({
      ok: false,
      message: 'error.terminal-not-installed',
    })

    expect(openRemoteInGhostty).not.toHaveBeenCalled()
    expect(openRemoteInAppleTerminal).not.toHaveBeenCalled()
  })

  test('returns remote-terminal-not-supported for backends without remote support', async () => {
    await expect(
      openRemoteInTerminalBackend(
        {
          isInstalled: () => true,
          open: async (path: string) => ({ ok: true, message: path }),
        },
        'prod',
        '/srv/repo-feature',
      ),
    ).resolves.toEqual({
      ok: false,
      message: 'error.remote-terminal-not-supported',
    })
  })
```

- [ ] **Step 2: Run registry tests and verify failure**

Run:

```bash
bun run test src/system/terminals.test.ts
```

Expected: FAIL because remote registry functions and backend exports are not wired.

- [ ] **Step 3: Implement terminal registry remote support**

In `src/system/terminals.ts`, update imports:

```ts
import type { ExecResult } from '#/shared/git-types.ts'
import type { ResolvedTerminalApp, TerminalAppAvailability, TerminalPref } from '#/shared/rpc.ts'
import { isGhosttyInstalled, openInGhostty, openRemoteInGhostty } from '#/system/ghostty.ts'
import { isAppleTerminalInstalled, openInAppleTerminal, openRemoteInAppleTerminal } from '#/system/apple-terminal.ts'
```

Update `TerminalBackend`:

```ts
export interface TerminalBackend {
  /** Whether this terminal is available on the current system.
   *  Sync — backed by file-existence checks that are cheap on macOS.
   *  If a future backend needs async detection (e.g. mdfind), resolve
   *  it at registration time and cache the result. */
  isInstalled: () => boolean
  /** Open a directory in this terminal. */
  open: (path: string) => Promise<ExecResult>
  /** Open a remote SSH workspace in this terminal. */
  openRemote?: (alias: string, remotePath: string) => Promise<ExecResult>
}
```

Update `backends`:

```ts
const backends: Record<ResolvedTerminalApp, TerminalBackend> = {
  ghostty: { isInstalled: isGhosttyInstalled, open: openInGhostty, openRemote: openRemoteInGhostty },
  terminal: { isInstalled: () => true, open: openInAppleTerminal, openRemote: openRemoteInAppleTerminal },
}
```

Add these functions after `openInPreferredTerminal()`:

```ts
export function openRemoteInTerminalBackend(
  backend: TerminalBackend | null,
  alias: string,
  remotePath: string,
): Promise<ExecResult> {
  if (!backend) return Promise.resolve({ ok: false, message: 'error.terminal-not-installed' })
  return backend.openRemote
    ? backend.openRemote(alias, remotePath)
    : Promise.resolve({ ok: false, message: 'error.remote-terminal-not-supported' })
}

export async function openRemoteInPreferredTerminal(
  alias: string,
  remotePath: string,
  pref: TerminalPref,
): Promise<ExecResult> {
  const resolved = resolveTerminalApp(pref, await getTerminalAppAvailability())
  return await openRemoteInTerminalBackend(resolved ? backends[resolved] : null, alias, remotePath)
}
```

- [ ] **Step 4: Run registry tests and verify pass**

Run:

```bash
bun run test src/system/terminals.test.ts
```

Expected: PASS.

---

### Task 4: Expose Remote Terminal Through Server And Client

**Files:**
- Modify: `src/server/modules/remote.test.ts`
- Modify: `src/server/modules/remote.ts`
- Modify: `src/server/routes/remote.test.ts`
- Modify: `src/server/routes/remote.ts`
- Modify: `src/web/app-data-client.test.ts`
- Modify: `src/web/app-data-client.ts`
- Modify: `src/shared/i18n/en.ts`
- Modify: `src/shared/i18n/zh.ts`
- Modify: `src/shared/i18n/ko.ts`
- Modify: `src/shared/i18n/ja.ts`

- [ ] **Step 1: Write failing server module tests**

In `src/server/modules/remote.test.ts`, extend the hoisted mocks:

```ts
const mocks = vi.hoisted(() => ({
  resolveRemoteTarget: vi.fn(),
  getServerSettingsPrefs: vi.fn(),
  openRemoteInPreferredEditor: vi.fn(),
  openRemoteInPreferredTerminal: vi.fn(),
}))
```

Extend the terminal system mock:

```ts
vi.mock('#/system/terminals.ts', () => ({
  openRemoteInPreferredTerminal: mocks.openRemoteInPreferredTerminal,
}))
```

In `beforeEach()`, add:

```ts
    mocks.openRemoteInPreferredTerminal.mockResolvedValue({ ok: true, message: '/srv/repo-feature' })
```

Add this describe block after the existing `openServerRemoteEditor` describe block:

```ts
describe('openServerRemoteTerminal', () => {
  test('resolves ssh config and opens the configured remote terminal', async () => {
    const { openServerRemoteTerminal } = await import('#/server/modules/remote.ts')

    await expect(
      openServerRemoteTerminal({ repoId: 'ssh-config://prod/srv/repo', worktreePath: '/srv/repo-feature' }),
    ).resolves.toEqual({ ok: true, message: '/srv/repo-feature' })

    expect(mocks.resolveRemoteTarget).toHaveBeenCalledWith({ alias: 'prod', remotePath: '/srv/repo' }, undefined)
    expect(mocks.openRemoteInPreferredTerminal).toHaveBeenCalledWith('prod', '/srv/repo-feature', 'auto')
  })

  test('rejects invalid repo ids and remote worktree paths', async () => {
    const { openServerRemoteTerminal } = await import('#/server/modules/remote.ts')

    await expect(openServerRemoteTerminal({ repoId: '/tmp/local', worktreePath: '/srv/repo' })).resolves.toEqual({
      ok: false,
      message: 'error.invalid-arguments',
    })
    await expect(
      openServerRemoteTerminal({ repoId: 'ssh-config://prod/srv/repo', worktreePath: 'relative/repo' }),
    ).resolves.toEqual({ ok: false, message: 'error.invalid-arguments' })

    expect(mocks.openRemoteInPreferredTerminal).not.toHaveBeenCalled()
  })

  test('returns ssh-config-changed when the saved remote no longer resolves', async () => {
    mocks.resolveRemoteTarget.mockRejectedValue(new Error('error.ssh-config-changed'))
    const { openServerRemoteTerminal } = await import('#/server/modules/remote.ts')

    await expect(
      openServerRemoteTerminal({ repoId: 'ssh-config://prod/srv/repo', worktreePath: '/srv/repo-feature' }),
    ).resolves.toEqual({ ok: false, message: 'error.ssh-config-changed' })
  })
})
```

- [ ] **Step 2: Run server module tests and verify failure**

Run:

```bash
bun run test src/server/modules/remote.test.ts
```

Expected: FAIL because `openServerRemoteTerminal` is not exported.

- [ ] **Step 3: Implement server module remote terminal opener**

In `src/server/modules/remote.ts`, update imports:

```ts
import { openRemoteInPreferredTerminal } from '#/system/terminals.ts'
```

Add this function after `openServerRemoteEditor()`:

```ts
export async function openServerRemoteTerminal(
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
  return await openRemoteInPreferredTerminal(resolved.target.alias, input.worktreePath, prefs.terminalApp)
}
```

- [ ] **Step 4: Run server module tests and verify pass**

Run:

```bash
bun run test src/server/modules/remote.test.ts
```

Expected: PASS.

- [ ] **Step 5: Write failing remote route test**

In `src/server/routes/remote.test.ts`, extend mocks:

```ts
const mocks = vi.hoisted(() => ({
  openServerRemoteEditor: vi.fn(),
  openServerRemoteTerminal: vi.fn(),
}))
```

Extend the module mock:

```ts
vi.mock('#/server/modules/remote.ts', () => ({
  getServerSshHosts: vi.fn(async () => ({ hosts: [], hasInclude: false })),
  resolveServerRemoteTarget: vi.fn(),
  getServerRemotePathSuggestions: vi.fn(),
  testServerRemoteRepository: vi.fn(),
  openServerRemoteEditor: mocks.openServerRemoteEditor,
  openServerRemoteTerminal: mocks.openServerRemoteTerminal,
}))
```

In `beforeEach()`, add:

```ts
    mocks.openServerRemoteTerminal.mockResolvedValue({ ok: true, message: '/srv/repo-feature' })
```

Add this test:

```ts
  test('opens a remote terminal from repo id and worktree path', async () => {
    const { createRemoteRoutes } = await import('#/server/routes/remote.ts')
    const app = createRemoteRoutes()

    const response = await app.request('http://localhost/open-terminal', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ repoId: 'ssh-config://prod/srv/repo', worktreePath: '/srv/repo-feature' }),
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true, message: '/srv/repo-feature' })
    expect(mocks.openServerRemoteTerminal).toHaveBeenCalledWith(
      { repoId: 'ssh-config://prod/srv/repo', worktreePath: '/srv/repo-feature' },
      expect.any(AbortSignal),
    )
  })
```

- [ ] **Step 6: Run route test and verify failure**

Run:

```bash
bun run test src/server/routes/remote.test.ts
```

Expected: FAIL because `/open-terminal` is not registered.

- [ ] **Step 7: Implement remote route**

In `src/server/routes/remote.ts`, update the import list:

```ts
  openServerRemoteEditor,
  openServerRemoteTerminal,
```

Add this route after `/open-editor`:

```ts
  app.post('/open-terminal', async (c) => {
    const body = await c.req.json().catch(() => null)
    const repoId = typeof body?.repoId === 'string' ? body.repoId : ''
    const worktreePath = typeof body?.worktreePath === 'string' ? body.worktreePath : ''
    return c.json(await openServerRemoteTerminal({ repoId, worktreePath }, c.req.raw.signal))
  })
```

- [ ] **Step 8: Run route test and verify pass**

Run:

```bash
bun run test src/server/routes/remote.test.ts
```

Expected: PASS.

- [ ] **Step 9: Write failing web client test**

In `src/web/app-data-client.test.ts`, add a focused test near the existing server-backed terminal/editor test:

```ts
  test('opens remote terminal through embedded server remote route', async () => {
    installWebBootstrap(webBootstrap({ initialServer: { url: 'http://127.0.0.1:32100/', secret: 'secret' } }))
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, message: 'remote-terminal' }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const { openRemoteRepositoryTerminal } = await import('#/web/app-data-client.ts')

    await expect(openRemoteRepositoryTerminal('ssh-config://prod/srv/repo', '/srv/repo-feature')).resolves.toEqual({
      ok: true,
      message: 'remote-terminal',
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:32100/api/remote/open-terminal',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'content-type': 'application/json',
          'x-goblin-internal-secret': 'secret',
        }),
        body: JSON.stringify({ repoId: 'ssh-config://prod/srv/repo', worktreePath: '/srv/repo-feature' }),
      }),
    )
  })
```

- [ ] **Step 10: Run web client test and verify failure**

Run:

```bash
bun run test src/web/app-data-client.test.ts
```

Expected: FAIL because `openRemoteRepositoryTerminal` is not exported.

- [ ] **Step 11: Implement web client function**

In `src/web/app-data-client.ts`, add this function after `openRemoteRepositoryEditor()`:

```ts
export async function openRemoteRepositoryTerminal(repoId: string, worktreePath: string): Promise<ExecResult> {
  return await postServerJson('/api/remote/open-terminal', { repoId, worktreePath })
}
```

- [ ] **Step 12: Add i18n error key**

Add the key beside `error.remote-editor-not-supported` in each dictionary.

In `src/shared/i18n/en.ts`:

```ts
  'error.remote-terminal-not-supported': 'The selected terminal cannot open remote SSH workspaces',
```

In `src/shared/i18n/zh.ts`:

```ts
  'error.remote-terminal-not-supported': '所选终端无法打开远程 SSH 工作区',
```

In `src/shared/i18n/ko.ts`:

```ts
  'error.remote-terminal-not-supported': '선택한 터미널은 원격 SSH 작업 영역을 열 수 없습니다',
```

In `src/shared/i18n/ja.ts`:

```ts
  'error.remote-terminal-not-supported': '選択したターミナルはリモート SSH ワークスペースを開けません',
```

- [ ] **Step 13: Run server/client/i18n tests and verify pass**

Run:

```bash
bun run test src/server/modules/remote.test.ts src/server/routes/remote.test.ts src/web/app-data-client.test.ts src/shared/i18n/dictionaries.test.ts
```

Expected: PASS.

---

### Task 5: Route Branch Actions To Remote External Terminal

**Files:**
- Modify: `src/web/hooks/useBranchActions.test.tsx`
- Modify: `src/web/hooks/useBranchActions.tsx`
- Modify: `src/web/commands/workspace-commands.test.ts`
- Modify: `src/web/commands/workspace-commands.ts`

- [ ] **Step 1: Rewrite failing hook tests for the new remote terminal semantics**

In `src/web/hooks/useBranchActions.test.tsx`, remove these imports:

```ts
import { setTerminalSessionCommandBridge } from '#/web/components/terminal/terminal-session-command-bridge.ts'
import { worktreeTerminalKey } from '#/web/components/terminal/terminal-session-utils.ts'
```

Extend mocks:

```ts
  openRemoteRepositoryTerminal: vi.fn(),
```

Extend the app-data-client mock:

```ts
  openRemoteRepositoryTerminal: mocks.openRemoteRepositoryTerminal,
```

Reset the new mock in `beforeEach()`:

```ts
    mocks.openRemoteRepositoryTerminal.mockReset()
```

Remove this line from `afterEach()`:

```ts
    setTerminalSessionCommandBridge(null)
```

Replace the old remote terminal tests with this single test:

```ts
  test('opens remote terminals through the remote terminal client without selecting the in-app terminal tab', async () => {
    mocks.openRemoteRepositoryTerminal.mockResolvedValue({ ok: true, message: '' })
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

    expect(mocks.openRemoteRepositoryTerminal).toHaveBeenCalledWith(target!.id, '/srv/repo-feature')
    expect(mocks.openRepositoryTerminal).not.toHaveBeenCalled()
    expect(mocks.showRepoDetailTab).not.toHaveBeenCalled()
    expect(mocks.showRepoBranchDetailTab).not.toHaveBeenCalled()
  })
```

Replace the local terminal test with this version:

```ts
  test('keeps local terminal actions on the external terminal route', async () => {
    mocks.openRepositoryTerminal.mockResolvedValue({ ok: true, message: '' })
    const branch = createRepoBranch('feature/local-terminal', { worktree: { path: '/tmp/repo-feature' } })
    const repo = seedRepoState({
      id: REPO_ID,
      branches: [branch],
    })

    let actions: ReturnType<typeof useBranchActions>['actions'] | null = null
    root = createRoot(container)
    await act(async () => {
      root!.render(<BranchActionsHarness repo={repo} onReady={(value) => (actions = value)} />)
    })

    await act(async () => {
      await actions?.openTerminal?.()
    })

    expect(mocks.openRepositoryTerminal).toHaveBeenCalledWith('/tmp/repo-feature')
    expect(mocks.openRemoteRepositoryTerminal).not.toHaveBeenCalled()
    expect(mocks.showRepoBranchDetailTab).not.toHaveBeenCalled()
  })
```

- [ ] **Step 2: Run hook tests and verify failure**

Run:

```bash
bun run test src/web/hooks/useBranchActions.test.tsx
```

Expected: FAIL because `useBranchActions.openTerminal()` still uses the old in-app terminal command path for remote repositories.

- [ ] **Step 3: Implement branch action routing**

In `src/web/hooks/useBranchActions.tsx`, update the app-data-client import:

```ts
import {
  getRepositoryPatch,
  openRepositoryEditor,
  openRepositoryRemote,
  openRepositoryTerminal,
  openRemoteRepositoryEditor,
  openRemoteRepositoryTerminal,
} from '#/web/app-data-client.ts'
```

Remove these imports:

```ts
import { useMainWindowNavigation } from '#/web/main-window-navigation.tsx'
import { runOpenWorktreeTerminalCommand } from '#/web/commands/workspace-commands.ts'
```

Remove these lines inside `useBranchActions()`:

```ts
  const navigation = useMainWindowNavigation()
  const setDetailCollapsed = useReposStore((s) => s.setDetailCollapsed)
```

Replace `openTerminal()` with:

```ts
  function openTerminal() {
    if (!branch.worktree?.path) return
    const worktreePath = branch.worktree?.path
    if (repo.remote.target) {
      return runUiAction('terminal', () => openRemoteRepositoryTerminal(repo.id, worktreePath))
    }
    return runUiAction('terminal', () => openRepositoryTerminal(worktreePath))
  }
```

- [ ] **Step 4: Remove superseded workspace command helper**

In `src/web/commands/workspace-commands.ts`, remove:

```ts
interface OpenWorktreeTerminalCommandOptions {
  base: TerminalSessionBase
  navigation: MainWindowNavigationActions
  setDetailCollapsed: (collapsed: boolean) => void
}

export async function runOpenWorktreeTerminalCommand({
  base,
  navigation,
  setDetailCollapsed,
}: OpenWorktreeTerminalCommandOptions): Promise<boolean> {
  navigation.showRepoBranchDetailTab(base.repoRoot, base.branch, 'terminal')
  setDetailCollapsed(false)

  const bridge = readTerminalSessionCommandBridge()
  if (!bridge) return true

  const worktree = bridge.worktreeSnapshot(worktreeTerminalKey(base.repoRoot, base.worktreePath))
  if (worktree.count > 0) return true

  await bridge.createTerminal(base)
  return true
}
```

Restore `runTerminalPrimaryActionCommand()` to keep the existing app-level primary terminal behavior:

```ts
export async function runTerminalPrimaryActionCommand({
  repoId,
  navigation,
  setDetailCollapsed,
}: TerminalPrimaryActionCommandOptions): Promise<boolean> {
  if (!repoId) return false
  runShowDetailTabCommand({ repoId, tab: 'terminal', navigation, setDetailCollapsed })
  const base = selectedTerminalBase(repoId)
  if (!base) return true
  const bridge = readTerminalSessionCommandBridge()
  if (!bridge) return true
  const worktree = bridge.worktreeSnapshot(worktreeTerminalKey(base.repoRoot, base.worktreePath))
  if (worktree.count > 0) return true
  await bridge.createTerminal(base)
  return true
}
```

In `src/web/commands/workspace-commands.test.ts`, remove `runOpenWorktreeTerminalCommand` from the import list and delete these two tests:

- `open worktree terminal command selects the explicit branch and creates the first terminal when missing`
- `open worktree terminal command does not create a duplicate terminal when one already exists`

- [ ] **Step 5: Run hook and command tests and verify pass**

Run:

```bash
bun run test src/web/hooks/useBranchActions.test.tsx src/web/commands/workspace-commands.test.ts
```

Expected: PASS.

---

### Task 6: Final Verification

**Files:**
- No planned source edits.

- [ ] **Step 1: Run focused feature tests**

Run:

```bash
bun run test src/system/remote-terminal.test.ts src/system/apple-terminal.test.ts src/system/ghostty.test.ts src/system/terminals.test.ts src/server/modules/remote.test.ts src/server/routes/remote.test.ts src/web/app-data-client.test.ts src/web/hooks/useBranchActions.test.tsx src/web/commands/workspace-commands.test.ts src/shared/i18n/dictionaries.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run:

```bash
bun run typecheck
```

Expected: PASS.

- [ ] **Step 3: Run architecture guard**

Run:

```bash
bun run check:architecture
```

Expected: PASS.

- [ ] **Step 4: Inspect remaining remote terminal references**

Run:

```bash
rg -n "runOpenWorktreeTerminalCommand|create the first Goblin terminal|remote terminal action autocreate" "src"
```

Expected: no matches.

Then run:

```bash
rg -n "Goblin-managed terminal sessions|supersedes|superseded" "docs/superpowers/specs/2026-06-08-remote-terminal-action-autocreate-design.md" "docs/superpowers/plans/2026-06-08-remote-terminal-action-autocreate.md"
```

Expected: matches only in the design/plan text that describes the old in-app terminal direction as superseded.

- [ ] **Step 5: Manual verification**

Manual steps:

1. Start the app normally.
2. Open a saved remote repository backed by an SSH config alias.
3. Choose a branch with a remote worktree path.
4. Select `Terminal`.
5. Confirm the configured local terminal app opens.
6. Confirm the terminal SSHes through the saved alias and starts in the selected remote worktree.
7. Confirm Goblin does not switch to the in-app Terminal detail tab and does not create an in-app terminal session.
