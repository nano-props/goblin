// @vitest-environment jsdom
import { act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { mockFetch } from '#/test-utils/fetch-mock.ts'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { CreateWorktreeDialogHost } from '#/web/components/CreateWorktreeDialogHost.tsx'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { settingsSnapshotQueryKey } from '#/web/settings-query-cache.ts'
import { createRepoBranch, resetReposStore, seedRepoState } from '#/web/test-utils/bridge.ts'
import { defaultSettingsSnapshot } from '#/shared/settings-defaults.ts'

const dialogMock = vi.hoisted(() => ({
  props: [] as Array<{
    open: boolean
    worktreeBootstrap?: {
      loading: boolean
      preview: { hasOperations: boolean; configHash: string | null } | null
      error: boolean
      configTrusted: boolean
    }
  }>,
}))

vi.mock('#/web/components/create-worktree-dialog/CreateWorktreeDialog.tsx', () => ({
  CreateWorktreeDialog: (props: {
    open: boolean
    worktreeBootstrap?: {
      loading: boolean
      preview: { hasOperations: boolean; configHash: string | null } | null
      error: boolean
      configTrusted: boolean
    }
  }) => {
    dialogMock.props.push(props)
    return <div data-testid="create-worktree-dialog" data-open={props.open ? 'true' : 'false'} />
  },
}))

const REPO_ID = '/tmp/gbl-create-host-retention-test'

beforeEach(() => {
  dialogMock.props.length = 0
  primaryWindowQueryClient.clear()
  globalThis.localStorage?.clear()
  resetReposStore()
  primaryWindowQueryClient.setQueryData(settingsSnapshotQueryKey(), defaultSettingsSnapshot())
  seedRepoState({
    id: REPO_ID,
    branches: [createRepoBranch('main', { isCurrent: true, ahead: 0, behind: 0 })],
  })
})

afterEach(() => {
  primaryWindowQueryClient.clear()
  globalThis.localStorage?.clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('CreateWorktreeDialogHost close retention', () => {
  test('keeps the bootstrap prompt rendered while the dialog is closing', async () => {
    const configHash = 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    mockFetch(async () => previewResponse({ hasOperations: true, configHash }))

    const { rerender } = renderInJsdom(
      <CreateWorktreeDialogHost open={true} onOpenChange={vi.fn()} repoId={REPO_ID} />,
    )
    await flushReact()

    expect(lastDialogProps().open).toBe(true)
    expect(lastDialogProps().worktreeBootstrap?.preview).toMatchObject({ hasOperations: true, configHash })

    rerender(<CreateWorktreeDialogHost open={false} onOpenChange={vi.fn()} repoId={REPO_ID} />)
    await flushReact()

    expect(lastDialogProps().open).toBe(false)
    expect(lastDialogProps().worktreeBootstrap?.preview).toMatchObject({ hasOperations: true, configHash })
  })
})

function previewResponse(input: { hasOperations: boolean; configHash: string | null }): Response {
  return new Response(
    JSON.stringify({
      ok: true,
      preview: {
        hasConfig: input.configHash !== null,
        hasOperations: input.hasOperations,
        configHash: input.configHash,
        copyCount: 0,
        symlinkCount: 0,
        hardlinkCount: 0,
        excludeCount: 0,
      },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )
}

function lastDialogProps(): (typeof dialogMock.props)[number] {
  const props = dialogMock.props.at(-1)
  if (!props) throw new Error('CreateWorktreeDialog was not rendered')
  return props
}

async function flushReact(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}
