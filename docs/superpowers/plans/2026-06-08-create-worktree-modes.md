# Create Worktree Modes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand create-worktree so it can create from a new branch, an existing local branch, a remote-tracking branch, or a detached ref, with detached worktrees shown separately.

**Architecture:** Add a shared create-worktree contract and keep Git command selection in system layers. Server backends validate and dispatch object-shaped requests for local and SSH repositories. Renderer store carries the request object unchanged; the dialog builds one explicit mode; detached worktrees flow through canonical worktree state and render outside branch selection.

**Tech Stack:** TypeScript, React, Zustand, Hono, Bun, Vitest, Git CLI, SSH command wrapper.

---

## File Structure

- Create: `src/shared/worktree-create.ts` - shared request types, remote ref parsing, derived local branch naming, and request validation.
- Create: `src/shared/worktree-create.test.ts` - pure tests for request normalization and remote ref helpers.
- Create: `src/system/git/remote-refs.ts` - local repository remote-tracking ref reader.
- Create: `src/system/git/remote-refs.test.ts` - local remote ref reader tests.
- Create: `src/system/ssh/commands.test.ts` - SSH command rendering tests for new command variants.
- Modify: `src/shared/git-types.ts` - add optional detached `head` to `WorktreeInfo`, `WorktreeStatus`, and `BranchWorktreeSnapshot`.
- Modify: `src/system/git/parsers.ts` and `src/system/git/parsers.test.ts` - preserve `HEAD` from `git worktree list --porcelain` and parse remote refs.
- Modify: `src/system/git/worktrees.ts` and `src/system/git/worktrees.test.ts` - replace positional create arguments with mode-based command selection.
- Modify: `src/system/git/status.ts` - carry detached head from parsed worktrees into `WorktreeStatus`.
- Modify: `src/system/ssh/commands.ts` - add remote refs command and mode-based `gitWorktreeAdd`.
- Modify: `src/system/ssh/git.ts` and `src/system/ssh/git.test.ts` - expose remote ref listing and mode-based remote worktree creation.
- Modify: `src/server/modules/repo-backend.ts` - update backend interface, local backend, and remote backend.
- Modify: `src/server/modules/repo.ts` and `src/server/modules/repo.test.ts` - expose object-shaped create and remote branch list APIs.
- Modify: `src/server/routes/repo.ts` - parse `/create-worktree` mode input and add `/remote-branches`.
- Modify: `src/shared/rpc.ts` and `src/shared/embedded-server-rpc-routes.ts` - update RPC types and route map.
- Modify: `src/web/app-data-client.ts` - send object-shaped create requests and expose remote branch listing.
- Modify: `src/web/stores/repos/branch-action-types.ts`, `src/web/stores/repos/branch-actions.ts`, and tests - carry `CreateWorktreeRequest` through the store.
- Create: `src/web/components/create-worktree-dialog-model.ts` - pure dialog mode, path label, local branch derivation, and submit input helpers.
- Create: `src/web/components/create-worktree-dialog-model.test.ts` - focused tests for create dialog mode mapping without Radix interaction coupling.
- Modify: `src/web/components/CreateWorktreeDialog.tsx` and `src/web/components/CreateWorktreeDialog.test.tsx` - add mode selector, remote refs, refresh, and submit mapping.
- Modify: `src/web/components/repo-toolbar/RepoToolbarActions.tsx` - pass the new request object into store actions.
- Modify: `src/web/stores/repos/types.ts`, `src/web/stores/repos/worktree-state.ts`, and tests - store detached worktree state.
- Create: `src/web/components/branch-list/DetachedWorktreeRow.tsx` - row for detached worktrees.
- Create: `src/web/components/branch-list/DetachedWorktreeSection.tsx` - detached worktree section below branch list.
- Modify: `src/web/components/BranchList.tsx` and branch list tests - render detached section without changing `selectedBranch`.
- Modify: `src/shared/worktree-guards.ts` and tests - allow worktree-only removal for detached worktrees while keeping safety checks.
- Create: `src/web/hooks/useDetachedWorktreeActions.tsx` - provide terminal/editor/remove actions for detached rows.
- Modify: `src/shared/i18n/en.ts`, `src/shared/i18n/zh.ts`, `src/shared/i18n/ko.ts`, `src/shared/i18n/ja.ts`, and `src/shared/i18n/dictionaries.test.ts` - add copy for modes, remote refresh, detached rows, and validation.

## Task 1: Shared Contract And Pure Helpers

**Files:**
- Create: `src/shared/worktree-create.ts`
- Create: `src/shared/worktree-create.test.ts`
- Modify: `src/shared/rpc.ts`

- [ ] **Step 1: Write failing tests for create-worktree mode validation**

Create `src/shared/worktree-create.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import {
  deriveLocalBranchFromRemoteRef,
  normalizeCreateWorktreeInput,
  parseRemoteTrackingRefs,
} from '#/shared/worktree-create.ts'

describe('worktree create helpers', () => {
  test('accepts a new branch create request', () => {
    expect(
      normalizeCreateWorktreeInput({
        worktreePath: '/tmp/repo-feature',
        mode: { kind: 'newBranch', newBranch: 'feature/a', baseRef: 'main' },
      }),
    ).toEqual({
      worktreePath: '/tmp/repo-feature',
      mode: { kind: 'newBranch', newBranch: 'feature/a', baseRef: 'main' },
    })
  })

  test('accepts existing branch and detached requests', () => {
    expect(
      normalizeCreateWorktreeInput({
        worktreePath: '/tmp/repo-existing',
        mode: { kind: 'existingBranch', branch: 'feature/existing' },
      }),
    ).toMatchObject({ mode: { kind: 'existingBranch', branch: 'feature/existing' } })
    expect(
      normalizeCreateWorktreeInput({
        worktreePath: '/tmp/repo-detached',
        mode: { kind: 'detached', ref: 'origin/feature/a' },
      }),
    ).toMatchObject({ mode: { kind: 'detached', ref: 'origin/feature/a' } })
  })

  test('rejects malformed requests', () => {
    expect(normalizeCreateWorktreeInput({ worktreePath: '', mode: { kind: 'existingBranch', branch: 'main' } })).toBeNull()
    expect(
      normalizeCreateWorktreeInput({
        worktreePath: '/tmp/repo',
        mode: { kind: 'trackRemoteBranch', remoteRef: 'origin/feature/a', localBranch: 'bad branch' },
      }),
    ).toBeNull()
    expect(normalizeCreateWorktreeInput({ worktreePath: '/tmp/repo', mode: { kind: 'unknown' } })).toBeNull()
  })

  test('parses and filters remote-tracking refs', () => {
    expect(parseRemoteTrackingRefs('origin/HEAD\norigin/main\norigin/feature/a\nupstream/release/v1\n')).toEqual([
      'origin/main',
      'origin/feature/a',
      'upstream/release/v1',
    ])
  })

  test('derives local branch names from remote refs', () => {
    expect(deriveLocalBranchFromRemoteRef('origin/feature/a')).toBe('feature/a')
    expect(deriveLocalBranchFromRemoteRef('upstream/release/v1')).toBe('release/v1')
    expect(deriveLocalBranchFromRemoteRef('origin/HEAD')).toBeNull()
  })
})
```

- [ ] **Step 2: Run the focused failing test**

Run:

```bash
bun run test src/shared/worktree-create.test.ts
```

Expected: FAIL because `src/shared/worktree-create.ts` does not exist.

- [ ] **Step 3: Add shared request types and helpers**

Create `src/shared/worktree-create.ts`:

```ts
import { isSafeBranchName } from '#/shared/refnames.ts'

export type CreateWorktreeMode =
  | { kind: 'newBranch'; newBranch: string; baseRef: string }
  | { kind: 'existingBranch'; branch: string }
  | { kind: 'trackRemoteBranch'; remoteRef: string; localBranch: string }
  | { kind: 'detached'; ref: string }

export interface CreateWorktreeInput {
  worktreePath: string
  mode: CreateWorktreeMode
}

export interface CreateWorktreeRpcInput extends CreateWorktreeInput {
  cwd: string
  sourceToken?: string
}

export function parseRemoteTrackingRefs(output: string): string[] {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((ref) => isRemoteTrackingRef(ref))
}

export function deriveLocalBranchFromRemoteRef(remoteRef: string): string | null {
  if (!isRemoteTrackingRef(remoteRef)) return null
  const slash = remoteRef.indexOf('/')
  const branch = slash >= 0 ? remoteRef.slice(slash + 1) : ''
  return isSafeBranchName(branch) ? branch : null
}

export function normalizeCreateWorktreeInput(input: unknown): CreateWorktreeInput | null {
  if (!input || typeof input !== 'object') return null
  const raw = input as { worktreePath?: unknown; mode?: unknown }
  const worktreePath = typeof raw.worktreePath === 'string' ? raw.worktreePath.trim() : ''
  if (!worktreePath) return null
  const mode = normalizeCreateWorktreeMode(raw.mode)
  return mode ? { worktreePath, mode } : null
}

function normalizeCreateWorktreeMode(input: unknown): CreateWorktreeMode | null {
  if (!input || typeof input !== 'object') return null
  const mode = input as Record<string, unknown>
  switch (mode.kind) {
    case 'newBranch': {
      const newBranch = stringField(mode.newBranch)
      const baseRef = stringField(mode.baseRef)
      return newBranch && baseRef && isSafeBranchName(newBranch) && isSafeRefInput(baseRef)
        ? { kind: 'newBranch', newBranch, baseRef }
        : null
    }
    case 'existingBranch': {
      const branch = stringField(mode.branch)
      return branch && isSafeBranchName(branch) ? { kind: 'existingBranch', branch } : null
    }
    case 'trackRemoteBranch': {
      const remoteRef = stringField(mode.remoteRef)
      const localBranch = stringField(mode.localBranch)
      return remoteRef && localBranch && isRemoteTrackingRef(remoteRef) && isSafeBranchName(localBranch)
        ? { kind: 'trackRemoteBranch', remoteRef, localBranch }
        : null
    }
    case 'detached': {
      const ref = stringField(mode.ref)
      return ref && isSafeRefInput(ref) ? { kind: 'detached', ref } : null
    }
    default:
      return null
  }
}

function stringField(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isRemoteTrackingRef(ref: string): boolean {
  const slash = ref.indexOf('/')
  if (slash <= 0) return false
  if (ref.endsWith('/HEAD')) return false
  const remote = ref.slice(0, slash)
  const branch = ref.slice(slash + 1)
  return isSafeRemoteName(remote) && isSafeBranchName(branch)
}

function isSafeRemoteName(remote: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(remote)
}

function isSafeRefInput(ref: string): boolean {
  return isSafeBranchName(ref) || isRemoteTrackingRef(ref)
}
```

- [ ] **Step 4: Update RPC type imports**

Modify `src/shared/rpc.ts`:

```ts
import type { CreateWorktreeRpcInput } from '#/shared/worktree-create.ts'
```

Then change the repo RPC signatures:

```ts
    createWorktree: (input: CreateWorktreeRpcInput) => Promise<ExecResult>
    remoteBranches: (input: { cwd: string }) => Promise<string[]>
```

- [ ] **Step 5: Run shared tests**

Run:

```bash
bun run test src/shared/worktree-create.test.ts src/shared/rpc.ts
```

Expected: PASS for `worktree-create.test.ts`; Vitest may report no tests for `src/shared/rpc.ts` if invoked directly. If that happens, run only:

```bash
bun run test src/shared/worktree-create.test.ts
```

- [ ] **Step 6: Commit shared contract**

```bash
git add src/shared/worktree-create.ts src/shared/worktree-create.test.ts src/shared/rpc.ts
git commit -m "feat: add worktree create contract"
```

## Task 2: Git And SSH System Support

**Files:**
- Modify: `src/shared/git-types.ts`
- Modify: `src/system/git/parsers.ts`
- Modify: `src/system/git/parsers.test.ts`
- Modify: `src/system/git/worktrees.ts`
- Modify: `src/system/git/worktrees.test.ts`
- Modify: `src/system/git/status.ts`
- Create: `src/system/git/remote-refs.ts`
- Create: `src/system/git/remote-refs.test.ts`
- Modify: `src/system/ssh/commands.ts`
- Create: `src/system/ssh/commands.test.ts`
- Modify: `src/system/ssh/git.ts`
- Modify: `src/system/ssh/git.test.ts`

- [ ] **Step 1: Write failing parser tests for detached head and remote refs**

Append to `src/system/git/parsers.test.ts`:

```ts
describe('parseWorktrees detached metadata', () => {
  test('preserves detached HEAD hashes', () => {
    const output = [
      'worktree /repo',
      'HEAD aaaaaaa',
      'branch refs/heads/main',
      '',
      'worktree /repo-detached',
      'HEAD bbbbbbb',
      'detached',
      '',
    ].join('\n')

    expect(parseWorktrees(output)).toEqual([
      { path: '/repo', branch: 'main', head: 'aaaaaaa', isBare: false, isPrimary: true, isLocked: false },
      { path: '/repo-detached', head: 'bbbbbbb', isBare: false, isPrimary: false, isLocked: false },
    ])
  })
})
```

- [ ] **Step 2: Update shared Git types for detached head**

Modify `src/shared/git-types.ts`:

```ts
export interface BranchWorktreeSnapshot {
  path: string
  isPrimary?: boolean
  isLocked?: boolean
  head?: string
  summary?: BranchWorktreeSnapshotSummary
}

export interface WorktreeInfo {
  path: string
  branch?: string
  head?: string
  isBare: boolean
  isPrimary: boolean
  isDirty?: boolean
  changeCount?: number
  isLocked?: boolean
}

export interface WorktreeStatus {
  path: string
  branch?: string
  head?: string
  isMain: boolean
  entries: StatusEntry[]
}
```

- [ ] **Step 3: Preserve HEAD in worktree parsing and status**

Modify `parseWorktrees` in `src/system/git/parsers.ts`:

```ts
    let head: string | undefined

    for (const line of lines) {
      if (line.startsWith('worktree ')) {
        path = line.slice('worktree '.length)
      } else if (line.startsWith('HEAD ')) {
        head = line.slice('HEAD '.length)
      } else if (line.startsWith('branch ')) {
        const ref = line.slice('branch '.length)
        branch = ref.replace(/^refs\/heads\//, '')
      } else if (line === 'bare') {
        isBare = true
      } else if (line === 'locked' || line.startsWith('locked ')) {
        isLocked = true
      }
    }

    if (path) worktrees.push({ path, branch, head, isBare, isPrimary: worktrees.length === 0, isLocked })
```

Modify `src/system/git/status.ts` status result:

```ts
        return {
          path: wt.path,
          branch: wt.branch,
          head: wt.head,
          isMain: wt.isPrimary,
          entries,
        }
```

- [ ] **Step 4: Write failing local worktree command tests**

Replace the create test in `src/system/git/worktrees.test.ts` with:

```ts
  test.each([
    [
      'newBranch',
      { worktreePath: '/tmp/repo-feature', mode: { kind: 'newBranch' as const, newBranch: 'feature/branch', baseRef: 'main' } },
      ['worktree', 'add', '-b', 'feature/branch', '--', '/tmp/repo-feature', 'main'],
    ],
    [
      'existingBranch',
      { worktreePath: '/tmp/repo-feature', mode: { kind: 'existingBranch' as const, branch: 'feature/branch' } },
      ['worktree', 'add', '--', '/tmp/repo-feature', 'feature/branch'],
    ],
    [
      'trackRemoteBranch',
      {
        worktreePath: '/tmp/repo-feature',
        mode: { kind: 'trackRemoteBranch' as const, remoteRef: 'origin/feature/branch', localBranch: 'feature/branch' },
      },
      ['worktree', 'add', '-b', 'feature/branch', '--track', '--', '/tmp/repo-feature', 'origin/feature/branch'],
    ],
    [
      'detached',
      { worktreePath: '/tmp/repo-detached', mode: { kind: 'detached' as const, ref: 'origin/feature/branch' } },
      ['worktree', 'add', '--detach', '--', '/tmp/repo-detached', 'origin/feature/branch'],
    ],
  ])('delegates %s createWorktree to git worktree add', async (_name, input, expectedArgs) => {
    const signal = new AbortController().signal

    const result = await createWorktree('/tmp/repo', input, signal)

    expect(result).toEqual({ ok: false, message: 'cancelled' })
    expect(gitResultWithOptionsMock).toHaveBeenCalledWith('/tmp/repo', { timeoutMs: 180_000, signal }, ...expectedArgs)
  })
```

- [ ] **Step 5: Implement local mode command selection**

Modify `src/system/git/worktrees.ts`:

```ts
import type { CreateWorktreeInput } from '#/shared/worktree-create.ts'

export async function createWorktree(
  cwd: string,
  input: CreateWorktreeInput,
  signal?: AbortSignal,
): Promise<ExecResult> {
  return gitResultWithOptions(cwd, { timeoutMs: WORKTREE_OP_TIMEOUT_MS, signal }, 'worktree', 'add', ...createWorktreeArgs(input))
}

function createWorktreeArgs(input: CreateWorktreeInput): string[] {
  switch (input.mode.kind) {
    case 'newBranch':
      return ['-b', input.mode.newBranch, '--', input.worktreePath, input.mode.baseRef]
    case 'existingBranch':
      return ['--', input.worktreePath, input.mode.branch]
    case 'trackRemoteBranch':
      return ['-b', input.mode.localBranch, '--track', '--', input.worktreePath, input.mode.remoteRef]
    case 'detached':
      return ['--detach', '--', input.worktreePath, input.mode.ref]
  }
}
```

- [ ] **Step 6: Add local remote branch reader**

Create `src/system/git/remote-refs.ts`:

```ts
import { git } from '#/system/git/helper.ts'
import { parseRemoteTrackingRefs } from '#/shared/worktree-create.ts'

export async function getRemoteTrackingBranches(cwd: string, signal?: AbortSignal): Promise<string[]> {
  try {
    const output = await git(cwd, ['for-each-ref', '--format=%(refname:short)', 'refs/remotes/'], { signal })
    return parseRemoteTrackingRefs(output)
  } catch {
    return []
  }
}
```

Create `src/system/git/remote-refs.test.ts`:

```ts
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { getRemoteTrackingBranches } from '#/system/git/remote-refs.ts'

const gitMock = vi.hoisted(() => vi.fn())

vi.mock('#/system/git/helper.ts', () => ({
  git: gitMock,
}))

describe('getRemoteTrackingBranches', () => {
  beforeEach(() => gitMock.mockReset())

  test('reads and filters remote-tracking refs', async () => {
    const signal = new AbortController().signal
    gitMock.mockResolvedValue('origin/HEAD\norigin/main\norigin/feature/a\n')

    await expect(getRemoteTrackingBranches('/repo', signal)).resolves.toEqual(['origin/main', 'origin/feature/a'])
    expect(gitMock).toHaveBeenCalledWith('/repo', ['for-each-ref', '--format=%(refname:short)', 'refs/remotes/'], { signal })
  })
})
```

- [ ] **Step 7: Write SSH command tests**

Create `src/system/ssh/commands.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { buildRemoteCommandInvocation } from '#/system/ssh/commands.ts'
import { normalizeRemoteTarget } from '#/shared/remote-repo.ts'

const TARGET = normalizeRemoteTarget({
  alias: 'prod',
  host: 'example.com',
  user: 'alice',
  port: 22,
  remotePath: '/srv/repo',
})!

describe('remote command scripts', () => {
  test('renders remote branch listing command', () => {
    expect(buildRemoteCommandInvocation(TARGET, { type: 'gitRemoteBranches', path: '/srv/repo' }).script).toContain(
      "for-each-ref '--format=%(refname:short)' refs/remotes/",
    )
  })

  test('renders all worktree add modes', () => {
    expect(
      buildRemoteCommandInvocation(TARGET, {
        type: 'gitWorktreeAdd',
        path: '/srv/repo',
        input: { worktreePath: '/srv/repo-feature', mode: { kind: 'existingBranch', branch: 'feature/a' } },
      }).script,
    ).toContain("worktree add -- '/srv/repo-feature' 'feature/a'")

    expect(
      buildRemoteCommandInvocation(TARGET, {
        type: 'gitWorktreeAdd',
        path: '/srv/repo',
        input: {
          worktreePath: '/srv/repo-feature',
          mode: { kind: 'trackRemoteBranch', remoteRef: 'origin/feature/a', localBranch: 'feature/a' },
        },
      }).script,
    ).toContain("worktree add -b 'feature/a' --track -- '/srv/repo-feature' 'origin/feature/a'")

    expect(
      buildRemoteCommandInvocation(TARGET, {
        type: 'gitWorktreeAdd',
        path: '/srv/repo',
        input: { worktreePath: '/srv/repo-detached', mode: { kind: 'detached', ref: 'origin/feature/a' } },
      }).script,
    ).toContain("worktree add --detach -- '/srv/repo-detached' 'origin/feature/a'")
  })
})
```

- [ ] **Step 8: Implement SSH command variants and remote helper**

Modify `src/system/ssh/commands.ts`:

```ts
import type { CreateWorktreeInput } from '#/shared/worktree-create.ts'

export type RemoteCommandKind =
  | { type: 'gitRemoteBranches'; path: string }
  | { type: 'gitWorktreeAdd'; path: string; input: CreateWorktreeInput }
```

Replace the `gitWorktreeAdd` case and add `gitRemoteBranches`:

```ts
    case 'gitRemoteBranches':
      return `git -C ${shellQuote(command.path)} for-each-ref ${shellQuote('--format=%(refname:short)')} refs/remotes/`
    case 'gitWorktreeAdd':
      return `git -C ${shellQuote(command.path)} worktree add ${remoteWorktreeAddArgs(command.input)}`
```

Add helper near `shellQuote`:

```ts
function remoteWorktreeAddArgs(input: CreateWorktreeInput): string {
  switch (input.mode.kind) {
    case 'newBranch':
      return ['-b', input.mode.newBranch, '--', input.worktreePath, input.mode.baseRef].map(shellQuote).join(' ')
    case 'existingBranch':
      return ['--', input.worktreePath, input.mode.branch].map(shellQuote).join(' ')
    case 'trackRemoteBranch':
      return ['-b', input.mode.localBranch, '--track', '--', input.worktreePath, input.mode.remoteRef].map(shellQuote).join(' ')
    case 'detached':
      return ['--detach', '--', input.worktreePath, input.mode.ref].map(shellQuote).join(' ')
  }
}
```

Modify `src/system/ssh/git.ts`:

```ts
import { parseRemoteTrackingRefs, type CreateWorktreeInput } from '#/shared/worktree-create.ts'

export async function getRemoteTrackingBranches(
  target: RemoteRepoTarget,
  options: { signal?: AbortSignal; run?: RemoteGitRunner } = {},
): Promise<string[]> {
  const run: RemoteGitRunner = options.run ?? ((command, t, runOptions) => runRemoteCommand(t, command, runOptions))
  const result = await run({ type: 'gitRemoteBranches', path: target.remotePath }, target, { signal: options.signal })
  return result.ok ? parseRemoteTrackingRefs(result.stdout) : []
}

export async function createRemoteWorktree(
  target: RemoteRepoTarget,
  input: CreateWorktreeInput & { signal?: AbortSignal; run?: RemoteGitRunner },
): Promise<ExecResult> {
  const run: RemoteGitRunner = input.run ?? ((command, t, runOptions) => runRemoteCommand(t, command, runOptions))
  const result = await run(
    { type: 'gitWorktreeAdd', path: target.remotePath, input: { worktreePath: input.worktreePath, mode: input.mode } },
    target,
    { signal: input.signal, timeoutMs: REMOTE_BRANCH_OP_TIMEOUT_MS },
  )
  return remoteExecResult(result)
}
```

- [ ] **Step 9: Run system tests**

Run:

```bash
bun run test src/system/git/parsers.test.ts src/system/git/worktrees.test.ts src/system/git/remote-refs.test.ts src/system/ssh/commands.test.ts src/system/ssh/git.test.ts
```

Expected: PASS.

- [ ] **Step 10: Commit system support**

```bash
git add src/shared/git-types.ts src/system/git/parsers.ts src/system/git/parsers.test.ts src/system/git/worktrees.ts src/system/git/worktrees.test.ts src/system/git/status.ts src/system/git/remote-refs.ts src/system/git/remote-refs.test.ts src/system/ssh/commands.ts src/system/ssh/commands.test.ts src/system/ssh/git.ts src/system/ssh/git.test.ts
git commit -m "feat: support worktree creation modes in git layers"
```

## Task 3: Server API And Backend Dispatch

**Files:**
- Modify: `src/server/modules/repo-backend.ts`
- Modify: `src/server/modules/repo.ts`
- Modify: `src/server/modules/repo.test.ts`
- Modify: `src/server/routes/repo.ts`
- Modify: `src/shared/embedded-server-rpc-routes.ts`
- Modify: `src/web/app-data-client.ts`
- Modify: `src/web/stores/repos/test-utils.ts`
- Modify: `src/web/stores/repos/web-transport.test.ts`

- [ ] **Step 1: Write failing server module tests**

In `src/server/modules/repo.test.ts`, add mocks:

```ts
  getRemoteTrackingBranches: vi.fn(),
```

Add mocks for local and SSH modules:

```ts
vi.mock('#/system/git/remote-refs.ts', () => ({
  getRemoteTrackingBranches: mocks.getRemoteTrackingBranches,
}))
```

Then add tests:

```ts
  test('createRepositoryWorktree passes object-shaped input through backend and invalidates after success', async () => {
    const repo = await import('#/server/modules/repo.ts')
    mocks.createWorktree.mockResolvedValueOnce({ ok: true, message: 'ok' })

    const result = await repo.createRepositoryWorktree(
      '/tmp/repo',
      { worktreePath: '/tmp/repo-feature', mode: { kind: 'existingBranch', branch: 'feature/a' } },
      undefined,
      'repo_branch_test',
    )

    expect(result).toEqual({ ok: true, message: 'ok' })
    expect(mocks.createWorktree).toHaveBeenCalledWith(
      '/tmp/repo',
      { worktreePath: '/tmp/repo-feature', mode: { kind: 'existingBranch', branch: 'feature/a' } },
      undefined,
    )
    expect(mocks.publishRepoQueryInvalidation).toHaveBeenCalledWith({
      repoId: '/tmp/repo',
      query: 'repo-snapshot',
      sourceToken: 'repo_branch_test',
    })
  })

  test('getRepositoryRemoteBranches returns local remote-tracking refs', async () => {
    const repo = await import('#/server/modules/repo.ts')
    mocks.getRemoteTrackingBranches.mockResolvedValueOnce(['origin/main', 'origin/feature/a'])

    await expect(repo.getRepositoryRemoteBranches('/tmp/repo')).resolves.toEqual(['origin/main', 'origin/feature/a'])
  })
```

- [ ] **Step 2: Update backend interface and implementations**

Modify `src/server/modules/repo-backend.ts`:

```ts
import type { CreateWorktreeInput } from '#/shared/worktree-create.ts'
import { getRemoteTrackingBranches as getLocalRemoteTrackingBranches } from '#/system/git/remote-refs.ts'
import { getRemoteTrackingBranches as getSshRemoteTrackingBranches } from '#/system/ssh/git.ts'

export interface RepoBackend {
  getRemoteBranches(signal?: AbortSignal): Promise<string[]>
  createWorktree(input: CreateWorktreeInput, signal?: AbortSignal): Promise<ExecResult>
}
```

In local backend:

```ts
    async getRemoteBranches(signal) {
      if (!isValidCwd(repoId)) return []
      return await getLocalRemoteTrackingBranches(repoId, signal)
    },
    async createWorktree(input, signal) {
      if (!isValidCwd(repoId)) return { ok: false, message: 'error.invalid-arguments' }
      return await createWorktree(repoId, input, signal)
    },
```

In remote backend:

```ts
    async getRemoteBranches(signal) {
      return await getSshRemoteTrackingBranches(target, { signal })
    },
    async createWorktree(input, signal) {
      return await createRemoteWorktree(target, { ...input, signal })
    },
```

- [ ] **Step 3: Update server module functions**

Modify `src/server/modules/repo.ts`:

```ts
import { normalizeCreateWorktreeInput, type CreateWorktreeInput } from '#/shared/worktree-create.ts'

export async function getRepositoryRemoteBranches(cwd: string, signal?: AbortSignal): Promise<string[]> {
  if (!isValidRepoLocator(cwd)) return []
  return await runWithRepoBackend(cwd, async (backend) => await backend.getRemoteBranches(signal))
}

export async function createRepositoryWorktree(
  cwd: string,
  input: CreateWorktreeInput,
  signal?: AbortSignal,
  sourceToken?: string,
): Promise<ExecResult> {
  if (!isValidRepoLocator(cwd)) return { ok: false, message: 'error.invalid-arguments' }
  const normalized = normalizeCreateWorktreeInput(input)
  if (!normalized) return { ok: false, message: 'error.invalid-arguments' }
  return await runWithRepoBackend(cwd, async (backend) => {
    return await invalidateRepoReadModelAfterMutation(cwd, await backend.createWorktree(normalized, signal), sourceToken)
  })
}
```

- [ ] **Step 4: Update repo routes and embedded route map**

Modify imports in `src/server/routes/repo.ts`:

```ts
  getRepositoryRemoteBranches,
```

Replace `/create-worktree` body handling:

```ts
  app.post('/create-worktree', async (c) => {
    const body = await c.req.json().catch(() => null)
    const cwd = typeof body?.cwd === 'string' ? body.cwd : ''
    const sourceToken = typeof body?.sourceToken === 'string' ? body.sourceToken : undefined
    return c.json(
      await jsonOr(
        () => createRepositoryWorktree(cwd, { worktreePath: body?.worktreePath, mode: body?.mode } as never, c.req.raw.signal, sourceToken),
        { ok: false, message: 'error.failed-read-repo' },
        'create-worktree',
      ),
    )
  })
```

Add route near `/status`:

```ts
  app.post('/remote-branches', async (c) => {
    const body = await c.req.json().catch(() => null)
    const cwd = typeof body?.cwd === 'string' ? body.cwd : ''
    return c.json(await jsonOr(() => getRepositoryRemoteBranches(cwd, c.req.raw.signal), [], 'remote-branches'))
  })
```

Modify `src/shared/embedded-server-rpc-routes.ts`:

```ts
  'repo.remoteBranches': { route: '/api/repo/remote-branches', method: 'POST' },
```

- [ ] **Step 5: Update app-data client and web test bridge**

Modify `src/web/app-data-client.ts`:

```ts
import type { CreateWorktreeInput } from '#/shared/worktree-create.ts'

export async function getRepositoryRemoteBranches(cwd: string, signal?: AbortSignal): Promise<string[]> {
  return await postServerJson('/api/repo/remote-branches', { cwd }, { signal })
}

export async function createRepositoryWorktree(
  cwd: string,
  input: CreateWorktreeInput,
  signal?: AbortSignal,
  sourceToken?: string,
): Promise<ExecResult> {
  return await postServerJson('/api/repo/create-worktree', { cwd, ...input, sourceToken }, { signal })
}
```

Modify `src/web/stores/repos/test-utils.ts`:

```ts
        if (url.pathname === '/api/repo/remote-branches') return call('repo.remoteBranches', body)
```

- [ ] **Step 6: Add web transport test for object-shaped create**

Add to `src/web/stores/repos/web-transport.test.ts`:

```ts
  test('create worktree posts object-shaped mode input', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, message: 'ok' }),
    }))
    vi.stubGlobal('fetch', fetchMock)
    const { createRepositoryWorktree } = await import('#/web/app-data-client.ts')

    await createRepositoryWorktree('/tmp/repo', {
      worktreePath: '/tmp/repo-feature',
      mode: { kind: 'existingBranch', branch: 'feature/a' },
    })

    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      cwd: '/tmp/repo',
      worktreePath: '/tmp/repo-feature',
      mode: { kind: 'existingBranch', branch: 'feature/a' },
    })
  })
```

- [ ] **Step 7: Run server/client tests**

Run:

```bash
bun run test src/server/modules/repo.test.ts src/web/stores/repos/web-transport.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit server API**

```bash
git add src/server/modules/repo-backend.ts src/server/modules/repo.ts src/server/modules/repo.test.ts src/server/routes/repo.ts src/shared/embedded-server-rpc-routes.ts src/web/app-data-client.ts src/web/stores/repos/test-utils.ts src/web/stores/repos/web-transport.test.ts
git commit -m "feat: expose worktree create modes through server api"
```

## Task 4: Renderer Store And Create Dialog

**Files:**
- Modify: `src/web/stores/repos/branch-action-types.ts`
- Modify: `src/web/stores/repos/branch-actions.ts`
- Modify: `src/web/stores/repos/branch-actions.test.ts`
- Modify: `src/web/stores/repos/refresh.test.ts`
- Modify: `src/web/components/repo-toolbar/RepoToolbarActions.tsx`
- Create: `src/web/components/create-worktree-dialog-model.ts`
- Create: `src/web/components/create-worktree-dialog-model.test.ts`
- Modify: `src/web/components/CreateWorktreeDialog.tsx`
- Modify: `src/web/components/CreateWorktreeDialog.test.tsx`
- Modify: `src/shared/i18n/en.ts`, `src/shared/i18n/zh.ts`, `src/shared/i18n/ko.ts`, `src/shared/i18n/ja.ts`

- [ ] **Step 1: Update store action type**

Modify `src/web/stores/repos/branch-action-types.ts`:

```ts
import type { CreateWorktreeInput } from '#/shared/worktree-create.ts'

export type RepoBranchAction =
  | { kind: 'createWorktree'; input: CreateWorktreeInput }
```

Keep the other existing union members unchanged.

- [ ] **Step 2: Update store action dispatch**

Modify `runBranchActionRpc` in `src/web/stores/repos/branch-actions.ts`:

```ts
    case 'createWorktree':
      return createRepositoryWorktree(repoId, action.input, signal, sourceToken)
```

Modify event target helpers:

```ts
function createWorktreeEventBranch(input: CreateWorktreeInput): string {
  switch (input.mode.kind) {
    case 'newBranch':
      return input.mode.newBranch
    case 'existingBranch':
      return input.mode.branch
    case 'trackRemoteBranch':
      return input.mode.localBranch
    case 'detached':
      return input.mode.ref
  }
}
```

Use `createWorktreeEventBranch(action.input)` wherever the old `action.newBranch` was used for operation target and result event.

- [ ] **Step 3: Update store tests to object-shaped actions**

In `src/web/stores/repos/branch-actions.test.ts`, replace create worktree action objects with:

```ts
{
  kind: 'createWorktree',
  input: {
    worktreePath: '/tmp/gbl-branch-actions-test-worktree',
    mode: { kind: 'newBranch', newBranch: 'feature/new', baseRef: 'feature/a' },
  },
}
```

Update expectations for RPC payload:

```ts
expect(createCall).toMatchObject({
  cwd: REPO_ID,
  worktreePath: '/tmp/gbl-branch-actions-test-worktree',
  mode: { kind: 'newBranch', newBranch: 'feature/new', baseRef: 'feature/a' },
})
```

Apply the same shape in `src/web/stores/repos/refresh.test.ts`.

- [ ] **Step 4: Add dialog i18n keys in all languages**

Add keys to each i18n dictionary. Use these English values in `en.ts`, and direct translations in `zh.ts`, `ko.ts`, and `ja.ts` matching existing tone:

```ts
  'action.create-worktree-mode-label': 'Mode',
  'action.create-worktree-mode-new-branch': 'New branch',
  'action.create-worktree-mode-existing-branch': 'Existing branch',
  'action.create-worktree-mode-track-remote': 'Track remote branch',
  'action.create-worktree-mode-detached': 'Detached',
  'action.create-worktree-existing-label': 'Branch',
  'action.create-worktree-remote-label': 'Remote branch',
  'action.create-worktree-local-branch-label': 'Local branch name',
  'action.create-worktree-detached-note': 'Creates a worktree without creating or switching a branch.',
  'action.create-worktree-refresh-remotes': 'Refresh remote branches',
  'action.create-worktree-refreshing-remotes': 'Refreshing remote branches…',
  'action.create-worktree-remote-missing': 'The selected remote branch no longer exists.',
```

- [ ] **Step 5: Write failing pure dialog model tests for new modes**

Create `src/web/components/create-worktree-dialog-model.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { buildCreateWorktreeInput, defaultBranchForCreateMode } from '#/web/components/create-worktree-dialog-model.ts'
import { emptyRepo } from '#/web/stores/repos/helpers.ts'
import type { RepoState } from '#/web/stores/repos/types.ts'

describe('create worktree dialog model', () => {
  test('builds existing branch mode without a new branch', () => {
    const repo = createRepo()

    expect(
      buildCreateWorktreeInput(repo, {
        mode: 'existingBranch',
        effectivePath: '/tmp/goblin-repo-feature-base',
        baseBranch: 'main',
        newBranch: '',
        existingBranch: 'feature/base',
        remoteBranch: '',
        localBranch: '',
        localBranchEdited: false,
      }),
    ).toEqual({
      worktreePath: '/tmp/goblin-repo-feature-base',
      mode: { kind: 'existingBranch', branch: 'feature/base' },
    })
  })

  test('builds track remote mode with derived local branch', () => {
    const repo = createRepo()

    expect(
      buildCreateWorktreeInput(repo, {
        mode: 'trackRemoteBranch',
        effectivePath: '/tmp/goblin-repo-feature-remote',
        baseBranch: 'main',
        newBranch: '',
        existingBranch: '',
        remoteBranch: 'origin/feature/remote',
        localBranch: 'feature/remote',
        localBranchEdited: false,
      }),
    ).toEqual({
      worktreePath: '/tmp/goblin-repo-feature-remote',
      mode: { kind: 'trackRemoteBranch', remoteRef: 'origin/feature/remote', localBranch: 'feature/remote' },
    })
  })

  test('converts default remote branch conflict into existing branch mode', () => {
    const repo = createRepo()

    expect(
      buildCreateWorktreeInput(repo, {
        mode: 'trackRemoteBranch',
        effectivePath: '/tmp/goblin-repo-feature-base',
        baseBranch: 'main',
        newBranch: '',
        existingBranch: '',
        remoteBranch: 'origin/feature/base',
        localBranch: 'feature/base',
        localBranchEdited: false,
      }),
    ).toEqual({
      worktreePath: '/tmp/goblin-repo-feature-base',
      mode: { kind: 'existingBranch', branch: 'feature/base' },
    })
  })

  test('blocks edited remote local branch conflicts', () => {
    const repo = createRepo()

    expect(
      buildCreateWorktreeInput(repo, {
        mode: 'trackRemoteBranch',
        effectivePath: '/tmp/goblin-repo-feature-base',
        baseBranch: 'main',
        newBranch: '',
        existingBranch: '',
        remoteBranch: 'origin/feature/new',
        localBranch: 'feature/base',
        localBranchEdited: true,
      }),
    ).toBeNull()
  })

  test('uses the active mode branch for path defaults', () => {
    expect(defaultBranchForCreateMode('existingBranch', '', 'feature/base', '', '')).toBe('feature/base')
    expect(defaultBranchForCreateMode('trackRemoteBranch', '', '', 'origin/feature/remote', 'feature/remote')).toBe(
      'feature/remote',
    )
    expect(defaultBranchForCreateMode('detached', '', '', 'origin/feature/remote', '')).toBe('origin/feature/remote')
  })

  function createRepo(): RepoState {
    const repo = emptyRepo('/tmp/goblin-repo', 'goblin-repo')
    repo.data.currentBranch = 'main'
    repo.data.branches = [
      { name: 'main', isCurrent: true, ahead: 0, behind: 0, lastCommitHash: '', lastCommitMessage: '', lastCommitDate: '', lastCommitAuthor: '' },
      { name: 'feature/base', isCurrent: false, ahead: 0, behind: 0, lastCommitHash: '', lastCommitMessage: '', lastCommitDate: '', lastCommitAuthor: '' },
    ]
    return repo
  }
})
```

- [ ] **Step 6: Implement pure dialog mode model**

Create `src/web/components/create-worktree-dialog-model.ts`:

```ts
import { deriveLocalBranchFromRemoteRef, type CreateWorktreeInput } from '#/shared/worktree-create.ts'
import type { RepoState } from '#/web/stores/repos/types.ts'

export type CreateWorktreeModeKind = CreateWorktreeInput['mode']['kind']

export interface CreateWorktreeDraft {
  mode: CreateWorktreeModeKind
  effectivePath: string
  baseBranch: string
  newBranch: string
  existingBranch: string
  remoteBranch: string
  localBranch: string
  localBranchEdited: boolean
}

export function defaultBranchForCreateMode(
  mode: CreateWorktreeModeKind,
  newBranch: string,
  existingBranch: string,
  remoteBranch: string,
  localBranch: string,
): string {
  if (mode === 'newBranch') return newBranch
  if (mode === 'existingBranch') return existingBranch
  if (mode === 'trackRemoteBranch') return localBranch || deriveLocalBranchFromRemoteRef(remoteBranch) || ''
  return remoteBranch
}

export function buildCreateWorktreeInput(repo: RepoState, draft: CreateWorktreeDraft): CreateWorktreeInput | null {
  if (!draft.effectivePath) return null
  if (draft.mode === 'newBranch') {
    if (!draft.newBranch || !draft.baseBranch) return null
    return { worktreePath: draft.effectivePath, mode: { kind: 'newBranch', newBranch: draft.newBranch, baseRef: draft.baseBranch } }
  }
  if (draft.mode === 'existingBranch') {
    if (!draft.existingBranch) return null
    return { worktreePath: draft.effectivePath, mode: { kind: 'existingBranch', branch: draft.existingBranch } }
  }
  if (draft.mode === 'trackRemoteBranch') {
    const derived = deriveLocalBranchFromRemoteRef(draft.remoteBranch)
    const localBranch = draft.localBranch || derived || ''
    if (!draft.remoteBranch || !localBranch) return null
    const localBranchExists = repo.data.branches.some((branch) => branch.name === localBranch)
    if (localBranchExists && draft.localBranchEdited) return null
    if (localBranchExists && derived === localBranch) {
      return { worktreePath: draft.effectivePath, mode: { kind: 'existingBranch', branch: localBranch } }
    }
    return { worktreePath: draft.effectivePath, mode: { kind: 'trackRemoteBranch', remoteRef: draft.remoteBranch, localBranch } }
  }
  if (draft.mode === 'detached') {
    if (!draft.remoteBranch) return null
    return { worktreePath: draft.effectivePath, mode: { kind: 'detached', ref: draft.remoteBranch } }
  }
  return null
}
```

- [ ] **Step 7: Implement dialog mode state and wire submit mapping**

In `src/web/components/CreateWorktreeDialog.tsx`, update request type:

```ts
import { buildCreateWorktreeInput, defaultBranchForCreateMode, type CreateWorktreeModeKind } from '#/web/components/create-worktree-dialog-model.ts'
import type { CreateWorktreeInput } from '#/shared/worktree-create.ts'
import { getRepositoryRemoteBranches, fetchRepository } from '#/web/app-data-client.ts'

export type CreateWorktreeRequest = CreateWorktreeInput
```

Add state:

```ts
  const [mode, setMode] = useState<CreateWorktreeModeKind>('newBranch')
  const [existingBranch, setExistingBranch] = useState('')
  const [remoteBranch, setRemoteBranch] = useState('')
  const [localBranch, setLocalBranch] = useState('')
  const [remoteBranches, setRemoteBranches] = useState<string[]>([])
  const [remoteBranchesLoading, setRemoteBranchesLoading] = useState(false)
```

Add a remote branch loader:

```ts
  async function loadRemoteBranches() {
    setRemoteBranchesLoading(true)
    try {
      setRemoteBranches(await getRepositoryRemoteBranches(repo.id))
    } finally {
      setRemoteBranchesLoading(false)
    }
  }

  async function refreshRemoteBranches() {
    setRemoteBranchesLoading(true)
    try {
      await fetchRepository(repo.id, 'user')
      setRemoteBranches(await getRepositoryRemoteBranches(repo.id))
    } finally {
      setRemoteBranchesLoading(false)
    }
  }
```

Call `loadRemoteBranches()` on dialog open. Use `defaultBranchForCreateMode()` to derive default path names. Build submit input with `buildCreateWorktreeInput()`:

```ts
const createInput = buildCreateWorktreeInput(repo, {
  mode,
  effectivePath,
  baseBranch: base,
  newBranch: branchTrimmed,
  existingBranch,
  remoteBranch,
  localBranch: localBranch.trim(),
  localBranchEdited,
})
```

- [ ] **Step 8: Update toolbar action**

Modify `src/web/components/repo-toolbar/RepoToolbarActions.tsx`:

```ts
      {
        kind: 'createWorktree',
        input: request,
      },
```

- [ ] **Step 9: Run renderer mode tests**

Run:

```bash
bun run test src/web/stores/repos/branch-actions.test.ts src/web/stores/repos/refresh.test.ts src/web/components/create-worktree-dialog-model.test.ts src/web/components/CreateWorktreeDialog.test.tsx src/shared/i18n/dictionaries.test.ts
```

Expected: PASS.

- [ ] **Step 10: Commit renderer create dialog**

```bash
git add src/web/stores/repos/branch-action-types.ts src/web/stores/repos/branch-actions.ts src/web/stores/repos/branch-actions.test.ts src/web/stores/repos/refresh.test.ts src/web/components/repo-toolbar/RepoToolbarActions.tsx src/web/components/create-worktree-dialog-model.ts src/web/components/create-worktree-dialog-model.test.ts src/web/components/CreateWorktreeDialog.tsx src/web/components/CreateWorktreeDialog.test.tsx src/shared/i18n/en.ts src/shared/i18n/zh.ts src/shared/i18n/ko.ts src/shared/i18n/ja.ts
git commit -m "feat: add create worktree mode dialog"
```

## Task 5: Detached Worktree State And UI

**Files:**
- Modify: `src/web/stores/repos/types.ts`
- Modify: `src/web/stores/repos/worktree-state.ts`
- Modify: `src/web/stores/repos/worktree-state.test.ts`
- Modify: `src/shared/worktree-guards.ts`
- Modify: `src/shared/worktree-guards.test.ts`
- Create: `src/web/hooks/useDetachedWorktreeActions.tsx`
- Create: `src/web/components/branch-list/DetachedWorktreeRow.tsx`
- Create: `src/web/components/branch-list/DetachedWorktreeSection.tsx`
- Modify: `src/web/components/BranchList.tsx`
- Modify: `src/web/components/branch-list/BranchRow.test.tsx`
- Modify: `src/shared/i18n/en.ts`, `src/shared/i18n/zh.ts`, `src/shared/i18n/ko.ts`, `src/shared/i18n/ja.ts`

- [ ] **Step 1: Add detached state tests**

Append to `src/web/stores/repos/worktree-state.test.ts`:

```ts
  test('keeps detached worktrees from status in canonical worktree state', () => {
    const previous = {}
    const next = applyStatusToWorktreeStates(previous, [
      { path: '/tmp/repo-detached', head: 'abc1234', isMain: false, entries: [] },
    ])

    expect(next['/tmp/repo-detached']).toEqual({
      path: '/tmp/repo-detached',
      head: 'abc1234',
      isMain: false,
      isDirty: false,
      changeCount: 0,
      isLocked: undefined,
    })
  })
```

- [ ] **Step 2: Store detached head in renderer worktree state**

Modify `src/web/stores/repos/types.ts`:

```ts
export interface RepoWorktreeState {
  path: string
  branch?: string
  head?: string
  isMain: boolean
  isDirty?: boolean
  changeCount?: number
  isLocked?: boolean
}
```

Modify `src/web/stores/repos/worktree-state.ts` in both state builders:

```ts
      head: statusEntry?.head ?? snapshotWorktree.head ?? prev?.head,
```

and:

```ts
      head: wt.head ?? prev?.head,
```

- [ ] **Step 3: Add worktree-only guard tests**

Append to `src/shared/worktree-guards.test.ts`:

```ts
  test('resolves removable detached worktrees by path only', () => {
    expect(
      resolveRemovableWorktree(
        [{ path: '/tmp/repo-detached', head: 'abc1234', isBare: false, isPrimary: false }],
        null,
        '/tmp/repo-detached',
        '/tmp/repo',
      ),
    ).toMatchObject({ ok: true, target: { path: '/tmp/repo-detached', head: 'abc1234' } })
  })
```

- [ ] **Step 4: Update worktree guards for detached removal**

Modify `src/shared/worktree-guards.ts`:

```ts
export function resolveRemovableWorktree(
  worktrees: WorktreeInfo[],
  branch: string | null,
  worktreePath: string,
  repoRoot: string,
): RemovableWorktreeResult {
  const target = worktrees.find((wt) => {
    const pathMatches = path.resolve(wt.path) === path.resolve(worktreePath)
    if (!pathMatches) return false
    return branch ? wt.branch === branch : wt.branch === undefined
  })
  if (!target) return { ok: false, message: 'error.invalid-worktree-path' }
  if (target.isPrimary || path.resolve(target.path) === path.resolve(repoRoot)) return { ok: false, message: 'error.cannot-remove-main-worktree' }
  if (target.isBare) return { ok: false, message: 'error.cannot-remove-bare-worktree' }
  if (target.isLocked) return { ok: false, message: 'error.cannot-remove-locked-worktree' }
  return { ok: true, target }
}
```

Update branch callers to pass `branch.name`; detached callers pass `null`.

- [ ] **Step 5: Add detached i18n keys**

Add to all dictionaries:

```ts
  'worktrees.detached-title': 'Detached worktrees',
  'worktrees.detached-label': 'detached',
  'worktrees.detached-head': 'HEAD {hash}',
  'action.confirm-remove-detached-worktree-title': 'Remove detached worktree?',
  'action.confirm-remove-detached-worktree-body': 'This will delete the detached worktree directory:',
```

- [ ] **Step 6: Implement detached row and section**

Create `src/web/components/branch-list/DetachedWorktreeRow.tsx`:

```tsx
import { Code2, TerminalSquare, Trash2 } from 'lucide-react'
import { Button } from '#/web/components/ui/button.tsx'
import { Tip } from '#/web/components/Tip.tsx'
import { formatWorktreePath } from '#/web/lib/paths.ts'
import { useT } from '#/web/stores/i18n.ts'
import type { RepoWorktreeState } from '#/web/stores/repos/types.ts'
import type { RemoteRepoTarget } from '#/shared/remote-repo.ts'

interface Props {
  worktree: RepoWorktreeState
  remoteTarget?: RemoteRepoTarget
  onOpenTerminal: () => void
  onOpenEditor: () => void
  onRemove: () => void
}

export function DetachedWorktreeRow({ worktree, remoteTarget, onOpenTerminal, onOpenEditor, onRemove }: Props) {
  const t = useT()
  const path = formatWorktreePath(worktree.path, remoteTarget)
  const head = worktree.head ? worktree.head.slice(0, 7) : null
  return (
    <li className="grid min-h-9 grid-cols-[minmax(0,1fr)_auto] items-center hover:bg-muted">
      <div className="min-w-0 px-4 py-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-xs uppercase text-muted-foreground">{t('worktrees.detached-label')}</span>
          {head && <span className="font-mono text-xs text-muted-foreground">{t('worktrees.detached-head', { hash: head })}</span>}
        </div>
        <div className="truncate font-mono text-xs" title={path}>
          {path}
        </div>
      </div>
      <div className="flex items-center gap-1 pr-4">
        <Tip label={t('worktrees.open-in-terminal-title')}>
          <Button type="button" variant="ghost" size="icon" onClick={onOpenTerminal}>
            <TerminalSquare />
          </Button>
        </Tip>
        <Tip label={t('worktrees.open-in-editor-title')}>
          <Button type="button" variant="ghost" size="icon" onClick={onOpenEditor}>
            <Code2 />
          </Button>
        </Tip>
        <Tip label={t('action.confirm-remove-worktree-title')}>
          <Button type="button" variant="ghost" size="icon" onClick={onRemove}>
            <Trash2 />
          </Button>
        </Tip>
      </div>
    </li>
  )
}
```

Create `src/web/components/branch-list/DetachedWorktreeSection.tsx`:

```tsx
import { DetachedWorktreeRow } from '#/web/components/branch-list/DetachedWorktreeRow.tsx'
import { useDetachedWorktreeActions } from '#/web/hooks/useDetachedWorktreeActions.tsx'
import { useT } from '#/web/stores/i18n.ts'
import type { BranchActionRepo } from '#/web/hooks/branch-action-state.ts'

interface Props {
  repo: BranchActionRepo
}

export function DetachedWorktreeSection({ repo }: Props) {
  const t = useT()
  const actions = useDetachedWorktreeActions(repo)
  const detached = Object.values(repo.data.worktreesByPath).filter((wt) => !wt.isMain && !wt.branch)
  if (detached.length === 0) return null
  return (
    <section className="border-t border-border/60 pt-2">
      <h3 className="px-4 pb-1 text-xs font-medium text-muted-foreground">{t('worktrees.detached-title')}</h3>
      <ul>
        {detached.map((worktree) => (
          <DetachedWorktreeRow
            key={worktree.path}
            worktree={worktree}
            remoteTarget={repo.remote.target}
            onOpenTerminal={() => actions.openTerminal(worktree)}
            onOpenEditor={() => actions.openEditor(worktree)}
            onRemove={() => actions.requestRemove(worktree)}
          />
        ))}
      </ul>
      {actions.dialogs}
    </section>
  )
}
```

- [ ] **Step 7: Implement detached actions**

Create `src/web/hooks/useDetachedWorktreeActions.tsx`:

```tsx
import { useState } from 'react'
import { ConfirmDialog } from '#/web/components/ConfirmDialog.tsx'
import { formatWorktreePath } from '#/web/lib/paths.ts'
import { openRepositoryEditor, openRepositoryTerminal } from '#/web/app-data-client.ts'
import { useMainWindowNavigation } from '#/web/main-window-navigation.tsx'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { useT } from '#/web/stores/i18n.ts'
import type { BranchActionRepo } from '#/web/hooks/branch-action-state.ts'
import type { RepoWorktreeState } from '#/web/stores/repos/types.ts'

export function useDetachedWorktreeActions(repo: BranchActionRepo) {
  const t = useT()
  const navigation = useMainWindowNavigation()
  const runBranchAction = useReposStore((s) => s.runBranchAction)
  const [pendingRemove, setPendingRemove] = useState<RepoWorktreeState | null>(null)

  function openTerminal(worktree: RepoWorktreeState) {
    if (repo.remote.target) {
      navigation.showRepoDetailTab(repo.id, 'terminal')
      return
    }
    void openRepositoryTerminal(worktree.path)
  }

  function openEditor(worktree: RepoWorktreeState) {
    void openRepositoryEditor(worktree.path)
  }

  function requestRemove(worktree: RepoWorktreeState) {
    setPendingRemove(worktree)
  }

  function confirmRemove() {
    const target = pendingRemove
    setPendingRemove(null)
    if (!target) return
    void runBranchAction(repo.id, {
      kind: 'removeWorktree',
      branch: null,
      worktreePath: target.path,
      alsoDeleteBranch: false,
    })
  }

  const dialogs = (
    <ConfirmDialog
      open={!!pendingRemove}
      title={pendingRemove ? t('action.confirm-remove-detached-worktree-title') : ''}
      message={
        pendingRemove ? (
          <span>
            {t('action.confirm-remove-detached-worktree-body')}
            <span className="block break-all font-mono text-foreground">
              {formatWorktreePath(pendingRemove.path, repo.remote.target)}
            </span>
          </span>
        ) : (
          ''
        )
      }
      confirmLabel={t('action.confirm-remove-worktree-confirm')}
      destructive
      onCancel={() => setPendingRemove(null)}
      onConfirm={confirmRemove}
    />
  )

  return { openTerminal, openEditor, requestRemove, dialogs }
}
```

Update `RepoBranchAction` remove type to allow `branch: string | null`.

- [ ] **Step 8: Render detached section below branch list**

Modify `src/web/components/BranchList.tsx`:

```tsx
import { DetachedWorktreeSection } from '#/web/components/branch-list/DetachedWorktreeSection.tsx'
```

In the `list` fragment for normal list variant:

```tsx
  const list = (
    <>
      <ul>
        {renderedBranches.map((branch) => (
          <BranchRow
            key={branch.name}
            repo={repo}
            branch={branch}
            selected={repo.ui.selectedBranch}
            current={repo.data.currentBranch}
            onSelectBranch={handleSelectBranch}
            onOpenBranchStatus={handleOpenBranchStatus}
            selectedRef={selectedRef}
            showActions={showActions}
            actionMenuOpen={openActionMenu?.repoId === repoId && openActionMenu.branch === branch.name}
            onActionMenuOpenChange={(open) =>
              setOpenActionMenu((current) =>
                open
                  ? { repoId, branch: branch.name }
                  : current?.repoId === repoId && current.branch === branch.name
                    ? null
                    : current,
              )
            }
          />
        ))}
      </ul>
      {variant === 'list' && <DetachedWorktreeSection repo={repo} />}
    </>
  )
```

Keep `selected-strip` branch-only by rendering the section only for `variant === 'list'`.

- [ ] **Step 9: Run detached UI and guard tests**

Run:

```bash
bun run test src/web/stores/repos/worktree-state.test.ts src/shared/worktree-guards.test.ts src/web/components/branch-list/BranchRow.test.tsx src/shared/i18n/dictionaries.test.ts
```

Expected: PASS.

- [ ] **Step 10: Commit detached worktree presentation**

```bash
git add src/web/stores/repos/types.ts src/web/stores/repos/worktree-state.ts src/web/stores/repos/worktree-state.test.ts src/shared/worktree-guards.ts src/shared/worktree-guards.test.ts src/web/hooks/useBranchActions.tsx src/web/hooks/useDetachedWorktreeActions.tsx src/web/components/branch-list/DetachedWorktreeRow.tsx src/web/components/branch-list/DetachedWorktreeSection.tsx src/web/components/BranchList.tsx src/web/components/branch-list/BranchRow.test.tsx src/shared/i18n/en.ts src/shared/i18n/zh.ts src/shared/i18n/ko.ts src/shared/i18n/ja.ts
git commit -m "feat: show detached worktrees separately"
```

## Task 6: Full Verification And Architecture Check

**Files:**
- Modify only files required by failures found in this task.

- [ ] **Step 1: Run typecheck**

Run:

```bash
bun run typecheck
```

Expected: PASS. Type diagnostics name the exact file and line; apply only import, signature, or property-name corrections needed for the create-worktree mode contract.

- [ ] **Step 2: Run full test suite**

Run:

```bash
bun run test
```

Expected: PASS. Create-worktree failures that mention `newBranch` or `baseBranch` should be corrected to the `input.mode` request shape introduced in Task 1.

- [ ] **Step 3: Run architecture guard**

Run:

```bash
bun run check:architecture
```

Expected: PASS. Architecture diagnostics should be resolved by keeping shared types in `src/shared/`, Git and SSH command code in `src/system/`, server orchestration in `src/server/`, and renderer state/UI in `src/web/`.

- [ ] **Step 4: Review changed files for scope**

Run:

```bash
git status --short
git diff --stat
```

Expected: only files listed in this plan are changed.

- [ ] **Step 5: Final status check**

Run:

```bash
git status --short --branch
```

Expected: clean working tree except for unrelated files that were present before implementation:

```text
?? docs/superpowers/plans/2026-06-08-remote-worktree-terminal-editor.md
?? docs/superpowers/specs/2026-06-08-remote-worktree-terminal-editor-design.md
```
