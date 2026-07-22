import { afterEach, expect, test, vi } from 'vitest'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { defaultClientWorkspaceState } from '#/shared/settings-defaults.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'

let tmp: string | null = null

afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true })
  tmp = null
  vi.resetModules()
  vi.doUnmock('electron')
  vi.doUnmock('node:fs/promises')
})

test('persists client workspace independently of the embedded server origin', async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'goblin-client-workspace-test-'))
  vi.doMock('electron', () => ({ app: { getPath: () => tmp! } }))
  const persistence = await import('#/main/client-workspace-state.ts')
  const state = {
    ...defaultClientWorkspaceState(),
    restoredWorkspaceId: workspaceIdForTest('goblin+file:///repo-d'),
  }

  await persistence.writeNativeClientWorkspaceState(state)

  await expect(persistence.readNativeClientWorkspaceState()).resolves.toEqual({
    kind: 'loaded',
    state,
  })
})

test('distinguishes a missing workspace file from read failures', async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'goblin-client-workspace-test-'))
  vi.doMock('electron', () => ({ app: { getPath: () => tmp! } }))
  const persistence = await import('#/main/client-workspace-state.ts')

  await expect(persistence.readNativeClientWorkspaceState()).resolves.toEqual({ kind: 'missing' })

  writeFileSync(path.join(tmp, 'client-workspace.json'), '{invalid json', 'utf-8')
  await expect(persistence.readNativeClientWorkspaceState()).rejects.toBeInstanceOf(SyntaxError)
  expect(readFileSync(path.join(tmp, 'client-workspace.json'), 'utf-8')).toBe('{invalid json')
})

test('reads the current state directly without an envelope', async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'goblin-client-workspace-test-'))
  vi.doMock('electron', () => ({ app: { getPath: () => tmp! } }))
  const persistence = await import('#/main/client-workspace-state.ts')
  const state = defaultClientWorkspaceState()
  writeFileSync(path.join(tmp, 'client-workspace.json'), JSON.stringify(state), 'utf-8')

  await expect(persistence.readNativeClientWorkspaceState()).resolves.toEqual({ kind: 'loaded', state })
  expect(readFileSync(path.join(tmp, 'client-workspace.json'), 'utf-8')).toBe(JSON.stringify(state))
})

test('rejects an obsolete version envelope as invalid state', async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'goblin-client-workspace-test-'))
  vi.doMock('electron', () => ({ app: { getPath: () => tmp! } }))
  const persistence = await import('#/main/client-workspace-state.ts')
  writeFileSync(path.join(tmp, 'client-workspace.json'), JSON.stringify({ version: 2, state: {} }), 'utf-8')

  await expect(persistence.readNativeClientWorkspaceState()).rejects.toThrow()
  expect(readFileSync(path.join(tmp, 'client-workspace.json'), 'utf-8')).toBe(JSON.stringify({ version: 2, state: {} }))
  expect(readdirSync(tmp)).toEqual(['client-workspace.json'])
})

test('rejects unknown state fields', async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'goblin-client-workspace-test-'))
  vi.doMock('electron', () => ({ app: { getPath: () => tmp! } }))
  const persistence = await import('#/main/client-workspace-state.ts')
  const raw = JSON.stringify({ ...defaultClientWorkspaceState(), unknownRoot: 'preserve' })
  writeFileSync(path.join(tmp, 'client-workspace.json'), raw, 'utf-8')

  await expect(persistence.readNativeClientWorkspaceState()).rejects.toThrow()
  expect(readFileSync(path.join(tmp, 'client-workspace.json'), 'utf-8')).toBe(raw)
})

test('serializes corrupt reads before a concurrent write so the committed state is not quarantined', async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'goblin-client-workspace-test-'))
  vi.doMock('electron', () => ({ app: { getPath: () => tmp! } }))
  const persistence = await import('#/main/client-workspace-state.ts')
  const file = path.join(tmp, 'client-workspace.json')
  writeFileSync(file, '{invalid json', 'utf-8')
  const state = {
    ...defaultClientWorkspaceState(),
    restoredWorkspaceId: workspaceIdForTest('goblin+file:///repo-after-corruption'),
  }

  const [readResult, writeResult] = await Promise.allSettled([
    persistence.readNativeClientWorkspaceState(),
    persistence.writeNativeClientWorkspaceState(state),
  ])

  expect(readResult.status).toBe('rejected')
  expect(writeResult.status).toBe('fulfilled')
  await expect(persistence.readNativeClientWorkspaceState()).resolves.toEqual({
    kind: 'loaded',
    state,
  })
  expect(readdirSync(tmp)).toEqual(['client-workspace.json'])
})

test('serializes concurrent corrupt reads without mutating the authoritative file', async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'goblin-client-workspace-test-'))
  vi.doMock('electron', () => ({ app: { getPath: () => tmp! } }))
  const persistence = await import('#/main/client-workspace-state.ts')
  writeFileSync(path.join(tmp, 'client-workspace.json'), '{invalid json', 'utf-8')

  const results = await Promise.allSettled([
    persistence.readNativeClientWorkspaceState(),
    persistence.readNativeClientWorkspaceState(),
  ])
  expect(results[0]?.status).toBe('rejected')
  expect(results[1]?.status).toBe('rejected')
  expect(readFileSync(path.join(tmp, 'client-workspace.json'), 'utf-8')).toBe('{invalid json')
})
