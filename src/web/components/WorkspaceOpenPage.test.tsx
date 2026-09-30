// @vitest-environment jsdom
import { resetWorkspacesStore } from '#/web/test-utils/repo-store.ts'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import { screen, waitFor } from '@testing-library/vue'
import { userEvent } from '@testing-library/user-event'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'
import type { OpenWorkspaceResult, WorkspaceMembershipActions } from '#/web/stores/workspaces/types.ts'
import { workspaceSlugFromId } from '#/web/app/navigation/workspace-route-slugs.ts'
import { WorkspaceOpenPage } from '#/web/components/WorkspaceOpenPage.tsx'

const workspaceId = workspaceIdForTest('goblin+file:///srv/example')
const openWorkspaceMembership = vi.fn<WorkspaceMembershipActions['openWorkspaceMembership']>()

beforeEach(() => {
  resetWorkspacesStore()
  openWorkspaceMembership.mockResolvedValue({ ok: true, workspaceId })
  workspacesStore.setState({ openWorkspaceMembership })
})

async function setup(path: unknown, rejectNavigation = false) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/open', component: { render: () => null } },
      { path: '/', name: 'home', component: { render: () => null } },
      { path: '/workspace/:workspaceSlug', name: 'workspace', component: { render: () => null } },
    ],
  })
  await router.push('/open?path=%2Fsrv%2Fexample')
  if (rejectNavigation) vi.spyOn(router, 'replace').mockRejectedValueOnce(new Error('navigation failed'))
  const rendered = renderInJsdom(WorkspaceOpenPage, { props: { path }, global: { plugins: [router] } })
  return { router, ...rendered }
}

describe('workspace-open page in the authenticated shell', () => {
  test('automatically opens the directory and replaces the command URL with the workspace URL', async () => {
    const { router } = await setup('/srv/example')
    await waitFor(() => expect(router.currentRoute.value.path).toBe(`/workspace/${workspaceSlugFromId(workspaceId)}`))
    expect(router.currentRoute.value.query).toEqual({})
    expect(openWorkspaceMembership).toHaveBeenCalledExactlyOnceWith('/srv/example')
  })

  test.each(
    [undefined, ['/srv/first', '/srv/second'], 'relative', '/' + 'a'.repeat(4096), '/srv/line\nbreak'].map((path) => ({
      path,
    })),
  )('rejects a missing, repeated, or invalid path: %j', async ({ path }) => {
    await setup(path)
    expect((await screen.findByRole('alert')).textContent).toContain('workspace-open.invalid-path')
    expect(openWorkspaceMembership).not.toHaveBeenCalled()
  })

  test('shows a failed open and retries only after an explicit click', async () => {
    openWorkspaceMembership.mockResolvedValueOnce({ ok: false, kind: 'failed', message: 'error.workspace-open-failed' })
    const { router } = await setup('/srv/example')
    expect((await screen.findByRole('alert')).textContent).toContain('error.workspace-open-failed')
    expect(openWorkspaceMembership).toHaveBeenCalledOnce()
    await userEvent.setup().click(screen.getByRole('button', { name: 'workspace-open.retry' }))
    await waitFor(() => expect(router.currentRoute.value.name).toBe('workspace'))
    expect(openWorkspaceMembership).toHaveBeenCalledTimes(2)
  })

  test('does not automatically repeat an uncertain operation or navigate away', async () => {
    openWorkspaceMembership.mockResolvedValueOnce({
      ok: false,
      kind: 'uncertain',
      message: 'error.operation-outcome-uncertain',
    })
    const { router } = await setup('/srv/example')
    await screen.findByRole('alert')
    expect(router.currentRoute.value.path).toBe('/open')
    expect(openWorkspaceMembership).toHaveBeenCalledOnce()
  })

  test('retries only navigation after a successful open whose presentation failed', async () => {
    const { router } = await setup('/srv/example', true)
    expect((await screen.findByRole('alert')).textContent).toContain('navigation failed')
    await userEvent.setup().click(screen.getByRole('button', { name: 'workspace-open.retry' }))
    await waitFor(() => expect(router.currentRoute.value.name).toBe('workspace'))
    expect(openWorkspaceMembership).toHaveBeenCalledOnce()
  })

  test('does not redirect after the user leaves while opening is pending', async () => {
    const opening = Promise.withResolvers<OpenWorkspaceResult>()
    openWorkspaceMembership.mockReturnValueOnce(opening.promise)
    const { router, unmount } = await setup('/srv/example')
    const replace = vi.spyOn(router, 'replace')
    unmount()
    opening.resolve({ ok: true, workspaceId })
    await opening.promise
    expect(replace).not.toHaveBeenCalled()
  })
})
